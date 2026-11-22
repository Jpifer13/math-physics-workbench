/**
 * Undo / redo for a document held in a store. Edits are coalesced: a burst of
 * changes (typing, dragging a slider or a block) becomes one history step.
 */
import { create } from 'zustand';

export interface History {
  undo: () => void;
  redo: () => void;
  /** Forget everything, e.g. after a different document is loaded. */
  reset: () => void;
}

/** Reactive availability flags so toolbars and menus can enable their buttons. */
export const useHistoryState = create<Record<string, { canUndo: boolean; canRedo: boolean }>>(() => ({}));

interface Options<T> {
  id: string;
  get: () => T;
  set: (doc: T) => void;
  subscribe: (listener: () => void) => void;
  /** Pause before a burst of edits is committed as one step. */
  delay?: number;
  limit?: number;
}

export function createHistory<T>({ id, get, set, subscribe, delay = 400, limit = 200 }: Options<T>): History {
  let past: string[] = [];
  let future: string[] = [];
  let present = JSON.stringify(get());
  let applying = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const publish = () => useHistoryState.setState({ [id]: { canUndo: past.length > 0, canRedo: future.length > 0 } });
  const commit = () => {
    clearTimeout(timer);
    timer = undefined;
    const now = JSON.stringify(get());
    if (now === present) return;
    past.push(present);
    if (past.length > limit) past.shift();
    future = [];
    present = now;
    publish();
  };
  const apply = (json: string) => {
    applying = true;
    try {
      set(JSON.parse(json));
    } finally {
      applying = false;
    }
    present = json;
    publish();
  };

  subscribe(() => {
    if (applying) return;
    clearTimeout(timer);
    timer = setTimeout(commit, delay);
  });
  publish();

  return {
    undo: () => {
      commit();
      const prev = past.pop();
      if (prev === undefined) return;
      future.push(present);
      apply(prev);
    },
    redo: () => {
      commit();
      const next = future.pop();
      if (next === undefined) return;
      past.push(present);
      apply(next);
    },
    reset: () => {
      clearTimeout(timer);
      past = [];
      future = [];
      present = JSON.stringify(get());
      publish();
    },
  };
}
