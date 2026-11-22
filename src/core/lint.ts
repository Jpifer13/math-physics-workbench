/**
 * "Check my model": likely mistakes that are not errors. The model runs, but
 * something in it does nothing, or cannot do what it appears to. Each finding
 * says what was noticed and why it matters, and never blocks a run.
 */
import { parse, type MathNode } from 'mathjs';
import { compileFast } from './fastExpr';
import type { OdeModel, SimResult } from './ode';
import { REFERENCE } from './reference';

export interface Finding {
  /** 'warn': probably a mistake. 'note': worth knowing, often intended. */
  level: 'warn' | 'note';
  /** The part of the model it is about, e.g. "parameter k", "event 2". */
  where: string;
  message: string;
}

/** Names an expression reads, leaving out the functions it calls. Null if the text does not parse. */
export function namesIn(expr: string): Set<string> | null {
  const out = new Set<string>();
  if (!expr.trim()) return out;
  let tree: MathNode;
  try {
    tree = parse(expr);
  } catch {
    return null;
  }
  tree.traverse((node, path, parent) => {
    const n = node as { type: string; name?: string };
    if (n.type === 'SymbolNode' && !(path === 'fn' && (parent as { type?: string } | null)?.type === 'FunctionNode')) out.add(n.name!);
  });
  return out;
}

/** The assignments of an event's "then": [state, expression] pairs. */
const assignments = (then: string): [string, string][] =>
  then.split(/[;\n]/).map((a) => a.trim()).filter(Boolean).flatMap((a) => {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)\s*(.+)$/.exec(a);
    return m ? [[m[1], m[2]] as [string, string]] : [];
  });

/** Edit distance, for "did you mean". */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

const BUILT_IN = new Set(['t', 'Infinity', 'NaN', 'true', 'false', ...REFERENCE.filter((r) => r.kind === 'constant').map((r) => r.name)]);

/**
 * Look a model over for likely mistakes. With the model's run, also checks
 * what only a run can show: events and stop conditions that never happened.
 */
export function checkModel(model: OdeModel, run?: SimResult): Finding[] {
  const out: Finding[] = [];
  const states = model.states.map((s) => s.name);
  const params = model.params.map((p) => p.name);
  const derived = model.derived.map((d) => d.name);
  const known = new Set([...states, ...params, ...derived]);
  const events = (model.events ?? []).filter((e) => e.when.trim());

  // Every expression in the model, with where it sits.
  const exprs: { where: string; text: string }[] = [
    ...model.states.flatMap((s) => [{ where: `initial value of ${s.name}`, text: s.init }, { where: `rate of ${s.name}`, text: s.deriv }]),
    ...model.derived.map((d) => ({ where: `observable ${d.name}`, text: d.expr })),
    ...events.flatMap((e, i) => [{ where: `event ${i + 1}`, text: e.when }, ...assignments(e.then).map(([, rhs]) => ({ where: `event ${i + 1}`, text: rhs }))]),
    ...(model.stopWhen?.trim() ? [{ where: 'stop condition', text: model.stopWhen }] : []),
  ];
  const used = new Set<string>();
  for (const e of exprs) {
    const names = namesIn(e.text);
    if (!names) continue; // The run reports what does not parse.
    for (const n of names) {
      used.add(n);
      if (known.has(n) || BUILT_IN.has(n)) continue;
      // A misspelling is close to a name the model does define.
      const near = [...known].map((k) => [k, distance(n.toLowerCase(), k.toLowerCase())] as const).filter(([k, d]) => d <= Math.max(1, Math.floor(k.length / 3))).sort((a, b) => a[1] - b[1])[0];
      out.push({ level: 'warn', where: e.where, message: `uses “${n}”, which the model does not define.${near ? ` Did you mean “${near[0]}”?` : ' Add it as a parameter, or check the spelling.'}` });
    }
  }

  for (const p of model.params) {
    if (!used.has(p.name)) out.push({ level: 'warn', where: `parameter ${p.name}`, message: 'is not used by any equation, so changing it does nothing.' });
    if (p.max > p.min && (p.value < p.min || p.value > p.max)) out.push({ level: 'note', where: `parameter ${p.name}`, message: `is set to ${p.value}, outside its range of ${p.min} to ${p.max}. Experiments and fits that use the range will not include it.` });
  }

  const reset = new Set(events.flatMap((e) => assignments(e.then).map(([name]) => name)));
  for (const s of model.states) {
    const names = namesIn(s.deriv);
    if (!names || names.size) continue;
    // No names at all: the rate is a plain number.
    const rate = compileFast(s.deriv, {})?.([]);
    // Often deliberate (a constant velocity), so a note rather than a warning.
    if (rate === 0 && !reset.has(s.name)) out.push({ level: 'note', where: `state ${s.name}`, message: 'has a rate of 0 and no event sets it, so it stays at its initial value throughout.' });
  }

  const varying = new Set(['t', ...states, ...derived]);
  const constant = new Set<number>();
  events.forEach((e, i) => {
    const where = `event ${i + 1}`;
    const names = namesIn(e.when);
    if (names && ![...names].some((n) => varying.has(n))) {
      constant.add(i);
      out.push({ level: 'warn', where, message: 'has a condition that depends only on parameters, so it cannot turn from false to true during a run and will never fire.' });
    }
    if (!assignments(e.then).length) out.push({ level: 'warn', where, message: 'sets nothing: its “then” is empty, so firing has no effect.' });
    for (const [name] of assignments(e.then)) {
      if (!states.includes(name)) out.push({ level: 'warn', where, message: `sets “${name}”, which is not a state variable. Only state variables can be reset.` });
    }
  });

  const method = model.method ?? 'rk4';
  if ((method === 'rk4' || method === 'euler') && model.dt > 0 && model.tEnd / model.dt < 50) {
    out.push({ level: 'warn', where: 'solver', message: `takes only ${Math.max(1, Math.round(model.tEnd / model.dt))} steps over the run. A smaller step, or an adaptive method, will resolve the motion.` });
  }

  if (run && !run.error && run.t.length) {
    const ended = run.t[run.t.length - 1];
    // Which of several events fired is not recorded, so this is only certain when none did.
    if (events.length && run.stats?.events === 0) {
      const state = conditionOverRun(model, run);
      events.forEach((e, i) => {
        const truth = constant.has(i) ? null : state(e.when);
        if (!truth) return;
        const where = `event ${i + 1}`;
        if (truth.every(Boolean)) out.push({ level: 'warn', where, message: 'has a condition that is already true at the start and stays true, so it never turns true and never fires. An event fires on the change from false to true.' });
        else if (!truth.some(Boolean)) out.push({ level: 'note', where, message: `did not fire: its condition was never true in this run of ${ended.toPrecision(4)} time units.` });
      });
    }
    if (model.stopWhen?.trim()) {
      if (run.t.length <= 2 && ended < model.tEnd * 1e-6) out.push({ level: 'warn', where: 'stop condition', message: 'is true from the start, so the run ends immediately.' });
      else if (ended >= model.tEnd * (1 - 1e-9)) out.push({ level: 'note', where: 'stop condition', message: `was not met: the run went the full duration of ${model.tEnd}.` });
    }
  }
  return out;
}

/** Evaluate a condition at (up to 400 of) the samples of a run. */
function conditionOverRun(model: OdeModel, run: SimResult) {
  const names = ['t', ...model.params.map((p) => p.name), ...Object.keys(run.series)];
  const slot = Object.fromEntries(names.map((n, i) => [n, i]));
  const stride = Math.max(1, Math.ceil(run.t.length / 400));
  return (condition: string): boolean[] | null => {
    const f = compileFast(condition, slot);
    if (!f) return null;
    const values = new Float64Array(names.length);
    model.params.forEach((p, i) => { values[1 + i] = p.value; });
    const out: boolean[] = [];
    for (let k = 0; k < run.t.length; k += stride) {
      values[0] = run.t[k];
      Object.keys(run.series).forEach((n) => { values[slot[n]] = run.series[n][k]; });
      out.push(f(values) !== 0);
    }
    return out;
  };
}
