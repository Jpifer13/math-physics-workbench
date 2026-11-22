import { useEffect, useState } from 'react';
import { holdComparedRun, useCompare } from '../documents';

/** What differs between the open document and a file, grouped by where the difference is. */
export function CompareDialog() {
  const comparison = useCompare((s) => s.comparison);
  const close = useCompare((s) => s.close);
  const [numericOnly, setNumericOnly] = useState(false);
  const [held, setHeld] = useState(false);
  useEffect(() => { setNumericOnly(false); setHeld(false); }, [comparison]);
  useEffect(() => {
    if (!comparison) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [comparison, close]);
  if (!comparison) return null;

  const { changes, fileName, kind } = comparison;
  const numeric = changes.filter((c) => c.numeric);
  const shown = numericOnly ? numeric : changes;
  const sections = [...new Set(shown.map((c) => c.section))];
  const noun = kind === 'sim' ? 'simulation' : 'flow';
  const affects = kind === 'sim' ? 'change the numbers' : 'change what the flow computes';

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Comparison with ${fileName}`}>
        <h3>
          <span>The open {noun} compared with <code>{fileName}</code></span>
          <button className="btn small" onClick={close}>Close</button>
        </h3>
        {changes.length === 0 ? (
          <p className="good">No differences: the open {noun} matches the file.</p>
        ) : (
          <>
            <p className="compare-summary">
              <b>{changes.length}</b> {changes.length === 1 ? 'difference' : 'differences'}.{' '}
              {numeric.length === 0
                ? <span className="good">{changes.length === 1 ? `It does not ${affects}` : `None of them ${affects}`}: only names, notes, display settings or positions differ.</span>
                : <><b>{numeric.length}</b> of them {numeric.length === 1 ? affects.replace('change', 'changes') : affects}.</>}
            </p>
            {numeric.length > 0 && numeric.length < changes.length && (
              <label className="compare-filter"><input type="checkbox" checked={numericOnly} onChange={(e) => setNumericOnly(e.target.checked)} /> Show only those</label>
            )}
            <div className="modal-body">
              <table className="table compact compare">
                <thead><tr><th>What</th><th>In {fileName}</th><th>Open now</th></tr></thead>
                {sections.map((name) => (
                  <tbody key={name}>
                    <tr className="compare-section"><td colSpan={3}>{name}</td></tr>
                    {shown.filter((c) => c.section === name).map((c, i) => (
                      <tr key={i} className={c.numeric ? '' : 'quiet'}>
                        <td>{c.what}{c.kind !== 'changed' && <span className={`tag ${c.kind}`}>{c.kind}</span>}</td>
                        <td className="code">{c.kind === 'added' ? <span className="muted">not there</span> : c.before}</td>
                        <td className="code">{c.kind === 'removed' ? <span className="muted">not there</span> : c.after}</td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          </>
        )}
        {kind === 'sim' && numeric.length > 0 && (
          <div className="modal-actions">
            {held
              ? <span className="good">The file's run is now the dashed reference in the Run view.</span>
              : <button className="btn" onClick={() => { holdComparedRun(); setHeld(true); }} title="Run the file's version and show it dashed beside the open one on every chart">Show the file's run as a reference</button>}
          </div>
        )}
      </div>
    </div>
  );
}
