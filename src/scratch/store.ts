import { readStored, storageKey } from '../core/brand';
import { create } from 'zustand';
import type { Stroke } from '../core/ink';
import { repairReading } from '../core/latexMath';

const STORAGE = 'scratch.v1';

/** What is known about one written line, keyed by the line's ink (see `groupLines`). */
export interface Reading {
  /** What the recogniser made of it. */
  latex?: string;
  /** A second opinion that differs, where two recognisers were asked. */
  other?: string;
  /** Why it could not be read. */
  error?: string;
  pending?: boolean;
}

interface Saved {
  strokes: Stroke[];
  readings: Record<string, string>;
  typed: Record<string, string>;
}

function restore(): Saved {
  try {
    const raw = JSON.parse(readStored(localStorage, STORAGE) ?? 'null') as Saved | null;
    if (raw && Array.isArray(raw.strokes) && raw.strokes.every((s) => typeof s.id === 'number' && Array.isArray(s.pts))) {
      return { strokes: raw.strokes, readings: raw.readings ?? {}, typed: raw.typed ?? {} };
    }
  } catch {
    /* start with an empty page */
  }
  return { strokes: [], readings: {}, typed: {} };
}

interface ScratchState {
  strokes: Stroke[];
  past: Stroke[][];
  future: Stroke[][];
  readings: Record<string, Reading>;
  /** Lines the user has typed or corrected by hand; these win over the recogniser. */
  typed: Record<string, string>;
  addStroke: (pts: number[]) => void;
  /** Remove strokes by id, as one undoable step per call of `commitErase`. */
  erase: (ids: number[]) => void;
  beginErase: () => void;
  clear: () => void;
  undo: () => void;
  redo: () => void;
  setReading: (key: string, r: Reading) => void;
  setTyped: (key: string, latex: string | null) => void;
  /** Forget readings for lines that are no longer on the page. */
  prune: (keys: string[]) => void;
}

const saved = restore();
const LIMIT = 200;
// Ids are never reused, so a stroke brought back by undo cannot collide with a newer one.
let nextId = saved.strokes.reduce((m, s) => Math.max(m, s.id), 0) + 1;

export const useScratch = create<ScratchState>((set, get) => {
  const change = (strokes: Stroke[]) => set({ strokes, past: [...get().past.slice(-LIMIT), get().strokes], future: [] });
  return {
    strokes: saved.strokes,
    past: [],
    future: [],
    // Readings saved by an earlier version get the repairs this one knows.
    readings: Object.fromEntries(Object.entries(saved.readings).map(([k, latex]) => [k, { latex: repairReading(latex) }])),
    typed: saved.typed,
    addStroke: (pts) => {
      change([...get().strokes, { id: nextId++, pts }]);
    },
    beginErase: () => set({ past: [...get().past.slice(-LIMIT), get().strokes], future: [] }),
    erase: (ids) => {
      if (!ids.length) return;
      const gone = new Set(ids);
      set({ strokes: get().strokes.filter((s) => !gone.has(s.id)) });
    },
    clear: () => { if (get().strokes.length) change([]); },
    undo: () => {
      const { past, strokes, future } = get();
      if (!past.length) return;
      set({ strokes: past[past.length - 1], past: past.slice(0, -1), future: [strokes, ...future] });
    },
    redo: () => {
      const { past, strokes, future } = get();
      if (!future.length) return;
      set({ strokes: future[0], past: [...past, strokes], future: future.slice(1) });
    },
    setReading: (key, r) => set({ readings: { ...get().readings, [key]: r } }),
    setTyped: (key, latex) => {
      const typed = { ...get().typed };
      if (latex === null) delete typed[key];
      else typed[key] = latex;
      set({ typed });
    },
    prune: (keys) => {
      const keep = new Set(keys);
      const { readings, typed } = get();
      if (Object.keys(readings).every((k) => keep.has(k)) && Object.keys(typed).every((k) => keep.has(k))) return;
      set({
        readings: Object.fromEntries(Object.entries(readings).filter(([k]) => keep.has(k))),
        typed: Object.fromEntries(Object.entries(typed).filter(([k]) => keep.has(k))),
      });
    },
  };
});

// Keep a working copy, as the other workspaces do, so the page survives a reload.
let timer: ReturnType<typeof setTimeout> | undefined;
useScratch.subscribe(() => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const { strokes, readings, typed } = useScratch.getState();
    const data: Saved = {
      strokes,
      readings: Object.fromEntries(Object.entries(readings).filter(([, r]) => r.latex !== undefined).map(([k, r]) => [k, r.latex!])),
      typed,
    };
    try {
      localStorage.setItem(storageKey(STORAGE), JSON.stringify(data));
    } catch {
      /* storage full or unavailable — the page simply is not kept */
    }
  }, 400);
});
