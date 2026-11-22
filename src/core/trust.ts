/**
 * Tools for deciding how far a result can be trusted: comparing two runs,
 * checking that a run has converged, testing a run against stated
 * expectations, and recording what produced a result.
 */
import { interpolate } from './fit';
import { MEASURES, measureRun } from './measure';
import { simulate, type Expectation, type OdeModel, type ScanConfig, type SimResult, type SolverMethod, type UncertaintyConfig } from './ode';

// ------------------------------------------------------------ comparing runs

export interface Difference {
  name: string;
  /** Largest absolute difference. */
  worst: number;
  /** Size of the quantity (its range, or its magnitude if it barely varies). */
  scale: number;
  /** Time at which the largest difference occurs. */
  at: number;
}

/**
 * Largest difference per quantity between two runs, measured at the second
 * run's sample times with the first interpolated onto them. Samples at the
 * instant of a discontinuity are skipped, since the two may sit on opposite
 * sides of the jump.
 */
export function compareRuns(a: SimResult, b: SimResult): { rows: Difference[]; missing: string[] } {
  const rows: Difference[] = [];
  const missing: string[] = [];
  const jumps = [...(a.eventTimes ?? []), ...(b.eventTimes ?? [])];
  const tLast = Math.min(a.t[a.t.length - 1] ?? 0, b.t[b.t.length - 1] ?? 0);
  for (const [name, values] of Object.entries(b.series)) {
    const mine = a.series[name];
    if (!mine) { missing.push(name); continue; }
    const scale = Math.max(Math.max(...mine) - Math.min(...mine), Math.max(...mine.map(Math.abs)), 1e-300);
    let worst = 0, at = 0;
    b.t.forEach((t, i) => {
      if (t > tLast || jumps.some((te) => Math.abs(te - t) < 1e-3 * Math.max(1, Math.abs(te)))) return;
      const d = Math.abs(interpolate(a.t, mine, t) - values[i]);
      if (Number.isFinite(d) && d > worst) { worst = d; at = t; }
    });
    rows.push({ name, worst, scale, at });
  }
  return { rows, missing };
}

// ------------------------------------------------------------- convergence

export interface AccuracyCheck {
  /** What was changed for the comparison run. */
  label: string;
  rows: Difference[];
  /** The comparison run failed. */
  error?: string;
  /** Integration steps the comparison run needed. */
  steps?: number;
  /** Largest relative difference measured the other way round (at this run's sample times). */
  reverse?: number;
}

export interface AccuracyReport {
  /** Re-run with a tighter tolerance (adaptive) or half the step (fixed). */
  refined: AccuracyCheck;
  /** Re-run with a different integration method. */
  crossMethod: AccuracyCheck;
  /** Largest relative change across both checks. */
  worst: number;
  /**
   * Set when the other adaptive method reached the same answer in far fewer steps —
   * measured evidence about stiffness, one way or the other.
   */
  faster?: { method: SolverMethod; label: string; ratio: number };
  /** True when the change grows towards the end of the run — the signature of sensitive (chaotic) dynamics. */
  growing: boolean;
}

const ADAPTIVE: SolverMethod[] = ['rk45', 'ros23'];
const METHOD_LABEL: Record<SolverMethod, string> = { rk45: 'RK45', ros23: 'Rosenbrock23', rk4: 'RK4', euler: 'Euler' };

/**
 * How much does the answer move when the numerics are tightened, or the method
 * changed? A result that does not move is converged; one that does is not yet
 * telling you about the model.
 */
export function accuracyReport(model: OdeModel, run: SimResult): AccuracyReport {
  const method = model.method ?? 'rk4';
  const adaptive = ADAPTIVE.includes(method);
  const tol = model.tol && model.tol > 0 ? model.tol : method === 'ros23' ? 1e-6 : 1e-8;

  const refinedModel: OdeModel = adaptive ? { ...model, tol: tol / 100 } : { ...model, dt: model.dt / 2 };
  const refinedLabel = adaptive ? `tolerance tightened from ${tol} to ${tol / 100}` : `step halved from ${model.dt} to ${model.dt / 2}`;
  const other: SolverMethod = method === 'rk45' ? 'ros23' : 'rk45';
  const crossModel: OdeModel = { ...model, method: other, tol: adaptive ? tol : 1e-9 };
  const crossLabel = `${METHOD_LABEL[method]} against ${METHOD_LABEL[other]}`;

  const check = (m: OdeModel, label: string): AccuracyCheck => {
    const r = simulate(m);
    if (r.error) return { label, rows: [], error: r.error };
    return { label, rows: compareRuns(run, r).rows, steps: r.stats?.steps, reverse: Math.max(0, ...compareRuns(r, run).rows.map((d) => d.worst / d.scale)) };
  };
  const refined = check(refinedModel, refinedLabel);
  const crossMethod = check(crossModel, crossLabel);
  const all = [...refined.rows, ...crossMethod.rows];
  const worstRow = all.reduce<Difference | null>((w, r) => (!w || r.worst / r.scale > w.worst / w.scale ? r : w), null);
  const tLast = run.t[run.t.length - 1] ?? 0;
  // Only a like-for-like comparison of adaptive methods that agree says anything about efficiency.
  // A run thinned for display cannot resolve a feature narrower than its sample spacing (the
  // initial layer of a stiff system), so agreement is judged at whichever sampling is kinder.
  const crossWorst = Math.min(Math.max(0, ...crossMethod.rows.map((r) => r.worst / r.scale)), crossMethod.reverse ?? Infinity);
  const mine = run.stats?.steps ?? 0;
  const faster = adaptive && !crossMethod.error && crossWorst < 1e-3 && crossMethod.steps && mine / crossMethod.steps > 3
    ? { method: other, label: METHOD_LABEL[other], ratio: mine / crossMethod.steps }
    : undefined;
  return {
    refined,
    crossMethod,
    faster,
    worst: worstRow ? worstRow.worst / worstRow.scale : 0,
    // Slow phase drift also peaks late, so only a substantial late disagreement counts.
    growing: !!worstRow && worstRow.worst / worstRow.scale > 1e-2 && worstRow.at > 0.8 * tLast,
  };
}

// ------------------------------------------------------------- expectations

export interface ExpectationResult {
  expectation: Expectation;
  actual: number;
  pass: boolean;
  /** Plain-language statement of the expectation. */
  text: string;
}

const COMPARE_TEXT = { equals: '=', atMost: '≤', atLeast: '≥' } as const;

export function describeExpectation(e: Expectation): string {
  const m = MEASURES.find((x) => x.id === e.measure)?.label.toLowerCase() ?? e.measure;
  const tol = e.compare === 'equals' ? ` ± ${e.tolerance ?? 0}` : '';
  return `${m} of ${e.observable} ${COMPARE_TEXT[e.compare]} ${e.value}${tol}`;
}

export function checkExpectations(model: OdeModel, run: SimResult): ExpectationResult[] {
  return (model.expectations ?? []).map((e) => {
    const actual = measureRun(run, e.observable, e.measure);
    const pass = Number.isFinite(actual) && (
      e.compare === 'equals' ? Math.abs(actual - e.value) <= Math.abs(e.tolerance ?? 0)
        : e.compare === 'atMost' ? actual <= e.value
          : actual >= e.value);
    return { expectation: e, actual, pass, text: describeExpectation(e) };
  });
}

// --------------------------------------------------------------- provenance

/** Short, stable fingerprint of a string (FNV-1a, 64 bits as two 32-bit halves). Identification, not security. */
export function fingerprint(text: string): string {
  let h1 = 0x811c9dc5, h2 = 0xcbf29ce4;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ (c + i), 0x01000193);
  }
  return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0'));
}

/** The parts of a model that determine its numbers, in a fixed order. */
export function modelEssence(model: OdeModel): string {
  return JSON.stringify([
    model.states.map((s) => [s.name, s.init, s.deriv]),
    model.params.map((p) => [p.name, p.value]),
    model.derived.map((d) => [d.name, d.expr]),
    (model.events ?? []).map((e) => [e.when, e.then]),
    model.stopWhen ?? '', model.tEnd, model.method ?? 'rk4', model.method === 'rk45' || model.method === 'ros23' ? model.tol ?? null : model.dt,
  ]);
}

export interface ProvenanceOptions {
  appVersion: string;
  /** ISO timestamp; injected so output is reproducible in tests. */
  when: string;
  run?: SimResult;
  experiment?: ScanConfig;
  uncertainty?: UncertaintyConfig;
  /** Parameter values that differ from the model's for this output. */
  overrides?: Record<string, number>;
}

/** Everything needed to say what produced a result, as lines for a file header. */
export function provenance(model: OdeModel, o: ProvenanceOptions): string[] {
  const method = model.method ?? 'rk4';
  const adaptive = method === 'rk45' || method === 'ros23';
  const lines = [
    `Physics Tooling ${o.appVersion} — exported ${o.when}`,
    `model: ${model.name || 'Untitled simulation'} (fingerprint ${fingerprint(modelEssence(model))})`,
    `solver: ${METHOD_LABEL[method]}, ${adaptive ? `relative tolerance ${model.tol ?? (method === 'ros23' ? 1e-6 : 1e-8)}` : `step ${model.dt}`}, duration ${model.tEnd}`,
    `parameters: ${model.params.map((p) => `${p.name} = ${o.overrides?.[p.name] ?? p.value}${p.unit ? ` ${p.unit}` : ''}`).join('; ') || 'none'}`,
    ...model.states.map((s) => `state ${s.name}: initial ${s.init}; rate ${s.deriv}`),
    ...model.derived.map((d) => `observable ${d.name} = ${d.expr}`),
    ...(model.events ?? []).filter((e) => e.when.trim()).map((e) => `event: when ${e.when} then ${e.then}`),
    ...(model.stopWhen ? [`stop when: ${model.stopWhen}`] : []),
  ];
  if (o.run?.stats) lines.push(`run: ${o.run.stats.steps} steps, ${o.run.stats.evals} evaluations, ${o.run.stats.events} events, ${o.run.t.length} samples`);
  if (o.experiment) {
    const e = o.experiment;
    lines.push(`experiment: ${e.measure} of ${e.observable} for ${e.param} from ${e.from} to ${e.to} in ${e.points} steps${e.param2 ? `, and ${e.param2} from ${e.from2} to ${e.to2} in ${e.points2} steps` : ''}`);
  }
  if (o.uncertainty) {
    const u = o.uncertainty;
    lines.push(`uncertainty analysis: ${u.measure} of ${u.observable}; Latin hypercube, base sample ${u.samples}, seed ${u.seed}`);
    for (const i of u.inputs) lines.push(`uncertain ${i.param}: ${i.dist === 'normal' ? `normal, mean ${i.a}, standard deviation ${i.b}` : `uniform from ${i.a} to ${i.b}`}`);
  }
  return lines;
}
