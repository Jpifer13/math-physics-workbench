import { historyFor, type DocKind } from '../documents';
import { useHistoryState } from '../history';

/** Undo / redo buttons for one document kind. */
export function UndoRedo({ kind }: { kind: DocKind }) {
  const state = useHistoryState((s) => s[kind]);
  const h = historyFor(kind);
  return (
    <>
      <button className="btn small undo" onClick={h.undo} disabled={!state?.canUndo} title="Undo (Ctrl/Cmd+Z)" aria-label="Undo">↶</button>
      <button className="btn small undo" onClick={h.redo} disabled={!state?.canRedo} title="Redo (Ctrl/Cmd+Shift+Z)" aria-label="Redo">↷</button>
    </>
  );
}
