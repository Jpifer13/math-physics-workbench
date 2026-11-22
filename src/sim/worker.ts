/// <reference lib="webworker" />
/** Background thread for heavy numerical work: experiment runs and model fits. */
import { bootstrapReplicate, fitModel, profileFit, type BootstrapRequest, type FitRequest, type ProfileRequest } from '../core/fit';
import type { MeasureId } from '../core/measure';
import type { OdeModel } from '../core/ode';
import { runSample, type TraceGrid } from '../core/sensitivity';

/** Also return the observable over time, on an even grid, for the first `jobs` jobs. */
export interface TraceRequest extends TraceGrid { jobs: number }

export type WorkerRequest =
  | { type: 'scan'; model: OdeModel; jobs: { index: number; overrides: Record<string, number> }[]; observable: string; measure: MeasureId; trace?: TraceRequest }
  | { type: 'fit'; request: FitRequest }
  | { type: 'profile'; request: ProfileRequest }
  | { type: 'bootstrap'; request: BootstrapRequest; indices: number[] };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'scan') {
      for (const job of msg.jobs) {
        const traced = msg.trace && job.index < msg.trace.jobs ? msg.trace : undefined;
        self.postMessage({ type: 'point', index: job.index, ...runSample(msg.model, job.overrides, msg.observable, msg.measure, traced) });
      }
      self.postMessage({ type: 'done' });
    } else if (msg.type === 'fit') {
      self.postMessage({ type: 'fit', result: fitModel(msg.request) });
    } else if (msg.type === 'bootstrap') {
      for (const index of msg.indices) self.postMessage({ type: 'replicate', index, values: bootstrapReplicate(msg.request, index) });
      self.postMessage({ type: 'done' });
    } else {
      self.postMessage({ type: 'profile', result: profileFit(msg.request) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
