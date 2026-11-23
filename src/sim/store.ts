import { readStored, storageKey } from '../core/brand';
import { create } from 'zustand';
import { normalizeSim } from '../core/docfile';
import type { OdeModel, SimResult } from '../core/ode';
import { MODELS } from './models';

const STORAGE = 'sim.v1';
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** A minimal starting point for a new simulation. */
export const blankModel = (): OdeModel => ({
  id: 'custom',
  name: 'Untitled simulation',
  summary: '',
  states: [
    { name: 'x', init: 'x0', deriv: 'v' },
    { name: 'v', init: '0', deriv: '-k * x' },
  ],
  params: [
    { name: 'x0', value: 1, min: -2, max: 2 },
    { name: 'k', value: 1, min: 0, max: 10 },
  ],
  derived: [],
  tEnd: 20,
  dt: 0.01,
  method: 'rk45',
  tol: 1e-8,
  timeSeries: ['x'],
  phase: ['x', 'v'],
  notes: '',
});

export function isModel(v: unknown): v is OdeModel {
  const m = v as OdeModel;
  return !!m && Array.isArray(m.states) && Array.isArray(m.params) && typeof m.tEnd === 'number';
}

/** Fill in anything an older or hand-written file may be missing. */
export const normalizeModel = normalizeSim;

function restore(): OdeModel {
  try {
    const raw = readStored(localStorage, STORAGE);
    if (raw) {
      const m = JSON.parse(raw);
      if (isModel(m)) return normalizeModel(m);
    }
  } catch {
    /* fall through to the default template */
  }
  return clone(MODELS[0]);
}

export interface Reference {
  run: SimResult;
  label: string;
}

interface SimState {
  model: OdeModel;
  filePath: string | null;
  dirty: boolean;
  notice: string;
  /** A held run that later runs are compared against. */
  reference: Reference | null;
  /** Bumped when a whole model is loaded so views can reset. */
  docVersion: number;
  patch: (p: Partial<OdeModel>) => void;
  load: (m: OdeModel) => void;
  setReference: (r: Reference | null) => void;
}

export const useSim = create<SimState>((set, get) => ({
  model: restore(),
  filePath: null,
  dirty: false,
  notice: '',
  reference: null,
  docVersion: 0,
  patch: (p) => set({ model: { ...get().model, ...p } }),
  load: (m) => set({ model: normalizeModel(clone(m)), reference: null, docVersion: get().docVersion + 1 }),
  setReference: (reference) => set({ reference }),
}));

let savedJson = JSON.stringify(useSim.getState().model);

/** Record that the current model matches the file at `filePath`. */
export function markSimSaved(filePath: string | null) {
  savedJson = JSON.stringify(useSim.getState().model);
  useSim.setState({ filePath, dirty: false, notice: '' });
}

let timer: ReturnType<typeof setTimeout> | undefined;
useSim.subscribe(() => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const json = JSON.stringify(useSim.getState().model);
    const dirty = json !== savedJson;
    if (dirty !== useSim.getState().dirty) useSim.setState({ dirty });
    try {
      localStorage.setItem(storageKey(STORAGE), json);
    } catch {
      /* storage unavailable — the working copy simply isn't kept */
    }
  }, 300);
});
