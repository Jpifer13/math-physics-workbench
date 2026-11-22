import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { REFERENCE, searchReference, type ModelName } from '../core/reference';
import { fmtNum } from '../core/units';
import { useHints } from './Hint';

/** Whether the reference is on show, and the names of the model it was opened from. */
export const useReference = create<{ names: ModelName[] | null; show: (names: ModelName[]) => void; close: () => void }>((set) => ({
  names: null,
  show: (names) => set({ names }),
  close: () => set({ names: null }),
}));

/** Searchable list of everything that can be written in an equation. */
export function ReferenceDialog() {
  const names = useReference((s) => s.names);
  const close = useReference((s) => s.close);
  const resetHints = useHints((s) => s.reset);
  const hidden = useHints((s) => s.dismissed.length);
  const [query, setQuery] = useState('');
  useEffect(() => { setQuery(''); }, [names]);
  useEffect(() => {
    if (!names) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [names, close]);
  if (!names) return null;

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const own = names.filter((n) => words.every((w) => `${n.name} ${n.kind} ${n.detail ?? ''}`.toLowerCase().includes(w)));
  const found = searchReference(query);
  const groups = [...new Set(found.map((r) => r.group))];

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Functions and syntax">
        <h3>
          <span>What you can write in an equation</span>
          <button className="btn small" onClick={close}>Close</button>
        </h3>
        <input className="reference-search" type="search" autoFocus value={query} placeholder="Search: square root, remainder, angle…" aria-label="Search the reference"
          onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }} />
        <div className="modal-body">
          <table className="table compact reference">
            {own.length > 0 && (
              <tbody>
                <tr className="compare-section"><td colSpan={3}>In this model</td></tr>
                {own.map((n) => (
                  <tr key={n.name}><td><code>{n.name}</code></td><td>{n.kind === 'time' ? 'Time since the start of the run' : n.detail ? `${n.detail} (${n.kind})` : n.kind}</td><td /></tr>
                ))}
              </tbody>
            )}
            {groups.map((g) => (
              <tbody key={g}>
                <tr className="compare-section"><td colSpan={3}>{g}</td></tr>
                {found.filter((r) => r.group === g).map((r) => (
                  <tr key={r.name}>
                    <td><code>{r.usage}</code></td>
                    <td>{r.meaning}</td>
                    <td className="muted"><code>{r.example}</code> = {fmtNum(r.value, 5)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
          {!own.length && !found.length && <p className="muted pad">Nothing matches “{query}”. Try a plainer word, such as “root” or “angle”.</p>}
        </div>
        <p className="muted help">
          {REFERENCE.length} entries. Angles are in radians. While typing an equation, names are offered as you go: arrow keys choose, Tab accepts.
          {hidden > 0 && <> <button className="link" onClick={resetHints}>Show the first-use tips again</button></>}
        </p>
      </div>
    </div>
  );
}
