import { useEffect, useMemo, useRef, useState } from 'react';
import { MEASURES, measureRun, scanPoint, scanValues, toCsv, type ScanConfig } from '../core/measure';
import type { OdeModel, SimResult } from '../core/ode';
import { fmtNum } from '../core/units';
import { exportCsv } from '../documents';
import { NumberField } from '../components/NumberField';
import { Plot } from '../components/Plot';
import { useSim } from './store';

interface Result {
  config: ScanConfig;
  /** Fingerprint of everything except the scanned parameter's own value. */
  basis: string;
  x: number[];
  y: number[];
}

// The last result survives switching between the Run and Experiment views.
let cached: { docVersion: number; result: Result } | null = null;

function defaultConfig(model: OdeModel): ScanConfig | null {
  const p = model.params[0];
  const obs = model.timeSeries[0] ?? model.states[0]?.name;
  if (!p || !obs) return null;
  return { param: p.name, from: p.min, to: p.max, points: 41, observable: obs, measure: 'max' };
}

/** What a result depends on, so we can tell when it has gone stale. */
const basisOf = (model: OdeModel, c: ScanConfig) =>
  JSON.stringify([c, model.states, model.derived, model.params.map((p) => (p.name === c.param ? p.name : [p.name, p.value])), model.tEnd, model.dt, model.method, model.tol, model.stopWhen]);

/**
 * A virtual experiment: vary one parameter across a range, run the simulation
 * at each value, and reduce each run to one measured number.
 */
export function ExperimentView({ model, run }: { model: OdeModel; run: SimResult }) {
  const patch = useSim((s) => s.patch);
  const docVersion = useSim((s) => s.docVersion);
  const [result, setResultState] = useState<Result | null>(cached?.docVersion === docVersion ? cached.result : null);
  const setResult = (r: Result | null) => {
    cached = r ? { docVersion: useSim.getState().docVersion, result: r } : null;
    setResultState(r);
  };
  const [progress, setProgress] = useState<number | null>(null);
  const [exported, setExported] = useState('');
  const job = useRef(0);

  const fallback = useMemo(() => defaultConfig(model), [model]);
  const saved = model.experiment;
  const observables = ['t', ...model.states.map((s) => s.name), ...model.derived.map((d) => d.name)];
  // Repair a saved setup if the model has since been edited underneath it.
  const config: ScanConfig | null = saved && fallback
    ? {
        ...saved,
        param: model.params.some((p) => p.name === saved.param) ? saved.param : fallback.param,
        observable: observables.includes(saved.observable) ? saved.observable : fallback.observable,
      }
    : fallback;
  const set = (p: Partial<ScanConfig>) => config && patch({ experiment: { ...config, ...p } });

  const start = async (c: ScanConfig) => {
    const id = ++job.current;
    const snapshot = useSim.getState().model;
    const xs = scanValues(c);
    const ys: number[] = [];
    setProgress(0);
    setExported('');
    let slice = performance.now();
    for (let i = 0; i < xs.length; i++) {
      ys.push(scanPoint(snapshot, c, xs[i]));
      // Yield to the UI between slices so the window stays responsive and the scan can be cancelled.
      if (performance.now() - slice > 40) {
        setProgress((i + 1) / xs.length);
        await new Promise((r) => setTimeout(r));
        if (job.current !== id) return;
        slice = performance.now();
      }
    }
    if (job.current !== id) return;
    setResult({ config: c, basis: basisOf(snapshot, c), x: xs, y: ys });
    setProgress(null);
  };
  const cancel = () => { job.current++; setProgress(null); };

  // Opening the view (or a new document) runs the experiment once so there is something to look at.
  useEffect(() => {
    if (cached?.docVersion === docVersion) {
      setResultState(cached.result);
      return;
    }
    setResult(null);
    const m = useSim.getState().model;
    const c = m.experiment ?? defaultConfig(m);
    if (c && c.to > c.from) void start(c);
    return () => { job.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docVersion]);

  if (!config) {
    return <p className="muted pad">Add at least one parameter and one state variable to set up an experiment.</p>;
  }

  const param = model.params.find((p) => p.name === config.param)!;
  const mdef = MEASURES.find((m) => m.id === config.measure)!;
  const unitOf = (n: string) => model.states.find((s) => s.name === n)?.unit ?? model.derived.find((d) => d.name === n)?.unit ?? '';
  const valid = config.to > config.from && config.points >= 2;
  const stale = !!result && result.basis !== basisOf(model, config);

  const r = result;
  const rParam = r ? model.params.find((p) => p.name === r.config.param) : undefined;
  const rMeasure = r ? MEASURES.find((m) => m.id === r.config.measure)! : mdef;
  const xLabel = r ? `${rParam?.label ?? r.config.param} ${r.config.param}${rParam?.unit ? ` (${rParam.unit})` : ''}` : '';
  const yUnit = r ? (rMeasure.isTime ? '' : unitOf(r.config.observable)) : '';
  const yLabel = r ? `${rMeasure.label.toLowerCase()} of ${r.config.observable}${yUnit ? ` (${yUnit})` : ''}` : '';

  const finite = r ? r.y.map((v, i) => [v, i] as const).filter(([v]) => Number.isFinite(v)) : [];
  const peak = finite.length ? finite.reduce((a, b) => (b[0] > a[0] ? b : a)) : null;
  const trough = finite.length ? finite.reduce((a, b) => (b[0] < a[0] ? b : a)) : null;
  const failed = r ? r.y.length - finite.length : 0;
  // The measurement for the model as currently configured, shown as a marker on the curve.
  const here = r && !stale && rParam ? measureRun(run, r.config.observable, r.config.measure) : NaN;

  const doExport = async () => {
    if (!r) return;
    try {
      setExported(await exportCsv(toCsv([{ name: xLabel, values: r.x }, { name: yLabel, values: r.y }]), `${model.name} ${r.config.param} scan`));
    } catch (err) {
      setExported(`Export failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  return (
    <div className="experiment">
      <section className="card">
        <h3>Experiment design</h3>
        <div className="design">
          <label>
            <span className="field-label">Vary parameter</span>
            <select value={config.param} onChange={(e) => {
              const p = model.params.find((x) => x.name === e.target.value)!;
              set({ param: p.name, from: p.min, to: p.max });
            }}>
              {model.params.map((p) => <option key={p.name} value={p.name}>{p.name}{p.label ? ` — ${p.label}` : ''}</option>)}
            </select>
          </label>
          <label><span className="field-label">From</span><NumberField className="code" value={config.from} onChange={(from) => set({ from })} label="Scan from" /></label>
          <label><span className="field-label">To {param.unit ? `(${param.unit})` : ''}</span><NumberField className="code" value={config.to} onChange={(to) => set({ to })} label="Scan to" /></label>
          <label><span className="field-label">Runs</span><NumberField className="code" value={config.points} onChange={(points) => set({ points: Math.max(2, Math.min(400, Math.round(points))) })} label="Number of runs" /></label>
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
            <button className="btn primary" disabled={!valid} onClick={() => void start(config)}>Run experiment</button>
          ) : (
            <button className="btn" onClick={cancel}>Cancel</button>
          )}
        </div>
        <p className="muted help">
          {mdef.hint}. Each of the {config.points} runs uses the model on the left with <code>{config.param}</code> replaced; all other parameters stay as set.
        </p>
        {!valid && <div className="readout error">“To” must be greater than “From”, with at least two runs.</div>}
        {progress !== null && <progress className="scan-progress" value={progress} max={1} aria-label="Experiment progress" />}
      </section>

      {r && (
        <section className={`card${stale ? ' stale' : ''}`}>
          <h3>
            <span>Result: {yLabel} vs <code>{r.config.param}</code></span>
            <span className="card-tools">
              {exported && <span className="muted">{exported}</span>}
              {peak && rParam && (
                <button className="btn small" title={`Set ${r.config.param} to the value with the largest measurement`} onClick={() => patch({ params: model.params.map((p) => (p.name === r.config.param ? { ...p, value: r.x[peak[1]] } : p)) })}>
                  Set {r.config.param} to peak
                </button>
              )}
              <button className="btn small" onClick={() => void doExport()}>Export (CSV)</button>
            </span>
          </h3>
          {stale && (
            <div className="stale-note" role="status">
              The model or the experiment design has changed since this was measured. <button className="link" onClick={() => void start(config)}>Run again</button>
            </div>
          )}
          <Plot
            height={340}
            series={[{ name: yLabel, x: r.x, y: r.y }]}
            xLabel={xLabel}
            yLabel={yLabel}
            markers={Number.isFinite(here) && rParam ? [{ x: rParam.value, y: here, slot: 2, label: `current ${r.config.param}` }] : []}
            empty="Every run failed — check the model for errors"
          />
          <div className="readouts">
            {peak && <span>maximum <b>{fmtNum(peak[0], 6)}</b> at {r.config.param} = <b>{fmtNum(r.x[peak[1]], 6)}</b></span>}
            {trough && <span>minimum <b>{fmtNum(trough[0], 6)}</b> at {r.config.param} = <b>{fmtNum(r.x[trough[1]], 6)}</b></span>}
            {failed > 0 && <span className="warn">{failed} of {r.y.length} runs gave no measurement (shown as gaps)</span>}
          </div>
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
        </section>
      )}
    </div>
  );
}
