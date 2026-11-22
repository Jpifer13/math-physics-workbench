import { useEffect, useMemo, useRef, useState } from 'react';
import { measure, toCsv } from '../core/measure';
import { sampleIndex, type OdeModel, type SimResult } from '../core/ode';
import { fmtNum } from '../core/units';
import { exportCsv } from '../documents';
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
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run],
  );

  const exportRun = async () => {
    const csv = toCsv([{ name: 't', values: run.t }, ...names.map((n) => ({ name: withUnit(n), values: run.series[n] }))]);
    try {
      setExported(await exportCsv(csv, `${model.name} run`));
    } catch (err) {
      setExported(`Export failed: ${err instanceof Error ? err.message : err}`);
    }
  };
  const holdReference = () =>
    setReference({ run, label: model.params.map((p) => `${p.name} = ${fmtNum(p.value, 4)}`).join(', ') });

  const s = run.stats;

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
        <button className="btn small" onClick={() => void exportRun()} disabled={!run.t.length}>Export run (CSV)</button>
      </div>
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
          <h3>Measurements <span className="card-tools muted">over the whole run · “now” follows the playhead</span></h3>
          <div className="table-scroll">
            <table className="table compact">
              <thead>
                <tr><th>Quantity</th><th>Unit</th><th className="num">Now</th><th className="num">Final</th><th className="num">Minimum</th><th className="num">Maximum</th><th className="num">Time average</th><th className="num">Period</th></tr>
              </thead>
              <tbody>
                {stats.map((r) => (
                  <tr key={r.n}>
                    <td><code>{r.n}</code>{isState(r.n) ? '' : <span className="muted"> observable</span>}</td>
                    <td className="muted">{unitOf(r.n) || '—'}</td>
                    <td className="num">{run.series[r.n].length ? fmtNum(run.series[r.n][frame], 6) : '—'}</td>
                    <td className="num">{fmtNum(r.final, 6)}</td>
                    <td className="num">{fmtNum(r.min, 6)}</td>
                    <td className="num">{fmtNum(r.max, 6)}</td>
                    <td className="num">{fmtNum(r.mean, 6)}</td>
                    <td className="num">{Number.isFinite(r.period) ? fmtNum(r.period, 6) : '—'}</td>
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
