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

/** One measured series to match: an observable of the model against data, optionally with error bars. */
export interface FitTarget {
  observable: string;
  t: number[];
  y: number[];
  /** One-standard-deviation measurement errors, one per point. */
  sigma?: number[];
}

export interface FitRequest {
  model: OdeModel;
  /** Names of the parameters allowed to vary. */
  params: string[];
  targets: FitTarget[];
  /** Keep each fitted parameter inside its declared [min, max] range. */
  bounded?: boolean;
  /**
   * Survey each parameter's declared range before refining (default true).
   * Oscillating data give the misfit many local minima, so a purely local
   * search from a poor guess can lock onto the wrong one.
   */
  survey?: boolean;
}

export interface FitResult {
  values: Record<string, number>;
  /** One-standard-deviation uncertainties from the local linearisation (NaN if undetermined). */
  errors: Record<string, number>;
  /** Correlation matrix of the fitted parameters, in the order of `values`. */
  correlation: number[][];
  /** Fit quality per target, before and after. */
  targets: { observable: string; before: Residuals; after: Residuals }[];
  /** χ² per degree of freedom — only when every target came with error bars. */
  reducedChi2?: number;
  evals: number;
  converged: boolean;
}

/** Invert a small symmetric matrix by Gauss–Jordan elimination; null if (numerically) singular. */
export function invert(a: number[][]): number[][] | null {
  const n = a.length;
  const m = a.map((row, i) => [...row, ...row.map((_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    const scale = Math.max(...a.map((row) => Math.max(...row.map(Math.abs))), 1e-300);
    if (!(Math.abs(m[p][c]) > 1e-12 * scale)) return null;
    [m[c], m[p]] = [m[p], m[c]];
    const piv = m[c][c];
    for (let q = 0; q < 2 * n; q++) m[c][q] /= piv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = m[r][c];
      if (k !== 0) for (let q = 0; q < 2 * n; q++) m[r][q] -= k * m[c][q];
    }
  }
  return m.map((row) => row.slice(n));
}

export function fitModel({ model, params, targets, bounded, survey = true }: FitRequest): FitResult {
  const chosen = model.params.filter((p) => params.includes(p.name));
  if (!chosen.length) throw new Error('Choose at least one parameter to fit');
  if (!targets.length) throw new Error('Choose at least one measured series to fit');
  const points = targets.reduce((s, t) => s + t.t.length, 0);
  if (points < chosen.length + 1) throw new Error('Not enough data points for that many parameters');

  // Weights: the supplied error bars; otherwise each series is scaled by its own spread
  // when several are fitted together, so that quantities in different units count equally.
  const hasSigma = targets.every((t) => !!t.sigma && t.sigma.length === t.t.length && t.sigma.every((v) => v > 0));
  const spread = (y: number[]) => {
    const m = y.reduce((a, v) => a + v, 0) / y.length;
    return Math.sqrt(y.reduce((a, v) => a + (v - m) ** 2, 0) / y.length) || 1;
  };
  const weights = targets.map((t) => (hasSigma ? t.sigma!.map((v) => 1 / v) : t.t.map(() => (targets.length > 1 ? 1 / spread(t.y) : 1))));

  // The run only needs to cover the measured interval.
  const tMax = Math.max(...targets.flatMap((t) => t.t));
  const base: OdeModel = { ...model, tEnd: Math.max(tMax * 1.0001, model.dt * 2), stopWhen: undefined };
  const evaluate = (x: number[]) => {
    const run = simulate(base, Object.fromEntries(chosen.map((p, i) => [p.name, x[i]])));
    return targets.map((t) => residuals(run, t.observable, t));
  };
  /** Weighted residual vector across all targets (NaN where the run has no value). */
  const weighted = (rs: Residuals[]) => rs.flatMap((r, k) => targets[k].t.map((_, i) => (r.residuals[i] ?? NaN) * weights[k][i]));
  const misfit = (rs: Residuals[]) => {
    let ss = 0, used = 0;
    for (const v of weighted(rs)) if (Number.isFinite(v)) { ss += v * v; used++; }
    return { ss, used };
  };

  const x0 = chosen.map((p) => p.value);
  const before = evaluate(x0);
  before.forEach((r, k) => { if (!r.used) throw new Error(`The run produced no values of "${targets[k].observable}" at the measured times`); });
  const usedBefore = misfit(before).used;
  const scale = chosen.map((p) => (p.value !== 0 ? Math.abs(p.value) * 0.1 : (p.max - p.min) * 0.05 || 0.1));
  const outside = (x: number[]) => !!bounded && x.some((v, i) => v < chosen[i].min || v > chosen[i].max);
  // Penalise runs that fail to cover some of the data so the optimiser stays in the valid region.
  const cost = (x: number[]) => {
    if (outside(x)) return Infinity;
    const m = misfit(evaluate(x));
    return m.used < usedBefore ? Infinity : Math.sqrt(m.ss / m.used);
  };

  // Stage 1 — survey: a grid over the declared ranges (one or two parameters), or
  // line scans along each axis in turn (more), to choose the basin to refine in.
  let start = x0;
  let startCost = cost(x0);
  let surveyEvals = 0;
  const tryPoint = (x: number[]) => {
    surveyEvals++;
    const c = cost(x);
    if (c < startCost) { startCost = c; start = x; }
  };
  if (survey && chosen.every((c) => c.max > c.min)) {
    const grid = (c: (typeof chosen)[number], n: number) => Array.from({ length: n }, (_, i) => c.min + ((c.max - c.min) * (i + 0.5)) / n);
    if (chosen.length === 1) {
      for (const a of grid(chosen[0], 60)) tryPoint([a]);
    } else if (chosen.length === 2) {
      for (const a of grid(chosen[0], 16)) for (const b of grid(chosen[1], 16)) tryPoint([a, b]);
    } else {
      for (let pass = 0; pass < 2; pass++) {
        chosen.forEach((c, j) => { for (const a of grid(c, 30)) tryPoint(start.map((v, k) => (k === j ? a : v))); });
      }
    }
  }
  // Stage 2 — refine. After a survey the simplex starts at the grid spacing, not at 10% of the value.
  const refineScale = start === x0 ? scale : chosen.map((c, i) => Math.min(scale[i] || Infinity, (c.max - c.min) / 40) || scale[i]);
  let best = nelderMead(cost, start, refineScale, 150 + 120 * chosen.length);
  // One restart from the solution guards against a prematurely collapsed simplex.
  const again = nelderMead(cost, best.x, best.x.map((v, i) => (v !== 0 ? Math.abs(v) * 0.03 : scale[i] * 0.3)), 100 + 60 * chosen.length);
  const evals = best.evals + again.evals + surveyEvals;
  if (again.fx <= best.fx) best = again;
  const after = evaluate(best.x);

  // Uncertainties from the linearised problem. With error bars the covariance is (JᵀJ)⁻¹ of the
  // weighted residuals; without, it is scaled by the residual variance s².
  const p = chosen.length;
  const w0 = weighted(after);
  const mask = w0.map(Number.isFinite);
  const N = mask.filter(Boolean).length;
  const ss = w0.reduce((a, v) => (Number.isFinite(v) ? a + v * v : a), 0);
  const errors: Record<string, number> = Object.fromEntries(chosen.map((c) => [c.name, NaN]));
  let correlation: number[][] = chosen.map((_, i) => chosen.map((__, j) => (i === j ? 1 : NaN)));
  if (N > p) {
    const Jc = chosen.map((_, j) => {
      const step = 1e-4 * Math.max(Math.abs(best.x[j]), scale[j] * 0.1, 1e-12);
      const up = weighted(evaluate(best.x.map((v, k) => (k === j ? v + step : v))));
      const dn = weighted(evaluate(best.x.map((v, k) => (k === j ? v - step : v))));
      return w0.map((_, i) => (mask[i] && Number.isFinite(up[i]) && Number.isFinite(dn[i]) ? (up[i] - dn[i]) / (2 * step) : 0));
    });
    const JTJ = chosen.map((_, i) => chosen.map((__, j) => Jc[i].reduce((sum, v, k) => sum + v * Jc[j][k], 0)));
    const inv = invert(JTJ);
    const s2 = hasSigma ? 1 : ss / (N - p);
    if (inv && inv.every((row, i) => row[i] > 0)) {
      chosen.forEach((c, i) => { errors[c.name] = Math.sqrt(s2 * inv[i][i]); });
      correlation = inv.map((row, i) => row.map((v, j) => v / Math.sqrt(inv[i][i] * inv[j][j])));
    }
  }

  return {
    values: Object.fromEntries(chosen.map((c, i) => [c.name, best.x[i]])),
    errors,
    correlation,
    targets: targets.map((t, k) => ({ observable: t.observable, before: before[k], after: after[k] })),
    reducedChi2: hasSigma && N > p ? ss / (N - p) : undefined,
    evals: evals + 2 * p + 1,
    converged: best.converged,
  };
}
