/**
 * Runs heavy numerical work off the UI thread. Experiment runs are spread
 * across a small pool of workers; if workers are unavailable everything falls
 * back to cooperative slices on the main thread.
 */
import {
  bootstrapReplicate, fitModel, profileFit, summarizeBootstrap,
  type BootstrapRequest, type BootstrapResult, type FitRequest, type FitResult, type Profile, type ProfileRequest,
} from '../core/fit';
import type { MeasureId } from '../core/measure';
import type { OdeModel } from '../core/ode';
import { runSample } from '../core/sensitivity';
import type { TraceRequest, WorkerRequest } from './worker';

export interface Task<T> {
  promise: Promise<T>;
  cancel: () => void;
}

/** Workers only need the equations; leave bulky attachments (imported data, notes) behind. */
const lean = (model: OdeModel): OdeModel => ({ ...model, data: undefined, notes: undefined });

const spawn = () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const poolSize = (jobs: number) => Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1, jobs));

export interface Ensemble {
  values: number[];
  /** The observable over time for the runs a trace was asked for; undefined where the run failed. */
  traces: (number[] | undefined)[];
}

/** Run the model once per set of parameter overrides and measure each run. */
export function runJobs(
  model: OdeModel, overrides: Record<string, number>[], observable: string, measure: MeasureId, onProgress: (fraction: number) => void,
): Task<number[]> {
  const task = runEnsemble(model, overrides, observable, measure, onProgress);
  return { promise: task.promise.then((e) => e.values), cancel: task.cancel };
}

/** As runJobs, optionally keeping the observable over time for the first runs (see TraceRequest). */
export function runEnsemble(
  model: OdeModel, overrides: Record<string, number>[], observable: string, measure: MeasureId, onProgress: (fraction: number) => void,
  trace?: TraceRequest,
): Task<Ensemble> {
  const values = new Array<number>(overrides.length).fill(NaN);
  const traces = new Array<number[] | undefined>(trace ? Math.min(trace.jobs, overrides.length) : 0).fill(undefined);
  const keep = (index: number, r: { value: number; trace?: number[] }) => {
    values[index] = r.value;
    if (index < traces.length) traces[index] = r.trace;
  };
  let cancelled = false;
  let workers: Worker[] = [];
  const stop = () => { workers.forEach((w) => w.terminate()); workers = []; };

  const onMain = async () => {
    let slice = performance.now();
    for (let i = 0; i < overrides.length; i++) {
      if (cancelled) throw new Error('cancelled');
      keep(i, runSample(model, overrides[i], observable, measure, i < traces.length ? trace : undefined));
      if (performance.now() - slice > 40) {
        onProgress((i + 1) / overrides.length);
        await new Promise((r) => setTimeout(r));
        slice = performance.now();
      }
    }
    return { values, traces };
  };

  const promise = new Promise<Ensemble>((resolve, reject) => {
    const fallback = () => { stop(); onMain().then(resolve, reject); };
    try {
      const n = poolSize(overrides.length);
      let done = 0, finished = 0, failed = false;
      workers = Array.from({ length: n }, spawn);
      workers.forEach((w, k) => {
        w.onmessage = (e) => {
          const m = e.data;
          if (m.type === 'point') {
            keep(m.index, m);
            onProgress(++done / overrides.length);
          } else if (m.type === 'done') {
            if (++finished === n) { stop(); resolve({ values, traces }); }
          } else if (m.type === 'error') { stop(); reject(new Error(m.message)); }
        };
        // A worker that cannot start (e.g. blocked by the platform) sends us back to the main thread once.
        w.onerror = () => { if (!failed && !cancelled) { failed = true; fallback(); } };
        const jobs = overrides.map((o, index) => ({ index, overrides: o })).filter((_, i) => i % n === k);
        w.postMessage({ type: 'scan', model: lean(model), jobs, observable, measure, trace } satisfies WorkerRequest);
      });
    } catch {
      fallback();
    }
  });
  return { promise, cancel: () => { cancelled = true; stop(); } };
}

/** Fit model parameters to data in the background. */
export function runFit(request: FitRequest): Task<FitResult> {
  let worker: Worker | null = null;
  const promise = new Promise<FitResult>((resolve, reject) => {
    const onMain = () => setTimeout(() => { try { resolve(fitModel(request)); } catch (err) { reject(err); } });
    try {
      worker = spawn();
      worker.onmessage = (e) => {
        worker?.terminate();
        if (e.data.type === 'fit') resolve(e.data.result);
        else reject(new Error(e.data.message ?? 'The fit failed'));
      };
      worker.onerror = () => { worker?.terminate(); onMain(); };
      worker.postMessage({ type: 'fit', request: { ...request, model: lean(request.model) } } satisfies WorkerRequest);
    } catch {
      onMain();
    }
  });
  return { promise, cancel: () => worker?.terminate() };
}

/** Profile each fitted parameter in the background. */
export function runProfile(request: ProfileRequest): Task<Profile[]> {
  let worker: Worker | null = null;
  const promise = new Promise<Profile[]>((resolve, reject) => {
    const onMain = () => setTimeout(() => { try { resolve(profileFit(request)); } catch (err) { reject(err); } });
    try {
      worker = spawn();
      worker.onmessage = (e) => {
        worker?.terminate();
        if (e.data.type === 'profile') resolve(e.data.result);
        else reject(new Error(e.data.message ?? 'The profile failed'));
      };
      worker.onerror = () => { worker?.terminate(); onMain(); };
      worker.postMessage({ type: 'profile', request: { ...request, model: lean(request.model) } } satisfies WorkerRequest);
    } catch {
      onMain();
    }
  });
  return { promise, cancel: () => worker?.terminate() };
}

/** Refit resampled data `count` times across the worker pool and summarise each parameter's spread. */
export function runBootstrap(request: BootstrapRequest, count: number, names: string[], onProgress: (fraction: number) => void): Task<BootstrapResult> {
  const replicates = new Array<Record<string, number> | null>(count).fill(null);
  const lite = { ...request, model: lean(request.model) };
  let cancelled = false;
  let workers: Worker[] = [];
  const stop = () => { workers.forEach((w) => w.terminate()); workers = []; };

  const onMain = async () => {
    for (let i = 0; i < count; i++) {
      if (cancelled) throw new Error('cancelled');
      replicates[i] = bootstrapReplicate(request, i);
      onProgress((i + 1) / count);
      await new Promise((r) => setTimeout(r));
    }
    return summarizeBootstrap(replicates, names);
  };

  const promise = new Promise<BootstrapResult>((resolve, reject) => {
    const fallback = () => { stop(); onMain().then(resolve, reject); };
    try {
      const n = poolSize(count);
      let done = 0, finished = 0, failed = false;
      workers = Array.from({ length: n }, spawn);
      workers.forEach((w, k) => {
        w.onmessage = (e) => {
          const m = e.data;
          if (m.type === 'replicate') {
            replicates[m.index] = m.values;
            onProgress(++done / count);
          } else if (m.type === 'done') {
            if (++finished === n) { stop(); resolve(summarizeBootstrap(replicates, names)); }
          } else if (m.type === 'error') { stop(); reject(new Error(m.message)); }
        };
        w.onerror = () => { if (!failed && !cancelled) { failed = true; fallback(); } };
        const indices = Array.from({ length: count }, (_, i) => i).filter((i) => i % n === k);
        w.postMessage({ type: 'bootstrap', request: lite, indices } satisfies WorkerRequest);
      });
    } catch {
      fallback();
    }
  });
  return { promise, cancel: () => { cancelled = true; stop(); } };
}
