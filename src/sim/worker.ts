/// <reference lib="webworker" />
/** Background thread for heavy numerical work: experiment runs and model fits. */
import { fitModel, type FitRequest } from '../core/fit';
import { measureAt, type MeasureId } from '../core/measure';
import type { OdeModel } from '../core/ode';

export type WorkerRequest =
  | { type: 'scan'; model: OdeModel; jobs: { index: number; overrides: Record<string, number> }[]; observable: string; measure: MeasureId }
  | { type: 'fit'; request: FitRequest };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'scan') {
      for (const job of msg.jobs) {
        self.postMessage({ type: 'point', index: job.index, value: measureAt(msg.model, job.overrides, msg.observable, msg.measure) });
      }
      self.postMessage({ type: 'done' });
    } else {
      self.postMessage({ type: 'fit', result: fitModel(msg.request) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
