import { useEffect, useMemo, useRef, useState } from 'react';
import { MEASURES, measureRun, scanValues, scanValues2, toCsv, type ScanConfig } from '../core/measure';
import { simulate, type OdeModel, type SimResult } from '../core/ode';
import { fmtNum } from '../core/units';
import { exportCsv } from '../documents';
import { Heatmap } from '../components/Heatmap';
import { NumberField } from '../components/NumberField';
import { Plot } from '../components/Plot';
import { Plot3D } from '../components/Plot3D';
import { runJobs, type Task } from './compute';
import { useSim } from './store';

interface Result {
  config: ScanConfig;
  /** Fingerprint of everything the result depends on, to detect staleness. */
  basis: string;
  x: number[];
  /** 1-D: one value per x. */
  y: number[];
  /** 2-D: second-parameter values and z[iy][ix]. */
  x2?: number[];
  z?: number[][];
  ms: number;
}

// The last result survives switching between views.
let cached: { docVersion: number; result: Result } | null = null;

function defaultConfig(model: OdeModel): ScanConfig | null {
  const p = model.params[0];
  const obs = model.timeSeries[0] ?? model.states[0]?.name;
  if (!p || !obs) return null;
  return { param: p.name, from: p.min, to: p.max, points: 41, observable: obs, measure: 'max' };
}

const is2D = (c: ScanConfig) => !!c.param2 && c.param2 !== c.param;

const basisOf = (model: OdeModel, c: ScanConfig) =>
  JSON.stringify([
    c, model.states, model.derived,
    model.params.map((p) => (p.name === c.param || (is2D(c) && p.name === c.param2) ? p.name : [p.name, p.value])),
    model.tEnd, model.dt, model.method, model.tol, model.stopWhen, model.events,
  ]);

/**
 * A virtual experiment: vary one or two parameters across a range, run the
 * simulation at each value, and reduce each run to one measured number.
 */
export function ExperimentView({ model, run }: { model: OdeModel; run: SimResult }) {
  const patch = useSim((s) => s.patch);
  const docVersion = useSim((s) => s.docVersion);
  const [result, setResultState] = useState<Result | null>(cached?.docVersion === docVersion ? cached.result : null);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [mapView, setMapView] = useState<'map' | '3d'>('map');
  const [curveView, setCurveView] = useState<'response' | 'family'>('response');
  const task = useRef<Task<number[]> | null>(null);
  const setResult = (r: Result | null) => {
    cached = r ? { docVersion: useSim.getState().docVersion, result: r } : null;
    setResultState(r);
  };

  const fallback = useMemo(() => defaultConfig(model), [model]);
  const saved = model.experiment;
  const observables = ['t', ...model.states.map((s) => s.name), ...model.derived.map((d) => d.name)];
  const hasParam = (n?: string) => !!n && model.params.some((p) => p.name === n);
  // Repair a saved setup if the model has since been edited underneath it.
  const config: ScanConfig | null = saved && fallback
    ? {
        ...saved,
        param: hasParam(saved.param) ? saved.param : fallback.param,
        param2: hasParam(saved.param2) ? saved.param2 : undefined,
        observable: observables.includes(saved.observable) ? saved.observable : fallback.observable,
      }
    : fallback;
  const set = (p: Partial<ScanConfig>) => config && patch({ experiment: { ...config, ...p } });

  const start = (c: ScanConfig) => {
    task.current?.cancel();
    const snapshot = useSim.getState().model;
    const xs = scanValues(c);
    const x2 = is2D(c) ? scanValues2(c) : undefined;
    const overrides = x2
      ? x2.flatMap((v2) => xs.map((v) => ({ [c.param]: v, [c.param2!]: v2 })))
      : xs.map((v) => ({ [c.param]: v }));
    const began = performance.now();
    setProgress(0);
    setStatus('');
    const t = runJobs(snapshot, overrides, c.observable, c.measure, setProgress);
    task.current = t;
    t.promise.then(
      (values) => {
        if (task.current !== t) return;
        const base = { config: c, basis: basisOf(snapshot, c), x: xs, ms: performance.now() - began };
        setResult(x2 ? { ...base, y: [], x2, z: x2.map((_, j) => values.slice(j * xs.length, (j + 1) * xs.length)) } : { ...base, y: values });
        setProgress(null);
      },
      (err) => {
        if (task.current !== t) return;
        setProgress(null);
        if (err?.message !== 'cancelled') setStatus(`The experiment failed: ${err?.message ?? err}`);
      },
    );
  };
  const cancel = () => { task.current?.cancel(); task.current = null; setProgress(null); };

  // Opening the view (or a new document) runs the experiment once so there is something to look at.
  useEffect(() => {
    if (cached?.docVersion === docVersion) {
      setResultState(cached.result);
    } else {
      setResult(null);
      const m = useSim.getState().model;
      const c = m.experiment ?? defaultConfig(m);
      if (c && c.to > c.from) start(c);
    }
    return () => { task.current?.cancel(); task.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docVersion]);

  if (!config) {
    return <p className="muted pad">Add at least one parameter and one state variable to set up an experiment.</p>;
  }

  const two = is2D(config);
  const paramOf = (n?: string) => model.params.find((p) => p.name === n);
  const mdef = MEASURES.find((m) => m.id === config.measure)!;
  const unitOf = (n: string) => model.states.find((s) => s.name === n)?.unit ?? model.derived.find((d) => d.name === n)?.unit ?? '';
  const valid = config.to > config.from && config.points >= 2 && (!two || ((config.to2 ?? 1) > (config.from2 ?? 0) && (config.points2 ?? 21) >= 2));
  const totalRuns = Math.round(config.points) * (two ? Math.round(config.points2 ?? 21) : 1);
  const stale = !!result && result.basis !== basisOf(model, config);

  const r = result;
  const axis = (n?: string) => { const p = paramOf(n); return n ? `${p?.label ? `${p.label} ` : ''}${n}${p?.unit ? ` (${p.unit})` : ''}` : ''; };
  const rMeasure = r ? MEASURES.find((m) => m.id === r.config.measure)! : mdef;
  const xLabel = r ? axis(r.config.param) : '';
  const x2Label = r?.x2 ? axis(r.config.param2) : '';
  const yUnit = r ? (rMeasure.isTime ? '' : unitOf(r.config.observable)) : '';
  const yLabel = r ? `${rMeasure.label.toLowerCase()} of ${r.config.observable}${yUnit ? ` (${yUnit})` : ''}` : '';

  // Extrema over whichever grid the result has.
  const flat = r ? (r.z ? r.z.flat() : r.y) : [];
  const finite = flat.map((v, i) => [v, i] as const).filter(([v]) => Number.isFinite(v));
  const peak = finite.length ? finite.reduce((a, b) => (b[0] > a[0] ? b : a)) : null;
  const trough = finite.length ? finite.reduce((a, b) => (b[0] < a[0] ? b : a)) : null;
  const failed = flat.length - finite.length;
  const at = (i: number) => (r?.x2 ? { [r.config.param]: r.x[i % r.x.length], [r.config.param2!]: r.x2[Math.floor(i / r.x.length)] } : r ? { [r.config.param]: r.x[i] } : {});
  const where = (i: number) => Object.entries(at(i)).map(([k, v]) => `${k} = ${fmtNum(v, 6)}`).join(', ');
  const rP1 = r ? paramOf(r.config.param) : undefined;
  const rP2 = r?.x2 ? paramOf(r.config.param2) : undefined;
  // The measurement for the model as currently configured, shown as a marker.
  const here = r && !stale ? measureRun(run, r.config.observable, r.config.measure) : NaN;

  const doExport = async () => {
    if (!r) return;
    const cols = r.x2 && r.z
      ? [
          { name: xLabel, values: r.x2.flatMap(() => r.x) },
          { name: x2Label, values: r.x2.flatMap((v) => r.x.map(() => v)) },
          { name: yLabel, values: r.z.flat() },
        ]
      : [{ name: xLabel, values: r.x }, { name: yLabel, values: r.y }];
    try {
      setStatus(await exportCsv(toCsv(cols), `${model.name} ${r.config.param}${r.x2 ? ` ${r.config.param2}` : ''} scan`));
    } catch (err) {
      setStatus(`Export failed: ${err instanceof Error ? err.message : err}`);
    }
  };
  const setToPeak = () => {
    if (!peak) return;
    const target = at(peak[1]);
    patch({ params: model.params.map((p) => (p.name in target ? { ...p, value: target[p.name] } : p)) });
  };

  const others = model.params.filter((p) => p.name !== config.param);

  // A family of trajectories: the observable over time at a handful of values across the scanned range.
  const familyOn = !!r && !r.x2 && curveView === 'family' && r.config.observable !== 't';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const family = useMemo(() => {
    if (!familyOn || !r) return [];
    const count = Math.min(6, r.x.length);
    return Array.from({ length: count }, (_, k) => {
      const value = r.x[Math.round((k * (r.x.length - 1)) / (count - 1))];
      const one = simulate(model, { [r.config.param]: value });
      return { name: `${r.config.param} = ${fmtNum(value, 4)}`, x: one.t, y: one.series[r.config.observable] ?? [], slot: k + 1 };
    });
  }, [familyOn, r, model]);

  return (
    <div className="experiment">
      <section className="card">
        <h3>Experiment design</h3>
        <div className="design">
          <label>
            <span className="field-label">Vary parameter</span>
            <select value={config.param} onChange={(e) => {
              const p = paramOf(e.target.value)!;
              set({ param: p.name, from: p.min, to: p.max, ...(config.param2 === p.name ? { param2: undefined } : {}) });
            }}>
              {model.params.map((p) => <option key={p.name} value={p.name}>{p.name}{p.label ? ` — ${p.label}` : ''}</option>)}
            </select>
          </label>
          <label><span className="field-label">From</span><NumberField className="code" value={config.from} onChange={(from) => set({ from })} label="Scan from" /></label>
          <label><span className="field-label">To {paramOf(config.param)?.unit ? `(${paramOf(config.param)!.unit})` : ''}</span><NumberField className="code" value={config.to} onChange={(to) => set({ to })} label="Scan to" /></label>
          <label><span className="field-label">Steps</span><NumberField className="code narrow" value={config.points} onChange={(points) => set({ points: Math.max(2, Math.min(400, Math.round(points))) })} label="Number of steps" /></label>
          <span className="design-break" />
          <label>
            <span className="field-label">And a second parameter</span>
            <select value={two ? config.param2 : ''} onChange={(e) => {
              const p = paramOf(e.target.value);
              // A grid multiplies the run count, so start both axes at a moderate resolution.
              set(p ? { param2: p.name, from2: p.min, to2: p.max, points2: 21, points: Math.min(config.points, 31) } : { param2: undefined });
            }} disabled={!others.length}>
              <option value="">none — a single curve</option>
              {others.map((p) => <option key={p.name} value={p.name}>{p.name}{p.label ? ` — ${p.label}` : ''}</option>)}
            </select>
          </label>
          {two && (
            <>
              <label><span className="field-label">From</span><NumberField className="code" value={config.from2 ?? 0} onChange={(from2) => set({ from2 })} label="Second scan from" /></label>
              <label><span className="field-label">To {paramOf(config.param2)?.unit ? `(${paramOf(config.param2)!.unit})` : ''}</span><NumberField className="code" value={config.to2 ?? 1} onChange={(to2) => set({ to2 })} label="Second scan to" /></label>
              <label><span className="field-label">Steps</span><NumberField className="code narrow" value={config.points2 ?? 21} onChange={(points2) => set({ points2: Math.max(2, Math.min(120, Math.round(points2))) })} label="Number of steps for the second parameter" /></label>
            </>
          )}
          <span className="design-break" />
          <label>
            <span className="field-label">Measure</span>
            <select value={config.measure} title={mdef.hint} onChange={(e) => set({ measure: e.target.value as ScanConfig['measure'] })}>
              {MEASURES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <label>
            <span className="field-label">Of observable</span>
            <select value={config.observable} onChange={(e) => set({ observable: e.target.value })}>
              {observables.map((n) => <option key={n} value={n}>{n === 't' ? 't (time)' : n}</option>)}
            </select>
          </label>
          {progress === null ? (
            <button className="btn primary" disabled={!valid} onClick={() => start(config)}>Run experiment</button>
          ) : (
            <button className="btn" onClick={cancel}>Cancel</button>
          )}
          <span className="muted runs">{totalRuns.toLocaleString()} runs</span>
        </div>
        <p className="muted help">
          {mdef.hint}. Each run uses the model on the left with {two ? <>
            <code>{config.param}</code> and <code>{config.param2}</code></> : <code>{config.param}</code>} replaced; all other parameters stay as set. Runs execute in background threads.
        </p>
        {!valid && <div className="readout error">Each “To” must be greater than its “From”, with at least two steps.</div>}
        {status && <p className="muted help">{status}</p>}
        {progress !== null && <progress className="scan-progress" value={progress} max={1} aria-label="Experiment progress" />}
      </section>

      {r && (
        <section className={`card${stale ? ' stale' : ''}`}>
          <h3>
            <span>Result: {yLabel} vs <code>{r.config.param}</code>{r.x2 && <> and <code>{r.config.param2}</code></>}</span>
            <span className="card-tools">
              {!r.x2 && r.config.observable !== 't' && (
                <span className="seg" role="group" aria-label="Result view">
                  <button className={curveView === 'response' ? 'on' : ''} onClick={() => setCurveView('response')}>Response</button>
                  <button className={curveView === 'family' ? 'on' : ''} title="The observable over time at six values across the scanned range" onClick={() => setCurveView('family')}>Trajectories</button>
                </span>
              )}
              {r.x2 && (
                <span className="seg" role="group" aria-label="Map view">
                  <button className={mapView === 'map' ? 'on' : ''} onClick={() => setMapView('map')}>Map</button>
                  <button className={mapView === '3d' ? 'on' : ''} onClick={() => setMapView('3d')}>3D</button>
                </span>
              )}
              {peak && <button className="btn small" title="Set the scanned parameter(s) to where the measurement is largest" onClick={setToPeak}>Set to peak</button>}
              <button className="btn small" onClick={() => void doExport()}>Export (CSV)</button>
            </span>
          </h3>
          {stale && (
            <div className="stale-note" role="status">
              The model or the experiment design has changed since this was measured. <button className="link" onClick={() => start(config)}>Run again</button>
            </div>
          )}
          <div className="result-plot">
            {r.x2 && r.z ? (
              mapView === 'map' ? (
                <Heatmap
                  height={380} xs={r.x} ys={r.x2} z={r.z} xLabel={xLabel} yLabel={x2Label} zLabel={yLabel}
                  marker={!stale && rP1 && rP2 ? { x: rP1.value, y: rP2.value } : undefined}
                />
              ) : (
                <Plot3D
                  height={420} surface={{ xs: r.x, ys: r.x2, z: r.z }} labels={[xLabel, x2Label, yLabel]}
                  markers={Number.isFinite(here) && rP1 && rP2 ? [{ p: [rP1.value, rP2.value, here], slot: 2 }] : []}
                />
              )
            ) : familyOn ? (
              <Plot height={340} series={family} xLabel="time" yLabel={`${r.config.observable}${unitOf(r.config.observable) ? ` (${unitOf(r.config.observable)})` : ''}`} />
            ) : (
              <Plot
                height={340}
                series={[{ name: yLabel, x: r.x, y: r.y }]}
                xLabel={xLabel}
                yLabel={yLabel}
                markers={Number.isFinite(here) && rP1 ? [{ x: rP1.value, y: here, slot: 2, label: `current ${r.config.param}` }] : []}
                empty="Every run failed — check the model for errors"
              />
            )}
          </div>
          <div className="readouts">
            {peak && <span>maximum <b>{fmtNum(peak[0], 6)}</b> at {where(peak[1])}</span>}
            {trough && <span>minimum <b>{fmtNum(trough[0], 6)}</b> at {where(trough[1])}</span>}
            {failed > 0 && <span className="warn">{failed} of {flat.length} runs gave no measurement (shown as gaps)</span>}
            <span className="muted">{flat.length.toLocaleString()} runs in {r.ms < 1000 ? `${Math.round(r.ms)} ms` : `${(r.ms / 1000).toFixed(1)} s`}</span>
          </div>
          {!r.x2 && (
            <details className="data-table">
              <summary>Data table ({r.x.length} rows)</summary>
              <div className="table-scroll tall">
                <table className="table compact">
                  <thead><tr><th className="num">#</th><th className="num">{xLabel}</th><th className="num">{yLabel}</th></tr></thead>
                  <tbody>
                    {r.x.map((x, i) => (
                      <tr key={i}><td className="num muted">{i + 1}</td><td className="num">{fmtNum(x, 8)}</td><td className="num">{Number.isFinite(r.y[i]) ? fmtNum(r.y[i], 8) : '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
