import { useEffect, useMemo, useRef, useState } from 'react';
import { measure, toCsv } from '../core/measure';
import { sampleIndex, type Expectation, type MeasureId, type OdeModel, type SimResult } from '../core/ode';
import { accuracyReport, checkExpectations, provenance, type AccuracyReport } from '../core/trust';
import { fmtNum } from '../core/units';
import { exportCsv } from '../documents';
import { saveFile } from '../saveFile';
import { APP_VERSION, FILE_FORMAT } from '../version';
import { Plot, type Series } from '../components/Plot';
import { Plot3D, type Vec3 } from '../components/Plot3D';
import { Scene } from './Scene';
import { useSim } from './store';

const SPEEDS = [0.25, 0.5, 1, 2, 4];
const METHOD_NAMES = { rk45: 'RK45 adaptive', ros23: 'Rosenbrock23 (stiff)', rk4: 'RK4', euler: 'Euler' };

const default3d = (m: OdeModel): [string, string, string] => m.view3d ?? [m.phase[0], m.phase[1], 't'];

/** One run of the model: playback, picture, phase portrait, time series and summary statistics. */
export function RunView({ model, run }: { model: OdeModel; run: SimResult }) {
  const docVersion = useSim((s) => s.docVersion);
  const reference = useSim((s) => s.reference);
  const setReference = useSim((s) => s.setReference);
  const patch = useSim((s) => s.patch);

  const [view, setView] = useState<'2d' | '3d'>(model.view3d || !model.scene ? '3d' : '2d');
  const [axes3, setAxes3] = useState<[string, string, string]>(default3d(model));
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [tNow, setTNow] = useState(0);
  const [exported, setExported] = useState('');
  // The accuracy report belongs to one particular run; a new run makes it stale.
  const [accuracy, setAccuracy] = useState<{ run: SimResult; report: AccuracyReport } | null>(null);

  // A freshly loaded model resets the view state.
  useEffect(() => {
    const m = useSim.getState().model;
    setView(m.view3d || !m.scene ? '3d' : '2d');
    setAxes3(default3d(m));
    setTNow(0);
    setPlaying(true);
    setExported('');
  }, [docVersion]);

  const names = Object.keys(run.series);
  const tLast = run.t.length ? run.t[run.t.length - 1] : 0;

  const last = useRef(0);
  useEffect(() => {
    if (!playing || tLast <= 0) return;
    let raf = 0;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last.current) / 1000);
      last.current = now;
      setTNow((t) => (t + dt * speed > tLast ? 0 : t + dt * speed));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, tLast]);

  const t = Math.min(tNow, tLast);
  const frame = sampleIndex(run.t, t);

  const unitOf = (n: string) => model.states.find((s) => s.name === n)?.unit ?? model.derived.find((d) => d.name === n)?.unit ?? '';
  const withUnit = (n: string) => (n === 't' ? 'time' : unitOf(n) ? `${n} (${unitOf(n)})` : n);
  const isState = (n: string) => model.states.some((st) => st.name === n);

  const shown = model.timeSeries.filter((n) => run.series[n]);
  const toggleShown = (n: string) =>
    patch({ timeSeries: model.timeSeries.includes(n) ? model.timeSeries.filter((x) => x !== n) : [...model.timeSeries, n] });
  const ref = reference?.run;

  const tsSeries = useMemo(() => {
    const out: Series[] = shown.map((n) => ({ name: withUnit(n), x: run.t, y: run.series[n], slot: names.indexOf(n) + 1 }));
    if (ref) for (const n of shown) if (ref.series[n]) out.push({ name: `${n} — reference`, x: ref.t, y: ref.series[n], slot: names.indexOf(n) + 1, dashed: true });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, ref, shown.join('|')]);

  const px = run.series[model.phase[0]] ? model.phase[0] : names[0];
  const py = run.series[model.phase[1]] ? model.phase[1] : names[1] ?? names[0];
  const phaseSeries = useMemo(() => {
    if (!px || !py) return [];
    const out: Series[] = [{ name: 'this run', x: run.series[px], y: run.series[py], slot: 1 }];
    if (ref?.series[px] && ref.series[py]) out.push({ name: 'reference', x: ref.series[px], y: ref.series[py], slot: 1, dashed: true });
    return out;
  }, [run, ref, px, py]);

  const col3 = (n: string) => (n === 't' ? run.t : run.series[n]);
  const a3 = axes3.map((n) => (col3(n) ? n : 't')) as [string, string, string];
  const line3 = useMemo(() => {
    const [cx, cy, cz] = a3.map(col3);
    return [{ points: run.t.map((_, i): Vec3 => [cx[i], cy[i], cz[i]]) }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, a3.join('|')]);
  const equal3 = a3.every(isState) && new Set(a3.map(unitOf)).size === 1;

  const stats = useMemo(
    () => names.map((n) => ({
      n,
      final: measure(run.t, run.series[n], 'final'),
      min: measure(run.t, run.series[n], 'min'),
      max: measure(run.t, run.series[n], 'max'),
      mean: measure(run.t, run.series[n], 'mean'),
      period: measure(run.t, run.series[n], 'period'),
      range: measure(run.t, run.series[n], 'range'),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run],
  );

  const expectations = useMemo(() => checkExpectations(model, run), [model, run]);
  const failed = expectations.filter((e) => !e.pass).length;
  const report = accuracy?.run === run ? accuracy.report : null;
  /** Turn a measured value into an expectation, with a tolerance loose enough to survive solver changes. */
  const expect = (observable: string, measure: MeasureId, value: number) => {
    const e: Expectation = measure === 'range'
      ? { observable, measure, compare: 'atMost', value: Number((Math.max(value * 10, 1e-12)).toPrecision(2)) }
      : { observable, measure, compare: 'equals', value: Number(value.toPrecision(8)), tolerance: Number((Math.max(Math.abs(value) * 1e-4, 1e-12)).toPrecision(2)) };
    patch({ expectations: [...(model.expectations ?? []), e] });
  };
  const stamp = () => provenance(model, { appVersion: APP_VERSION, when: new Date().toISOString(), run });

  const exportRecord = async () => {
    const record = {
      kind: 'physics-tooling-run-record', format: FILE_FORMAT, provenance: stamp(),
      model: { ...model, data: undefined },
      result: { t: run.t, series: run.series, eventTimes: run.eventTimes ?? [], stats: run.stats },
      expectations: expectations.map((e) => ({ statement: e.text, actual: e.actual, pass: e.pass })),
    };
    try {
      const saved = await saveFile(JSON.stringify(record), `${model.name} run record`, 'json');
      setExported(saved ? `Exported to ${saved}` : '');
    } catch (err) {
      setExported(`Export failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  const exportRun = async () => {
    const csv = toCsv([{ name: 't', values: run.t }, ...names.map((n) => ({ name: withUnit(n), values: run.series[n] }))], stamp());
    try {
      setExported(await exportCsv(csv, `${model.name} run`));
    } catch (err) {
      setExported(`Export failed: ${err instanceof Error ? err.message : err}`);
    }
  };
  const holdReference = () =>
    setReference({ run, label: model.params.map((p) => `${p.name} = ${fmtNum(p.value, 4)}`).join(', ') });

  const s = run.stats;
  // Step size over time for the adaptive methods: where the solver had to work hardest.
  const stepSeries = useMemo(() => {
    const x: number[] = [], y: number[] = [];
    for (let i = 1; i < run.t.length; i++) {
      const h = run.t[i] - run.t[i - 1];
      if (h > 0) { x.push(run.t[i]); y.push(h); }
    }
    return [{ name: 'step size', x, y }];
  }, [run]);
  const adaptive = s?.method === 'rk45' || s?.method === 'ros23';

  return (
    <>
      <div className="transport">
        <button className="btn primary" onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Play'}</button>
        <button className="btn" onClick={() => setTNow(0)}>Restart</button>
        <input
          className="scrub" type="range" min={0} max={tLast || 1} step={(tLast || 1) / 1000} value={t}
          onChange={(e) => { setPlaying(false); setTNow(Number(e.target.value)); }} aria-label="Time"
        />
        <span className="clock">t = {t.toFixed(3)} / {tLast.toFixed(3)}</span>
        <div className="seg" role="group" aria-label="Playback speed">
          {SPEEDS.map((v) => <button key={v} className={v === speed ? 'on' : ''} onClick={() => setSpeed(v)}>{v}×</button>)}
        </div>
      </div>

      <div className="runbar">
        {s && (
          <span className="solver-stats" title="Integration statistics for this run">
            {METHOD_NAMES[s.method]} · {s.steps.toLocaleString()} steps{s.rejected ? ` (${s.rejected.toLocaleString()} rejected)` : ''} · {s.evals.toLocaleString()} evaluations ·{s.events ? ` ${s.events.toLocaleString()} event${s.events > 1 ? 's' : ''} ·` : ''} {run.t.length.toLocaleString()} samples · {s.ms < 10 ? s.ms.toFixed(1) : Math.round(s.ms)} ms
          </span>
        )}
        <span className="spacer" />
        {exported && <span className="muted">{exported}</span>}
        {reference ? (
          <button className="btn small" onClick={() => setReference(null)} title={`Reference: ${reference.label}`}>Clear reference</button>
        ) : (
          <button className="btn small" onClick={holdReference} disabled={!run.t.length} title="Keep this run on the charts (dashed) while you change the model">Hold as reference</button>
        )}
        <button className="btn small" onClick={() => void exportRun()} disabled={!run.t.length} title="The data, with a header recording the model, parameters and solver that produced it">Export run (CSV)</button>
        <button className="btn small" onClick={() => void exportRecord()} disabled={!run.t.length} title="One file holding the model, the result and its provenance — everything needed to reproduce this run">Run record</button>
      </div>
      {expectations.length > 0 && (
        <details className={`expect-strip ${failed ? 'fail' : 'pass'}`} open={failed > 0}>
          <summary>{failed ? `${failed} of ${expectations.length} expectations not met` : `All ${expectations.length} expectation${expectations.length > 1 ? 's' : ''} met`}</summary>
          <ul>
            {expectations.map((e, i) => (
              <li key={i} className={e.pass ? 'ok' : 'bad'}>
                <span className="mark">{e.pass ? '✓' : '✗'}</span> {e.text} <span className="muted">— measured {Number.isFinite(e.actual) ? fmtNum(e.actual, 8) : 'nothing (no such quantity, or no value)'}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {reference && <div className="ref-note">Dashed curves show the held reference run ({reference.label}).</div>}

      <div className="sim-grid">
        <section className="card">
          <h3>
            {view === '2d' ? 'Picture' : 'Trajectory'}
            <span className="card-tools">
              {view === '3d' && a3.map((n, k) => (
                <select key={k} value={n} aria-label={`3-D axis ${'xyz'[k]}`} onChange={(e) => setAxes3(a3.map((v, j) => (j === k ? e.target.value : v)) as [string, string, string])}>
                  {['t', ...names].map((o) => <option key={o}>{o}</option>)}
                </select>
              ))}
              {model.scene && (
                <span className="seg" role="group" aria-label="View">
                  <button className={view === '2d' ? 'on' : ''} onClick={() => setView('2d')}>2D</button>
                  <button className={view === '3d' ? 'on' : ''} onClick={() => setView('3d')}>3D</button>
                </span>
              )}
            </span>
          </h3>
          {view === '2d' && model.scene ? (
            <Scene model={model} run={run} frame={frame} height={290} />
          ) : run.t.length > 1 ? (
            <Plot3D
              height={290} lines={line3} progress={frame} equal={equal3}
              labels={[withUnit(a3[0]), withUnit(a3[1]), withUnit(a3[2])]}
              markers={[{ p: [col3(a3[0])[frame], col3(a3[1])[frame], col3(a3[2])[frame]], slot: 2 }]}
            />
          ) : <p className="muted pad">No trajectory to show.</p>}
        </section>

        <section className="card">
          <h3>
            Phase portrait
            <span className="card-tools">
              <select value={py} onChange={(e) => patch({ phase: [px, e.target.value] })} aria-label="Vertical variable">{names.map((n) => <option key={n}>{n}</option>)}</select>
              vs
              <select value={px} onChange={(e) => patch({ phase: [e.target.value, py] })} aria-label="Horizontal variable">{names.map((n) => <option key={n}>{n}</option>)}</select>
            </span>
          </h3>
          <Plot
            height={290} series={phaseSeries} xLabel={withUnit(px ?? '')} yLabel={withUnit(py ?? '')} hover={false}
            equal={!!px && !!py && px !== py && unitOf(px) === unitOf(py) && isState(px) && isState(py)}
            markers={px && py && run.t.length ? [{ x: run.series[px][frame], y: run.series[py][frame], slot: 2 }] : []}
          />
        </section>

        <section className="card wide">
          <h3>
            Time series
            <span className="card-tools chips">
              {names.map((n) => (
                <button key={n} className={`chip${model.timeSeries.includes(n) ? ' on' : ''}`} aria-pressed={model.timeSeries.includes(n)} onClick={() => toggleShown(n)}>
                  <span className="swatch" style={{ background: `var(--series-${(names.indexOf(n) % 8) + 1})` }} />{n}
                </button>
              ))}
            </span>
          </h3>
          <Plot
            height={250} series={tsSeries} xLabel="time" yLabel={shown.length === 1 ? withUnit(shown[0]) : undefined} cursorX={t}
            empty="Select a variable above to chart it"
          />
        </section>

        <section className="card wide">
          <h3>
            Accuracy
            <span className="card-tools">
              <button className="btn small" disabled={!run.t.length || !!run.error} onClick={() => setAccuracy({ run, report: accuracyReport(model, run) })}>{report ? 'Check again' : 'Check accuracy'}</button>
            </span>
          </h3>
          {!report ? (
            <p className="muted">Runs the model twice more — once with tighter numerics, once with a different method — and reports how far each quantity moves. A result that does not move has converged; one that does is still telling you about the solver rather than the model.{accuracy && ' The model has changed since the last check.'}</p>
          ) : (
            <>
              <div className={`verdict ${report.worst < 1e-3 ? 'good-box' : 'stale-note'}`}>
                {report.worst < 1e-3
                  ? <>Converged: tightening the numerics and changing the method move no quantity by more than <b>{fmtNum(report.worst * 100, 2)} %</b> of its size.</>
                  : report.growing
                    ? <>Not converged, and the disagreement grows towards the end of the run (up to <b>{fmtNum(report.worst * 100, 2)} %</b>). That is the signature of sensitive dynamics: individual trajectories cannot be trusted that far out, though statistics of the motion may still be.</>
                    : <>Not converged: a quantity moves by <b>{fmtNum(report.worst * 100, 2)} %</b> of its size. Tighten the tolerance or reduce the step until this stops changing.</>}
              </div>
              {report.faster && (
                <div className="stale-note">
                  {report.faster.label} reached the same answer in {report.faster.ratio.toFixed(0)}× fewer steps{report.faster.method === 'ros23' ? ' — this system is stiff' : ''}.{' '}
                  <button className="link" onClick={() => patch({ method: report.faster!.method })}>Switch to {report.faster.label}</button>
                </div>
              )}
              <div className="accuracy-grid">
                {[report.refined, report.crossMethod].map((c, k) => (
                  <div key={k}>
                    <div className="field-label">{k === 0 ? 'Tighter numerics' : 'Different method'} <span className="muted">— {c.label}</span></div>
                    {c.error ? <div className="readout error">That run failed: {c.error}</div> : (
                      <table className="table compact">
                        <thead><tr><th>Quantity</th><th className="num">Largest change</th><th className="num">Relative</th><th className="num">At time</th></tr></thead>
                        <tbody>
                          {c.rows.map((r) => (
                            <tr key={r.name} className={r.worst / r.scale >= 1e-3 ? 'flag' : undefined}>
                              <td><code>{r.name}</code></td><td className="num">{fmtNum(r.worst, 3)}</td><td className="num">{fmtNum((r.worst / r.scale) * 100, 2)} %</td><td className="num">{fmtNum(r.at, 4)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ))}
              </div>
              {adaptive && stepSeries[0].x.length > 2 && (
                <details className="data-table">
                  <summary>Step size over the run</summary>
                  <Plot height={190} series={stepSeries} xLabel="time" yLabel="step size" logY exportName={`${model.name} step size`} />
                  <p className="muted help">Dips show where the solver had to slow down — sharp features, near-singular points, or events. A step size that stays tiny throughout suggests a stiff system.</p>
                </details>
              )}
              <p className="muted help">Changes are measured between recorded samples, so anything under about 0.1 % is within the resolution of the comparison. A conserved quantity staying constant is necessary for accuracy but does not prove it — use this check as well.</p>
            </>
          )}
        </section>

        <section className="card wide">
          <h3>Measurements <span className="card-tools muted">over the whole run · “now” follows the playhead · click a value to make it an expectation</span></h3>
          <div className="table-scroll">
            <table className="table compact">
              <thead>
                <tr><th>Quantity</th><th>Unit</th><th className="num">Now</th><th className="num">Final</th><th className="num">Minimum</th><th className="num">Maximum</th><th className="num">Time average</th><th className="num">Range</th><th className="num">Period</th></tr>
              </thead>
              <tbody>
                {stats.map((r) => (
                  <tr key={r.n}>
                    <td><code>{r.n}</code>{isState(r.n) ? '' : <span className="muted"> observable</span>}</td>
                    <td className="muted">{unitOf(r.n) || '—'}</td>
                    <td className="num">{run.series[r.n].length ? fmtNum(run.series[r.n][frame], 6) : '—'}</td>
                    {(['final', 'min', 'max', 'mean', 'range', 'period'] as const).map((m) => (
                      <td className="num pin-cell" key={m}>
                        {Number.isFinite(r[m]) ? (
                          <button className="pin" title={`Expect this: add "${m} of ${r.n}" to the model's expectations`} onClick={() => expect(r.n, m, r[m])}>{fmtNum(r[m], 6)}</button>
                        ) : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
