import { useEffect, useMemo, useState } from 'react';
import { interpolate, parseTable } from '../core/fit';
import type { OdeModel, SimResult } from '../core/ode';
import { fmtNum } from '../core/units';
import { desktop, type EngineInfo } from '../desktop';
import { exportScript } from '../documents';
import { TARGETS, type Target } from '../integrations';
import { useSim } from './store';

interface Comparison {
  engine: string;
  ms: number;
  run: SimResult;
  rows: { name: string; worst: number; scale: number; at: number }[];
  missing: string[];
}

/** Largest difference per quantity between this app's run and an external one, on the external time grid. */
function compare(ours: SimResult, theirs: SimResult): Pick<Comparison, 'rows' | 'missing'> {
  const rows: Comparison['rows'] = [];
  const missing: string[] = [];
  const jumps = ours.eventTimes ?? [];
  for (const [name, values] of Object.entries(theirs.series)) {
    const mine = ours.series[name];
    if (!mine) { missing.push(name); continue; }
    const scale = Math.max(Math.max(...mine) - Math.min(...mine), Math.max(...mine.map(Math.abs)), 1e-300);
    let worst = 0, at = 0;
    theirs.t.forEach((t, i) => {
      // At the instant of a discontinuity the two outputs may sit on opposite sides of the jump.
      if (jumps.some((te) => Math.abs(te - t) < 1e-3 * Math.max(1, Math.abs(te)))) return;
      const v = interpolate(ours.t, mine, t);
      const d = Math.abs(v - values[i]);
      if (Number.isFinite(d) && d > worst) { worst = d; at = t; }
    });
    rows.push({ name, worst, scale, at });
  }
  return { rows, missing };
}

/** Bridges to other scientific software: export the model as code, or run it there and compare. */
export function ToolsView({ model, run }: { model: OdeModel; run: SimResult }) {
  const setReference = useSim((s) => s.setReference);
  const [target, setTarget] = useState<Target>(TARGETS[0]);
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<Comparison | null>(null);
  const [failure, setFailure] = useState<{ engine: string; log: string } | null>(null);

  const refresh = () => { void desktop?.listEngines().then(setEngines, () => setEngines([])); };
  useEffect(refresh, []);

  const generated = useMemo(() => {
    try {
      return { code: target.generate(model) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    // Only the equations matter; notes and attached data do not change the script.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, model.name, model.states, model.params, model.derived, model.events, model.stopWhen, model.tEnd, model.method, model.tol]);

  const copy = async () => {
    if (!generated.code) return;
    try {
      await navigator.clipboard.writeText(generated.code);
      setStatus('Copied to the clipboard');
    } catch {
      setStatus('Copy failed');
    }
  };
  const save = async () => {
    if (!generated.code) return;
    try {
      setStatus(await exportScript(generated.code, model.name, target.ext));
    } catch (err) {
      setStatus(`Could not save: ${err instanceof Error ? err.message : err}`);
    }
  };

  const runIn = async (engine: EngineInfo) => {
    if (!desktop || !generated.code) return;
    setBusy(engine.id);
    setResult(null);
    setFailure(null);
    try {
      const r = await desktop.runEngine(engine.id, generated.code);
      if (!r.ok || !r.csv) {
        setFailure({ engine: engine.name, log: r.log || 'No output' });
      } else {
        const cols = parseTable(r.csv);
        const external: SimResult = { t: cols[0].values, series: Object.fromEntries(cols.slice(1).map((c) => [c.name, c.values])) };
        setResult({ engine: engine.name, ms: r.ms ?? 0, run: external, ...compare(run, external) });
      }
    } catch (err) {
      setFailure({ engine: engine.name, log: err instanceof Error ? err.message : String(err) });
    }
    setBusy('');
  };

  const available = engines.filter((e) => target.engines.includes(e.id));
  const worstRel = result ? Math.max(0, ...result.rows.map((r) => r.worst / r.scale)) : 0;

  return (
    <div className="experiment">
      <section className="card">
        <h3>
          Export the model as code
          <span className="card-tools">
            {status && <span className="muted">{status}</span>}
            <button className="btn small" onClick={() => void copy()} disabled={!generated.code}>Copy</button>
            <button className="btn small primary" onClick={() => void save()} disabled={!generated.code}>Save as .{target.ext}…</button>
          </span>
        </h3>
        <div className="seg target-seg" role="group" aria-label="Target language">
          {TARGETS.map((t) => (
            <button key={t.id} className={t.id === target.id ? 'on' : ''} onClick={() => { setTarget(t); setStatus(''); setResult(null); setFailure(null); }}>{t.name}</button>
          ))}
        </div>
        <p className="muted help">
          A self-contained script that solves this model and writes its results to a CSV file. Needs {target.requires}.{' '}
          {target.checked
            ? `Scripts for this target are checked against this app's own solver ${target.checked}.`
            : 'This target has not been run against a real installation in this project\'s tests — please report anything that does not run.'}
          {' '}The script is yours to use and publish however you like.
        </p>
        {generated.error ? (
          <div className="readout error">This model cannot be exported yet: {generated.error}</div>
        ) : (
          <pre className="code-preview" aria-label="Generated code">{generated.code}</pre>
        )}
      </section>

      <section className="card">
        <h3>Run it there and compare</h3>
        {!desktop ? (
          <p className="muted">Running other programs is available in the desktop app.</p>
        ) : (
          <>
            <p className="muted help">
              If you have one of these programs installed, Physics Tooling can run the script above in it and compare the answer with its own —
              an independent check on the result. Nothing is installed or sent anywhere; the script runs on this computer in a temporary folder.
            </p>
            <table className="table compact">
              <tbody>
                {available.map((e) => (
                  <tr key={e.id}>
                    <td><b>{e.name}</b></td>
                    <td className="muted engine-path">{e.path ?? 'Not found on this computer'}</td>
                    <td className="num">
                      <button className="btn small" onClick={() => void desktop!.locateEngine(e.id).then(refresh)}>{e.path ? 'Change…' : 'Locate…'}</button>{' '}
                      <button className="btn small primary" disabled={!e.path || !!busy || !generated.code || !run.t.length} onClick={() => void runIn(e)}>
                        {busy === e.id ? 'Running…' : 'Run and compare'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {busy && <progress className="scan-progress" aria-label="Running external program" />}
            {failure && (
              <div className="readout error">
                {failure.engine} did not produce a result.
                <pre className="engine-log">{failure.log}</pre>
              </div>
            )}
            {result && (
              <>
                <div className={`verdict ${worstRel < 1e-3 ? 'good-box' : 'stale-note'}`}>
                  {worstRel < 1e-3
                    ? <>The two solutions agree: the largest difference is <b>{fmtNum(worstRel * 100, 2)} %</b> of the size of the quantity.</>
                    : <>The two solutions differ by up to <b>{fmtNum(worstRel * 100, 2)} %</b> of the size of a quantity. For a chaotic or stiff model, tighten the tolerance and compare again before concluding which is right.</>}
                  {' '}<span className="muted">{result.engine} took {(result.ms / 1000).toFixed(1)} s.</span>
                </div>
                <table className="table compact">
                  <thead><tr><th>Quantity</th><th className="num">Largest difference</th><th className="num">Relative to its size</th><th className="num">At time</th></tr></thead>
                  <tbody>
                    {result.rows.map((r) => (
                      <tr key={r.name}>
                        <td><code>{r.name}</code></td>
                        <td className="num">{fmtNum(r.worst, 3)}</td>
                        <td className="num">{fmtNum((r.worst / r.scale) * 100, 2)} %</td>
                        <td className="num">{fmtNum(r.at, 4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.missing.length > 0 && <p className="muted help">Not compared (no matching quantity here): {result.missing.join(', ')}.</p>}
                <div className="eq-actions" style={{ justifyContent: 'flex-start', marginTop: 10 }}>
                  <button className="btn" onClick={() => { setReference({ run: result.run, label: `computed by ${result.engine}` }); setStatus(''); }}>Show on the Run charts as a reference</button>
                </div>
                <p className="muted help">Differences are measured at the other program's output times, with this app's values interpolated between its recorded samples, so agreement to about 0.1 % is as close as this comparison can resolve.</p>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
