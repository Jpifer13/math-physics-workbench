/**
 * Uncertainty propagation and global sensitivity analysis.
 *
 * Uncertain parameters are sampled together (Latin hypercube), so the whole
 * input space is explored rather than one axis at a time. The same runs give
 * the spread of a measurement and its Sobol indices: how much of the variance
 * each input explains on its own (first-order) and together with its
 * interactions (total). Design after Saltelli et al. (2010); the total-effect
 * estimator is Jansen's.
 */
import { measureRun } from './measure';
import { simulate, type MeasureId, type OdeModel, type UncertainInput, type UncertaintyConfig } from './ode';

export type { UncertainInput, UncertaintyConfig };

/** Small seeded generator (mulberry32): the same seed always draws the same design. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inverse of the standard normal distribution function (Acklam's rational approximation, relative error below 1.2e-9). */
export function probit(p: number): number {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low || p > 1 - low) {
    const q = Math.sqrt(-2 * Math.log(p < low ? p : 1 - p));
    const x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    return p < low ? x : -x;
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** n points in the unit cube of the given dimension, one in each of n equal slices along every axis. */
export function latinHypercube(n: number, dims: number, random: () => number): number[][] {
  const points = Array.from({ length: n }, () => new Array<number>(dims));
  const order = Array.from({ length: n }, (_, i) => i);
  for (let k = 0; k < dims; k++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let i = 0; i < n; i++) points[i][k] = (order[i] + random()) / n;
  }
  return points;
}

/** Map a uniform number in (0, 1) onto an input's distribution. */
export const inputValue = (input: UncertainInput, u: number): number =>
  input.dist === 'normal' ? input.a + input.b * probit(Math.min(1 - 1e-12, Math.max(1e-12, u))) : input.a + (input.b - input.a) * u;

/** Why an input cannot be sampled, in the user's terms; empty when it is fine. */
export function inputProblem(input: UncertainInput): string {
  if (!Number.isFinite(input.a) || !Number.isFinite(input.b)) return `${input.param}: both numbers are needed`;
  if (input.dist === 'normal') return input.b > 0 ? '' : `${input.param}: the standard deviation must be greater than zero`;
  return input.b > input.a ? '' : `${input.param}: “to” must be greater than “from”`;
}

export const sampleCount = (samples: number): number => Math.max(16, Math.min(4096, Math.round(samples) || 0));

/** Model runs an analysis makes: two base samples, plus one more per input when there is more than one. */
export const totalRuns = (samples: number, inputs: number): number => sampleCount(samples) * (inputs > 1 ? inputs + 2 : 2);

export interface Design {
  /** Base sample size. */
  n: number;
  inputs: UncertainInput[];
  /**
   * Parameter values for every run, in blocks of n: sample A, sample B, then
   * for each input i a copy of A with column i taken from B.
   */
  points: number[][];
}

/** The runs of an uncertainty analysis. A and B are halves of one Latin hypercube, so they are independent. */
export function makeDesign(inputs: UncertainInput[], samples: number, seed: number): Design {
  const n = sampleCount(samples);
  const d = inputs.length;
  const cube = latinHypercube(n, 2 * d, seededRandom(seed));
  const A = cube.map((u) => inputs.map((input, i) => inputValue(input, u[i])));
  const B = cube.map((u) => inputs.map((input, i) => inputValue(input, u[d + i])));
  const points = [...A, ...B];
  // With a single input, "A with that input from B" is B itself: nothing more to run.
  if (d > 1) for (let i = 0; i < d; i++) for (let j = 0; j < n; j++) points.push(A[j].map((v, k) => (k === i ? B[j][i] : v)));
  return { n, inputs, points };
}

export const overridesOf = (design: Design): Record<string, number>[] =>
  design.points.map((p) => Object.fromEntries(design.inputs.map((input, i) => [input.param, p[i]])));

export interface SobolIndex {
  /** Share of the variance explained by this input alone. */
  first: number;
  firstLo: number;
  firstHi: number;
  /** Share of the variance this input is involved in, interactions included. */
  total: number;
  totalLo: number;
  totalHi: number;
}

export interface SobolResult {
  indices: SobolIndex[];
  /** Sample rows used: those where every run gave a measurement. */
  rows: number;
  variance: number;
}

/**
 * Sobol indices from the measurements of a design, in the design's order, with
 * 95% intervals from resampling the rows. Returns null when there is nothing
 * to apportion: fewer than two inputs, too few usable rows, or no variation.
 */
export function sobolIndices(values: ArrayLike<number>, n: number, inputs: number, resamples = 200, seed = 1): SobolResult | null {
  if (inputs < 2 || values.length < n * (inputs + 2)) return null;
  const at = (block: number, j: number) => values[block * n + j];
  const rows: number[] = [];
  for (let j = 0; j < n; j++) {
    let ok = true;
    for (let b = 0; b < inputs + 2 && ok; b++) ok = Number.isFinite(at(b, j));
    if (ok) rows.push(j);
  }
  if (rows.length < 8) return null;

  const estimate = (pick: (k: number) => number) => {
    const count = rows.length;
    let sum = 0, squares = 0;
    for (let k = 0; k < count; k++) {
      const a = at(0, pick(k)), b = at(1, pick(k));
      sum += a + b;
      squares += a * a + b * b;
    }
    const mean = sum / (2 * count);
    const variance = squares / (2 * count) - mean * mean;
    const first: number[] = [], total: number[] = [];
    for (let i = 0; i < inputs; i++) {
      let s = 0, t = 0;
      for (let k = 0; k < count; k++) {
        const j = pick(k);
        const diff = at(i + 2, j) - at(0, j);
        s += (at(1, j) - mean) * diff;
        t += diff * diff;
      }
      first.push(s / count / variance);
      total.push(t / (2 * count) / variance);
    }
    return { mean, variance, first, total };
  };

  const base = estimate((k) => rows[k]);
  // Rounding leaves a variance of order eps·mean² when the measurement does not change at all.
  if (!(base.variance > 1e-24 * (base.mean * base.mean + 1e-300))) return null;

  const random = seededRandom(seed);
  const draws: { first: number[]; total: number[] }[] = [];
  const picked = new Array<number>(rows.length);
  for (let r = 0; r < resamples; r++) {
    for (let k = 0; k < rows.length; k++) picked[k] = rows[Math.floor(random() * rows.length)];
    const e = estimate((k) => picked[k]);
    if (e.variance > 0) draws.push(e);
  }
  const interval = (get: (e: { first: number[]; total: number[] }) => number, centre: number): [number, number] => {
    if (draws.length < 20) return [centre, centre];
    const sorted = draws.map(get).sort((x, y) => x - y);
    return [quantile(sorted, 0.025), quantile(sorted, 0.975)];
  };
  return {
    rows: rows.length,
    variance: base.variance,
    indices: base.first.map((first, i) => {
      const [firstLo, firstHi] = interval((e) => e.first[i], first);
      const [totalLo, totalHi] = interval((e) => e.total[i], base.total[i]);
      return { first, firstLo, firstHi, total: base.total[i], totalLo, totalHi };
    }),
  };
}

/** Quantile of values already sorted ascending, interpolating between neighbours. */
export function quantile(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (!n) return NaN;
  const pos = Math.min(n - 1, Math.max(0, q * (n - 1)));
  const lo = Math.floor(pos);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface Spread {
  /** Runs that gave a measurement. */
  count: number;
  failed: number;
  mean: number;
  sd: number;
  median: number;
  /** Central 68% and 95% intervals, read off the sample rather than assumed normal. */
  lo68: number;
  hi68: number;
  lo95: number;
  hi95: number;
  min: number;
  max: number;
}

/** Summary of a sample of measurements; non-finite values count as failed runs. */
export function spread(values: ArrayLike<number>): Spread {
  const ok = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  const count = ok.length;
  const mean = ok.reduce((s, v) => s + v, 0) / count;
  const sd = count > 1 ? Math.sqrt(ok.reduce((s, v) => s + (v - mean) ** 2, 0) / (count - 1)) : NaN;
  return {
    count, failed: values.length - count, mean, sd,
    median: quantile(ok, 0.5),
    lo68: quantile(ok, 0.16), hi68: quantile(ok, 0.84),
    lo95: quantile(ok, 0.025), hi95: quantile(ok, 0.975),
    min: count ? ok[0] : NaN, max: count ? ok[count - 1] : NaN,
  };
}

/** Counts of the finite values in equal-width bins; `edges` has one more entry than `counts`. */
export function histogram(values: ArrayLike<number>, bins?: number): { edges: number[]; counts: number[] } {
  const ok = Array.from(values).filter(Number.isFinite);
  if (!ok.length) return { edges: [], counts: [] };
  let lo = Infinity, hi = -Infinity;
  for (const v of ok) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (lo === hi) { const pad = lo === 0 ? 0.5 : Math.abs(lo) * 0.05; lo -= pad; hi += pad; }
  const k = Math.max(1, Math.round(bins ?? Math.min(40, Math.max(8, Math.sqrt(ok.length)))));
  const counts = new Array<number>(k).fill(0);
  for (const v of ok) counts[Math.min(k - 1, Math.floor(((v - lo) / (hi - lo)) * k))]++;
  return { edges: Array.from({ length: k + 1 }, (_, i) => lo + ((hi - lo) * i) / k), counts };
}

/** A series on `points + 1` evenly spaced times from 0 to tEnd; NaN where the run did not reach. */
export function resample(t: number[], y: number[], tEnd: number, points: number): number[] {
  const out = new Array<number>(points + 1).fill(NaN);
  const n = Math.min(t.length, y.length);
  if (!n) return out;
  const reach = t[n - 1] + 1e-9 * Math.abs(tEnd);
  let i = 0;
  for (let k = 0; k <= points; k++) {
    const g = (tEnd * k) / points;
    if (g < t[0] || g > reach) continue;
    while (i < n - 2 && t[i + 1] < g) i++;
    const j = Math.min(n - 1, i + 1);
    const span = t[j] - t[i];
    out[k] = span > 0 ? y[i] + ((y[j] - y[i]) * Math.min(1, Math.max(0, (g - t[i]) / span))) : y[j];
  }
  return out;
}

/**
 * Quantiles across an ensemble of resampled series, one value per time. A
 * time that fewer than half of the runs reached is left empty: a band drawn
 * from the survivors alone would misrepresent the ensemble.
 */
export function quantileBands(traces: ArrayLike<number>[], quantiles: number[]): number[][] {
  const length = traces[0]?.length ?? 0;
  const out = quantiles.map(() => new Array<number>(length).fill(NaN));
  const column: number[] = [];
  for (let k = 0; k < length; k++) {
    column.length = 0;
    for (const trace of traces) if (Number.isFinite(trace[k])) column.push(trace[k]);
    if (column.length < Math.max(2, traces.length / 2)) continue;
    column.sort((a, b) => a - b);
    quantiles.forEach((q, i) => { out[i][k] = quantile(column, q); });
  }
  return out;
}

/** An even time grid from 0 to `span` in `points` intervals. */
export interface TraceGrid { points: number; span: number }

/** One run of a design: the measurement and, when asked, the observable itself on an even time grid. */
export function runSample(
  model: OdeModel, overrides: Record<string, number>, observable: string, id: MeasureId, trace?: TraceGrid,
): { value: number; trace?: number[] } {
  const run = simulate(model, overrides);
  const value = measureRun(run, observable, id);
  const y = run.series[observable];
  if (!trace || run.error || !y) return { value };
  return { value, trace: resample(run.t, y, trace.span, trace.points) };
}
