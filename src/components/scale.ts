import { fmtNum } from '../core/units';

export interface Scale {
  min: number;
  max: number;
  log: boolean;
  /** Map a data value to 0..1. */
  norm: (v: number) => number;
  invert: (u: number) => number;
  ticks: number[];
}

function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const r = raw / mag;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * mag;
}

export function makeScale(min: number, max: number, log: boolean, targetTicks = 6): Scale {
  if (!Number.isFinite(min) || !Number.isFinite(max)) [min, max] = [0, 1];
  if (log) {
    if (min <= 0 || max <= 0) log = false;
  }
  if (min === max) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
    min -= pad;
    max += pad;
    if (log && min <= 0) min = max / 100;
  }
  if (log) {
    const a = Math.log10(min);
    const b = Math.log10(max);
    const ticks: number[] = [];
    const stepDec = Math.max(1, Math.ceil((b - a) / targetTicks));
    for (let e = Math.ceil(a - 1e-9); e <= b + 1e-9; e += stepDec) ticks.push(10 ** e);
    return {
      min, max, log: true, ticks,
      norm: (v) => (Math.log10(v) - a) / (b - a),
      invert: (u) => 10 ** (a + u * (b - a)),
    };
  }
  const step = niceStep(max - min, targetTicks);
  const ticks: number[] = [];
  for (let t = Math.ceil(min / step - 1e-9) * step; t <= max + step * 1e-9; t += step) {
    ticks.push(Math.abs(t) < step * 1e-9 ? 0 : t);
  }
  return {
    min, max, log: false, ticks,
    norm: (v) => (v - min) / (max - min),
    invert: (u) => min + u * (max - min),
  };
}

/** Data extent that ignores non-finite values and tames runaway spikes (e.g. tan x). */
export function robustExtent(values: number[][], positiveOnly = false): [number, number] {
  const all: number[] = [];
  for (const arr of values) for (const v of arr) if (Number.isFinite(v) && (!positiveOnly || v > 0)) all.push(v);
  if (!all.length) return positiveOnly ? [0.1, 10] : [0, 1];
  all.sort((a, b) => a - b);
  let lo = all[0];
  let hi = all[all.length - 1];
  if (!positiveOnly && all.length > 50) {
    const p = (f: number) => all[Math.min(all.length - 1, Math.floor(f * all.length))];
    const core = p(0.95) - p(0.05);
    if (core > 0 && hi - lo > 25 * core) {
      lo = Math.max(lo, p(0.05) - core);
      hi = Math.min(hi, p(0.95) + core);
    }
  }
  return [lo, hi];
}

export function padExtent([lo, hi]: [number, number], log: boolean, frac = 0.06): [number, number] {
  if (log && lo > 0) return [lo / 1.25, hi * 1.25];
  if (lo === hi) return [lo, hi];
  const pad = (hi - lo) * frac;
  return [lo - pad, hi + pad];
}

export const tickLabel = (v: number): string => fmtNum(v, 4);
