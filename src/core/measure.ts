/**
 * Virtual-experiment tooling: reduce a simulated run to a single measured
 * number, and scan a parameter to see how that measurement responds.
 */
import { simulate, type MeasureId, type OdeModel, type ScanConfig, type SimResult } from './ode';

export type { MeasureId, ScanConfig };

export interface MeasureDef {
  id: MeasureId;
  label: string;
  hint: string;
  /** True when the result is a time, whatever the observable's unit. */
  isTime?: boolean;
}

export const MEASURES: readonly MeasureDef[] = [
  { id: 'final', label: 'Final value', hint: 'Value at the end of the run' },
  { id: 'max', label: 'Maximum', hint: 'Largest value reached' },
  { id: 'min', label: 'Minimum', hint: 'Smallest value reached' },
  { id: 'mean', label: 'Time average', hint: 'Mean over the run, weighted by time' },
  { id: 'rms', label: 'RMS', hint: 'Root-mean-square over the run' },
  { id: 'amplitude', label: 'Steady amplitude', hint: 'Half the peak-to-peak range over the last third of the run' },
  { id: 'period', label: 'Period', hint: 'Mean time between upward crossings of the average value', isTime: true },
  { id: 'tmax', label: 'Time of maximum', hint: 'When the largest value occurs', isTime: true },
  { id: 'duration', label: 'Run duration', hint: 'Time at which the run ended (useful with a stop condition)', isTime: true },
];

/** Time-weighted integral of g(y) by the trapezoid rule (samples may be unevenly spaced). */
function integral(t: number[], y: number[], g: (v: number) => number): number {
  let s = 0;
  for (let i = 1; i < t.length; i++) s += 0.5 * (g(y[i]) + g(y[i - 1])) * (t[i] - t[i - 1]);
  return s;
}

export function measure(t: number[], y: number[], id: MeasureId): number {
  const n = Math.min(t.length, y.length);
  if (!n) return NaN;
  const span = t[n - 1] - t[0];
  switch (id) {
    case 'final':
      return y[n - 1];
    case 'duration':
      return t[n - 1];
    case 'max':
      return Math.max(...y);
    case 'min':
      return Math.min(...y);
    case 'tmax': {
      let k = 0;
      for (let i = 1; i < n; i++) if (y[i] > y[k]) k = i;
      return t[k];
    }
    case 'mean':
      return span > 0 ? integral(t, y, (v) => v) / span : y[0];
    case 'rms':
      return span > 0 ? Math.sqrt(integral(t, y, (v) => v * v) / span) : Math.abs(y[0]);
    case 'amplitude': {
      const from = t[0] + (span * 2) / 3;
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < n; i++) if (t[i] >= from) { lo = Math.min(lo, y[i]); hi = Math.max(hi, y[i]); }
      return (hi - lo) / 2;
    }
    case 'period': {
      const mean = span > 0 ? integral(t, y, (v) => v) / span : y[0];
      const crossings: number[] = [];
      for (let i = 1; i < n; i++) {
        const a = y[i - 1] - mean;
        const b = y[i] - mean;
        // Linear interpolation pins the crossing time between samples.
        if (a < 0 && b >= 0) crossings.push(t[i - 1] + ((t[i] - t[i - 1]) * -a) / (b - a));
      }
      if (crossings.length < 2) return NaN;
      return (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1);
    }
  }
}

export interface ScanResult {
  x: number[];
  y: number[];
  /** Number of runs that failed (shown as gaps). */
  failed: number;
}

export const scanValues = (c: ScanConfig): number[] => {
  const n = Math.max(2, Math.min(400, Math.round(c.points)));
  return Array.from({ length: n }, (_, i) => c.from + ((c.to - c.from) * i) / (n - 1));
};

export function measureRun(run: SimResult, observable: string, id: MeasureId): number {
  const y = observable === 't' ? run.t : run.series[observable];
  if (run.error || !y) return NaN;
  return measure(run.t, y, id);
}

/** Run the model with some parameters overridden and reduce the run to one number. */
export function measureAt(model: OdeModel, overrides: Record<string, number>, observable: string, id: MeasureId): number {
  return measureRun(simulate(model, overrides), observable, id);
}

/** Values of the second parameter of a 2-D experiment. */
export const scanValues2 = (c: ScanConfig): number[] => {
  const n = Math.max(2, Math.min(120, Math.round(c.points2 ?? 21)));
  const a = c.from2 ?? 0;
  const b = c.to2 ?? 1;
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
};

/** One point of a scan: run the model with one parameter overridden and measure it. */
export function scanPoint(model: OdeModel, c: ScanConfig, value: number): number {
  return measureRun(simulate(model, { [c.param]: value }), c.observable, c.measure);
}

/** Synchronous scan (the UI runs the same loop in slices to stay responsive). */
export function scan(model: OdeModel, c: ScanConfig): ScanResult {
  const x = scanValues(c);
  const y = x.map((v) => scanPoint(model, c, v));
  return { x, y, failed: y.filter((v) => !Number.isFinite(v)).length };
}

/** Serialise named columns as CSV. Full double precision; empty cells for non-finite values. */
export function toCsv(columns: { name: string; values: number[] }[]): string {
  const rows = Math.max(0, ...columns.map((c) => c.values.length));
  const cell = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '' : String(v));
  const head = columns.map((c) => (/[",\n]/.test(c.name) ? `"${c.name.replace(/"/g, '""')}"` : c.name)).join(',');
  const lines = [head];
  for (let r = 0; r < rows; r++) lines.push(columns.map((c) => cell(c.values[r])).join(','));
  return lines.join('\n') + '\n';
}
