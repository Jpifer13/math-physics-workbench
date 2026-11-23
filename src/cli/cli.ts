/**
 * The command-line mode: run a saved simulation, its experiment or its
 * uncertainty analysis without the window, and write the result as CSV, so
 * the app can sit inside a script, a pipeline or a cluster job. Everything
 * here is text in, text out; main.ts connects it to the file system.
 */
import { APP_NAME, APP_SLUG } from '../core/brand';
import { normalizeSim, readDocument, simFile } from '../core/docfile';
import { checkModel } from '../core/lint';
import { MEASURES, measureAt, scanValues, scanValues2, toCsv } from '../core/measure';
import { simulate, type MeasureId, type OdeModel, type ScanConfig, type UncertaintyConfig } from '../core/ode';
import { inputProblem, makeDesign, overridesOf, sobolIndices, spread } from '../core/sensitivity';
import { checkExpectations, provenance } from '../core/trust';
import { MODELS } from '../sim/models';

export interface CliIo {
  read: (path: string) => string;
  write: (path: string, text: string) => void;
  /** Standard output: results. */
  out: (text: string) => void;
  /** Standard error: messages, so results can be piped cleanly. */
  err: (text: string) => void;
  /** ISO timestamp for the provenance header. */
  now: () => string;
  appVersion: string;
  fileFormat: number;
}

/** 0: done. 1: the model failed, or an expectation does not hold. 2: the command was not understood. */
export type ExitCode = 0 | 1 | 2;

export const USAGE = `${APP_NAME} — command line

Usage:
  ${APP_SLUG} run <model.physsim> [options]
      Integrate the model once. Writes time, every state and every observable.
  ${APP_SLUG} experiment <model.physsim> [options]
      Scan one or two parameters and measure each run. Uses the experiment
      saved in the file unless --param and the rest are given.
  ${APP_SLUG} uncertainty <model.physsim> [options]
      Sample the uncertain parameters saved in the file together and report
      the spread of a measurement and the Sobol sensitivity indices.
  ${APP_SLUG} check <model.physsim> [options]
      Run the model and test its expectations. Exits 1 if any fails.
  ${APP_SLUG} template [name]
      Write one of the built-in templates as a .physsim file to start from.
      With no name, list them.

Options:
  --out <file>          Write the CSV there instead of standard output.
  --set <name>=<value>  Override a parameter. May be repeated.
  --end <time>          Override the duration of the run.

  For experiment:
  --param <name> --from <a> --to <b> --points <n>
  --param2 <name> --from2 <a> --to2 <b> --points2 <n>
  --observable <name>   What to measure (a state, an observable, or t).
  --measure <id>        One of: ${MEASURES.map((m) => m.id).join(', ')}.

  For uncertainty:
  --samples <n>         Base sample size (the analysis makes n × (inputs + 2) runs).
  --seed <n>            Seed of the sampler.
  --observable, --measure as above.

  --help, --version

Results go to standard output and messages to standard error. Every CSV
starts with a header of lines beginning "# " that records what produced it.
`;

class UsageError extends Error {}

const VALUE_OPTIONS = ['out', 'set', 'end', 'param', 'from', 'to', 'points', 'param2', 'from2', 'to2', 'points2', 'observable', 'measure', 'samples', 'seed'];

/** Split the arguments into the command, the file and the options. */
export function parseArgs(argv: string[]): { command: string; file?: string; options: Record<string, string[]> } {
  const options: Record<string, string[]> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { rest.push(a); continue; }
    const [name, inline] = a.slice(2).split(/=(.*)/s, 2);
    if (name === 'help' || name === 'version') { (options[name] ??= []).push(''); continue; }
    if (!VALUE_OPTIONS.includes(name)) throw new UsageError(`Unknown option --${name}.`);
    const value = inline ?? argv[++i];
    if (value === undefined) throw new UsageError(`--${name} needs a value.`);
    (options[name] ??= []).push(value);
  }
  if (rest.length > 2) throw new UsageError(`Unexpected argument “${rest[2]}”. Give one command and one file.`);
  return { command: rest[0] ?? '', file: rest[1], options };
}

const numeric = (options: Record<string, string[]>, name: string): number | undefined => {
  const raw = options[name]?.at(-1);
  if (raw === undefined) return undefined;
  const v = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(v)) throw new UsageError(`--${name} must be a number, not “${raw}”.`);
  return v;
};
const text = (options: Record<string, string[]>, name: string) => options[name]?.at(-1);

/** Load the model and apply --set and --end. */
function loadModel(file: string | undefined, options: Record<string, string[]>, io: CliIo): OdeModel {
  if (!file) throw new UsageError('Which file? Give the path of a .physsim simulation.');
  let raw: string;
  try {
    raw = io.read(file);
  } catch (err) {
    throw new UsageError(`Could not read “${file}”: ${err instanceof Error ? err.message : err}`);
  }
  const doc = readDocument(raw, io.fileFormat);
  if (doc.kind === 'newer') throw new UsageError(`“${file}” was saved by a newer version of ${APP_NAME} (file format ${doc.format}; this version reads up to ${io.fileFormat}).`);
  if (doc.kind === 'flow') throw new UsageError(`“${file}” is an equation flow. The command line runs simulations (.physsim).`);
  if (doc.kind !== 'sim') throw new UsageError(`“${file}” is not a ${APP_NAME} simulation.`);
  let model = normalizeSim(doc.model);
  for (const assignment of options.set ?? []) {
    const m = /^([^=]+)=(.*)$/.exec(assignment);
    const value = m ? Number(m[2]) : NaN;
    if (!m || m[2].trim() === '' || !Number.isFinite(value)) throw new UsageError(`--set expects name=number, not “${assignment}”.`);
    const name = m[1].trim();
    if (!model.params.some((p) => p.name === name)) {
      throw new UsageError(`The model has no parameter “${name}”. Its parameters are: ${model.params.map((p) => p.name).join(', ') || 'none'}.`);
    }
    model = { ...model, params: model.params.map((p) => (p.name === name ? { ...p, value } : p)) };
  }
  const end = numeric(options, 'end');
  if (end !== undefined) {
    if (!(end > 0)) throw new UsageError('--end must be greater than zero.');
    model = { ...model, tEnd: end };
  }
  return model;
}

const observablesOf = (model: OdeModel) => ['t', ...model.states.map((s) => s.name), ...model.derived.map((d) => d.name)];
const unitOf = (model: OdeModel, name: string) => model.states.find((s) => s.name === name)?.unit ?? model.derived.find((d) => d.name === name)?.unit ?? '';
const withUnit = (name: string, unit?: string) => (unit ? `${name} (${unit})` : name);

/** --observable and --measure, checked against the model. */
function measurement(model: OdeModel, options: Record<string, string[]>, fallback: { observable: string; measure: MeasureId }) {
  const observable = text(options, 'observable') ?? fallback.observable;
  const measure = (text(options, 'measure') ?? fallback.measure) as MeasureId;
  if (!observablesOf(model).includes(observable)) throw new UsageError(`The model has no quantity “${observable}”. It has: ${observablesOf(model).join(', ')}.`);
  if (!MEASURES.some((m) => m.id === measure)) throw new UsageError(`Unknown measure “${measure}”. Use one of: ${MEASURES.map((m) => m.id).join(', ')}.`);
  return { observable, measure };
}
const measuredLabel = (model: OdeModel, observable: string, measure: MeasureId) => {
  const def = MEASURES.find((m) => m.id === measure)!;
  return withUnit(`${def.label.toLowerCase()} of ${observable}`, def.isTime ? '' : unitOf(model, observable));
};

function emit(csv: string, options: Record<string, string[]>, io: CliIo, what: string) {
  const out = text(options, 'out');
  if (!out) return io.out(csv);
  io.write(out, csv);
  io.err(`Wrote ${what} to ${out}\n`);
}

function run(model: OdeModel, options: Record<string, string[]>, io: CliIo): ExitCode {
  const result = simulate(model);
  if (result.error) { io.err(`The model did not run: ${result.error}\n`); return 1; }
  const names = Object.keys(result.series);
  const columns = [{ name: 't', values: result.t }, ...names.map((n) => ({ name: withUnit(n, unitOf(model, n)), values: result.series[n] }))];
  emit(toCsv(columns, provenance(model, { appVersion: io.appVersion, when: io.now(), run: result })), options, io, `${result.t.length} samples`);
  return 0;
}

function experiment(model: OdeModel, options: Record<string, string[]>, io: CliIo): ExitCode {
  const saved = model.experiment;
  const param = text(options, 'param') ?? saved?.param;
  if (!param) throw new UsageError('This file has no saved experiment. Give --param, --from, --to and --points.');
  const paramOf = (name: string) => {
    const p = model.params.find((q) => q.name === name);
    if (!p) throw new UsageError(`The model has no parameter “${name}”. Its parameters are: ${model.params.map((q) => q.name).join(', ') || 'none'}.`);
    return p;
  };
  const p1 = paramOf(param);
  // A parameter named on the command line starts from its own range, not the saved experiment's.
  const base = param === saved?.param ? saved : undefined;
  const param2 = text(options, 'param2') ?? (text(options, 'param') ? undefined : saved?.param2);
  const base2 = param2 !== undefined && param2 === saved?.param2 ? saved : undefined;
  const p2 = param2 !== undefined ? paramOf(param2) : undefined;
  const config: ScanConfig = {
    param,
    from: numeric(options, 'from') ?? base?.from ?? p1.min,
    to: numeric(options, 'to') ?? base?.to ?? p1.max,
    points: numeric(options, 'points') ?? base?.points ?? 41,
    ...measurement(model, options, { observable: saved?.observable ?? model.timeSeries[0] ?? model.states[0]?.name ?? 't', measure: saved?.measure ?? 'final' }),
    ...(p2 ? {
      param2: p2.name,
      from2: numeric(options, 'from2') ?? base2?.from2 ?? p2.min,
      to2: numeric(options, 'to2') ?? base2?.to2 ?? p2.max,
      points2: numeric(options, 'points2') ?? base2?.points2 ?? 21,
    } : {}),
  };
  if (!(config.to > config.from) || (p2 && !(config.to2! > config.from2!))) throw new UsageError('Each “to” must be greater than its “from”.');
  if (p2 && p2.name === p1.name) throw new UsageError('--param2 must be a different parameter from --param.');

  const xs = scanValues(config);
  const x2 = p2 ? scanValues2(config) : undefined;
  const at = (o: Record<string, number>) => measureAt(model, o, config.observable, config.measure);
  const label = measuredLabel(model, config.observable, config.measure);
  const axis = (p: typeof p1) => withUnit(p.name, p.unit);
  const columns = x2
    ? [
        { name: axis(p1), values: x2.flatMap(() => xs) },
        { name: axis(p2!), values: x2.flatMap((v) => xs.map(() => v)) },
        { name: label, values: x2.flatMap((v2) => xs.map((v) => at({ [p1.name]: v, [p2!.name]: v2 }))) },
      ]
    : [{ name: axis(p1), values: xs }, { name: label, values: xs.map((v) => at({ [p1.name]: v })) }];
  const values = columns[columns.length - 1].values;
  const failed = values.filter((v) => !Number.isFinite(v)).length;
  emit(toCsv(columns, provenance(model, { appVersion: io.appVersion, when: io.now(), experiment: config })), options, io, `${values.length} runs`);
  if (failed === values.length) { io.err('Every run failed to give a measurement. Check the model with the “check” command.\n'); return 1; }
  if (failed) io.err(`${failed} of ${values.length} runs gave no measurement; their cells are empty.\n`);
  return 0;
}

function uncertainty(model: OdeModel, options: Record<string, string[]>, io: CliIo): ExitCode {
  const saved = model.uncertainty;
  if (!saved?.inputs.length) throw new UsageError('This file has no saved uncertainty analysis. Set one up in the Uncertainty view and save the file.');
  const inputs = saved.inputs.filter((i) => model.params.some((p) => p.name === i.param));
  const problems = inputs.map(inputProblem).filter(Boolean);
  if (!inputs.length || problems.length) throw new UsageError(`The saved uncertainty analysis cannot be run: ${problems.join('; ') || 'none of its parameters exist in the model any more'}.`);
  const config: UncertaintyConfig = {
    inputs,
    samples: numeric(options, 'samples') ?? saved.samples,
    seed: numeric(options, 'seed') ?? saved.seed,
    ...measurement(model, options, { observable: saved.observable, measure: saved.measure }),
  };
  const design = makeDesign(config.inputs, config.samples, config.seed);
  const values = overridesOf(design).map((o) => measureAt(model, o, config.observable, config.measure));
  // The first two blocks of the design are plain draws from the inputs; the rest exist for the sensitivity indices.
  const plain = 2 * design.n;
  const s = spread(values.slice(0, plain));
  if (s.count < 2) { io.err('Every run failed to give a measurement. Check the model with the “check” command, or narrow the spread of the inputs.\n'); return 1; }
  const sobol = sobolIndices(values, design.n, config.inputs.length, 200, config.seed);
  const paramUnit = (name: string) => model.params.find((p) => p.name === name)?.unit;
  const columns = [
    ...config.inputs.map((input, i) => ({ name: withUnit(input.param, paramUnit(input.param)), values: design.points.slice(0, plain).map((p) => p[i]) })),
    { name: measuredLabel(model, config.observable, config.measure), values: values.slice(0, plain) },
  ];
  const notes = [
    ...provenance(model, { appVersion: io.appVersion, when: io.now(), uncertainty: { ...config, samples: design.n } }),
    `result: mean ${s.mean}, standard deviation ${s.sd}, median ${s.median}, 68% interval ${s.lo68} to ${s.hi68}, 95% interval ${s.lo95} to ${s.hi95}, from ${s.count} runs`,
    ...(sobol?.indices ?? []).map((x, i) => `sensitivity to ${config.inputs[i].param}: first-order ${x.first.toFixed(4)} (95% interval ${x.firstLo.toFixed(4)} to ${x.firstHi.toFixed(4)}), total ${x.total.toFixed(4)} (${x.totalLo.toFixed(4)} to ${x.totalHi.toFixed(4)})`),
  ];
  emit(toCsv(columns, notes), options, io, `${values.length} runs`);
  if (s.failed) io.err(`${s.failed} of ${plain} sampled runs gave no measurement and are left out of the summary.\n`);
  return 0;
}

function check(model: OdeModel, io: CliIo): ExitCode {
  const result = simulate(model);
  const lines = [model.name || 'Untitled simulation'];
  if (result.error) {
    lines.push(`  run: FAILED — ${result.error}`);
    io.out(`${lines.join('\n')}\n`);
    return 1;
  }
  lines.push(`  run: ok — ${result.stats?.steps ?? 0} steps, ended at t = ${result.t[result.t.length - 1]}`);
  const expectations = checkExpectations(model, result);
  const failed = expectations.filter((e) => !e.pass);
  lines.push(expectations.length
    ? `  expectations: ${expectations.length - failed.length} of ${expectations.length} hold`
    : '  expectations: none defined');
  for (const e of expectations) lines.push(`    ${e.pass ? 'ok  ' : 'FAIL'} ${e.text} (actual ${e.actual})`);
  const findings = checkModel(model, result);
  lines.push(findings.length ? `  model check: ${findings.length} ${findings.length === 1 ? 'thing' : 'things'} to look at` : '  model check: nothing to look at');
  for (const f of findings) lines.push(`    ${f.level === 'warn' ? 'warning' : 'note   '} ${f.where} ${f.message}`);
  io.out(`${lines.join('\n')}\n`);
  return failed.length ? 1 : 0;
}

function template(name: string | undefined, options: Record<string, string[]>, io: CliIo): ExitCode {
  if (!name) {
    io.out(`${MODELS.map((m) => `${m.id.padEnd(12)} ${m.name}`).join('\n')}\n`);
    return 0;
  }
  const model = MODELS.find((m) => m.id === name);
  if (!model) throw new UsageError(`There is no template “${name}”. The templates are: ${MODELS.map((m) => m.id).join(', ')}.`);
  emit(simFile(model, io.fileFormat, io.appVersion), options, io, `the “${model.name}” template`);
  return 0;
}

/** Carry out one command line. Never throws: problems are reported on `io.err` and in the exit code. */
export function runCli(argv: string[], io: CliIo): ExitCode {
  try {
    const { command, file, options } = parseArgs(argv);
    if (options.version) { io.out(`${APP_NAME} ${io.appVersion}\n`); return 0; }
    if (options.help || command === 'help' || !command) { io.out(USAGE); return command || options.help ? 0 : 2; }
    if (command === 'template') return template(file, options, io);
    if (!['run', 'experiment', 'uncertainty', 'check'].includes(command)) throw new UsageError(`Unknown command “${command}”. The commands are run, experiment, uncertainty, check and template.`);
    const model = loadModel(file, options, io);
    if (command === 'run') return run(model, options, io);
    if (command === 'experiment') return experiment(model, options, io);
    if (command === 'uncertainty') return uncertainty(model, options, io);
    return check(model, io);
  } catch (err) {
    if (err instanceof UsageError) {
      io.err(`${err.message}\nRun with --help for the list of commands and options.\n`);
      return 2;
    }
    io.err(`Something went wrong: ${err instanceof Error ? err.message : err}\n`);
    return 1;
  }
}

/** The words that start a command line, as opposed to a document to open in the window. */
export const COMMANDS = ['run', 'experiment', 'uncertainty', 'check', 'template', 'help', '--help', '--version'];
