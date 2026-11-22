/**
 * Fitting a model to measured data: CSV parsing, interpolation of a run onto
 * the measurement times, and a derivative-free least-squares optimiser.
 */
import { simulate, type OdeModel, type SimResult } from './ode';

export interface Column {
  name: string;
  values: number[];
}

/** Parse delimited numeric text (comma, semicolon, tab or whitespace), with or without a header row. */
export function parseTable(text: string): Column[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!lines.length) throw new Error('The file is empty');
  const delim = [',', ';', '\t'].find((d) => lines[0].includes(d));
  const split = (l: string) => (delim ? l.split(delim) : l.split(/\s+/)).map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
  const first = split(lines[0]);
  const hasHeader = first.some((c) => c === '' || !Number.isFinite(Number(c)));
  const names = hasHeader ? first.map((c, i) => c || `column ${i + 1}`) : first.map((_, i) => `column ${i + 1}`);
  const columns: Column[] = names.map((name) => ({ name, values: [] }));
  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    const cells = split(line);
    // In decimal-comma locales a semicolon-delimited file writes 1,5 for 1.5.
    const nums = names.map((_, i) => Number(delim === ';' ? (cells[i] ?? '').replace(',', '.') : cells[i] ?? ''));
    if (nums.every((v, i) => Number.isFinite(v) && (cells[i] ?? '') !== '')) nums.forEach((v, i) => columns[i].values.push(v));
  }
  if (columns.length < 2) throw new Error('Expected at least two columns (time and a measured quantity)');
  if (columns[0].values.length < 3) throw new Error('Found fewer than three complete numeric rows');
  return columns;
}

/** Linear interpolation of a sampled series at time `t` (NaN outside the sampled range). */
export function interpolate(times: number[], values: number[], t: number): number {
  const n = times.length;
  if (!n || t < times[0] - 1e-12 || t > times[n - 1] + 1e-12) return NaN;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  if (hi === lo || times[hi] === times[lo]) return values[lo];
  return values[lo] + ((values[hi] - values[lo]) * (t - times[lo])) / (times[hi] - times[lo]);
}

export interface Dataset {
  t: number[];
  y: number[];
}

export interface Residuals {
  /** Root-mean-square difference between model and data. */
  rms: number;
  /** Coefficient of determination. */
  r2: number;
  /** Data points the run covers. */
  used: number;
  residuals: number[];
}

export function residuals(run: SimResult, observable: string, data: Dataset): Residuals {
  const series = run.series[observable];
  const out: number[] = [];
  let ss = 0, used = 0, sum = 0;
  if (series && !run.error) {
    for (let i = 0; i < data.t.length; i++) {
      const m = interpolate(run.t, series, data.t[i]);
      const r = m - data.y[i];
      out.push(r);
      if (Number.isFinite(r)) { ss += r * r; sum += data.y[i]; used++; }
    }
  }
  if (!used) return { rms: Infinity, r2: NaN, used: 0, residuals: out };
  const mean = sum / used;
  let tot = 0;
  for (let i = 0; i < data.t.length; i++) if (Number.isFinite(out[i])) tot += (data.y[i] - mean) ** 2;
  return { rms: Math.sqrt(ss / used), r2: tot > 0 ? 1 - ss / tot : NaN, used, residuals: out };
}

export interface NelderMeadResult {
  x: number[];
  fx: number;
  iterations: number;
  evals: number;
  converged: boolean;
}

/** Nelder–Mead simplex minimiser. `scale[i]` sets the initial step along each axis. */
export function nelderMead(f: (x: number[]) => number, x0: number[], scale: number[], maxEvals = 400, tol = 1e-9): NelderMeadResult {
  const n = x0.length;
  let evals = 0;
  const F = (x: number[]) => { evals++; const v = f(x); return Number.isFinite(v) ? v : Infinity; };
  let simplex = [x0, ...x0.map((_, i) => x0.map((v, j) => (j === i ? v + scale[i] : v)))].map((x) => ({ x, f: F(x) }));
  let iterations = 0;
  let converged = false;
  while (evals < maxEvals) {
    simplex.sort((a, b) => a.f - b.f);
    const best = simplex[0], worst = simplex[n];
    if (Math.abs(worst.f - best.f) <= tol * (Math.abs(best.f) + tol)) { converged = true; break; }
    iterations++;
    const c = x0.map((_, j) => simplex.slice(0, n).reduce((s, p) => s + p.x[j], 0) / n);
    const along = (k: number) => c.map((v, j) => v + k * (worst.x[j] - v));
    const xr = along(-1); const fr = F(xr);
    if (fr < best.f) {
      const xe = along(-2); const fe = F(xe);
      simplex[n] = fe < fr ? { x: xe, f: fe } : { x: xr, f: fr };
    } else if (fr < simplex[n - 1].f) {
      simplex[n] = { x: xr, f: fr };
    } else {
      const xc = along(fr < worst.f ? -0.5 : 0.5); const fc = F(xc);
      if (fc < Math.min(fr, worst.f)) simplex[n] = { x: xc, f: fc };
      else simplex = simplex.map((p, i) => (i === 0 ? p : (() => { const x = p.x.map((v, j) => best.x[j] + 0.5 * (v - best.x[j])); return { x, f: F(x) }; })()));
    }
  }
  simplex.sort((a, b) => a.f - b.f);
  return { x: simplex[0].x, fx: simplex[0].f, iterations, evals, converged };
}

export interface FitRequest {
  model: OdeModel;
  /** Names of the parameters allowed to vary. */
  params: string[];
  observable: string;
  data: Dataset;
}

export interface FitResult {
  values: Record<string, number>;
  before: Residuals;
  after: Residuals;
  evals: number;
  converged: boolean;
}

/** Least-squares fit: adjust the chosen parameters so the observable best matches the data. */
export function fitModel({ model, params, observable, data }: FitRequest): FitResult {
  const chosen = model.params.filter((p) => params.includes(p.name));
  if (!chosen.length) throw new Error('Choose at least one parameter to fit');
  if (data.t.length < chosen.length + 1) throw new Error('Not enough data points for that many parameters');
  // The run only needs to cover the measured interval.
  const tMax = Math.max(...data.t);
  const base: OdeModel = { ...model, tEnd: Math.max(tMax * 1.0001, model.dt * 2), stopWhen: undefined };
  const evaluate = (x: number[]) => residuals(simulate(base, Object.fromEntries(chosen.map((p, i) => [p.name, x[i]]))), observable, data);
  const x0 = chosen.map((p) => p.value);
  const before = evaluate(x0);
  if (!before.used) throw new Error(`The run produced no values of "${observable}" at the measured times`);
  const scale = chosen.map((p) => (p.value !== 0 ? Math.abs(p.value) * 0.1 : (p.max - p.min) * 0.05 || 0.1));
  // Penalise runs that fail to cover some of the data so the optimiser stays in the valid region.
  const cost = (x: number[]) => { const r = evaluate(x); return r.used < before.used ? Infinity : r.rms; };
  let best = nelderMead(cost, x0, scale, 150 + 120 * chosen.length);
  // One restart from the solution guards against a prematurely collapsed simplex.
  const again = nelderMead(cost, best.x, best.x.map((v, i) => (v !== 0 ? Math.abs(v) * 0.03 : scale[i] * 0.3)), 100 + 60 * chosen.length);
  const evals = best.evals + again.evals;
  if (again.fx <= best.fx) best = again;
  return {
    values: Object.fromEntries(chosen.map((p, i) => [p.name, best.x[i]])),
    before,
    after: evaluate(best.x),
    evals,
    converged: best.converged,
  };
}
