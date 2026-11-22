import { useEffect, useMemo, useRef, useState } from 'react';
import { interpolate, parseTable, residuals, type FitResult } from '../core/fit';
import { simulate, type OdeModel, type SimResult } from '../core/ode';
import { fmtNum } from '../core/units';
import { importData } from '../documents';
import { Plot, type Series } from '../components/Plot';
import { runFit, type Task } from './compute';
import { useSim } from './store';

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** Compare the model with measured data and fit its parameters by least squares. */
export function FitView({ model, run }: { model: OdeModel; run: SimResult }) {
  const data = useSim((s) => s.data);
  const patch = useSim((s) => s.patch);
  const [observable, setObservable] = useState(model.timeSeries[0] ?? model.states[0]?.name ?? '');
  const [chosen, setChosen] = useState<string[]>([]);
  const [fit, setFit] = useState<FitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const task = useRef<Task<FitResult> | null>(null);
  useEffect(() => () => task.current?.cancel(), []);

  const observables = [...model.states.map((s) => s.name), ...model.derived.map((d) => d.name)];
  const obs = observables.includes(observable) ? observable : observables[0] ?? '';
  const unitOf = (n: string) => model.states.find((s) => s.name === n)?.unit ?? model.derived.find((d) => d.name === n)?.unit ?? '';
  const params = chosen.filter((n) => model.params.some((p) => p.name === n));

  const setData = (d: typeof data) => { useSim.setState({ data: d }); setFit(null); setMessage(''); };

  const doImport = async () => {
    try {
      const file = await importData();
      if (!file) return;
      const columns = parseTable(file.text);
      // Guess the value column from the observable's name, else take the second column.
      const guess = columns.findIndex((c, i) => i > 0 && c.name.toLowerCase().replace(/\s*\(.*$/, '') === obs.toLowerCase());
      setData({ name: fileName(file.path), columns, timeCol: 0, valueCol: guess > 0 ? guess : 1 });
    } catch (err) {
      setMessage(`Could not import: ${err instanceof Error ? err.message : err}`);
    }
  };

  /** Stand-in for a measurement: sample the current run and add noise, to try the workflow or test identifiability. */
  const synthesize = () => {
    const y = run.series[obs];
    if (!y || run.t.length < 10) return;
    const span = Math.max(...y) - Math.min(...y) || 1;
    const n = 120;
    const tEnd = run.t[run.t.length - 1];
    const t: number[] = [], v: number[] = [];
    for (let i = 0; i < n; i++) {
      const ti = (tEnd * i) / (n - 1);
      // Box–Muller Gaussian noise at 2% of the signal range.
      const g = Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
      t.push(ti);
      v.push(interpolate(run.t, y, ti) + 0.02 * span * g);
    }
    setData({ name: `synthetic ${obs} from this run (2% noise)`, columns: [{ name: 't', values: t }, { name: obs, values: v }], timeCol: 0, valueCol: 1 });
  };

  const dataset = useMemo(
    () => (data ? { t: data.columns[data.timeCol].values, y: data.columns[data.valueCol].values } : null),
    [data],
  );
  const current = useMemo(() => (dataset ? residuals(run, obs, dataset) : null), [run, obs, dataset]);
  const tDataMax = dataset ? Math.max(...dataset.t) : 0;
  const uncovered = dataset && current ? dataset.t.length - current.used : 0;

  // The fitted curve is shown alongside the current model until the values are applied.
  const fitted = useMemo(() => (fit ? simulate(model, fit.values) : null), [fit, model]);
  const applied = !!fit && Object.entries(fit.values).every(([k, v]) => model.params.find((p) => p.name === k)?.value === v);

  const start = () => {
    if (!dataset) return;
    task.current?.cancel();
    setBusy(true);
    setMessage('');
    setFit(null);
    const t = runFit({ model, params, observable: obs, data: dataset });
    task.current = t;
    t.promise.then(
      (r) => { if (task.current === t) { setFit(r); setBusy(false); } },
      (err) => { if (task.current === t) { setBusy(false); setMessage(err instanceof Error ? err.message : String(err)); } },
    );
  };
  const cancel = () => { task.current?.cancel(); task.current = null; setBusy(false); };

  const series: Series[] = [];
  if (dataset) series.push({ name: `data: ${data!.columns[data!.valueCol].name}`, x: dataset.t, y: dataset.y, slot: 2, points: true });
  if (run.series[obs]) series.push({ name: fit && !applied ? 'model (current parameters)' : 'model', x: run.t, y: run.series[obs], slot: 1, dashed: !!fit && !applied });
  if (fitted?.series[obs] && !applied) series.push({ name: 'model (fitted parameters)', x: fitted.t, y: fitted.series[obs], slot: 3 });
  const shownResiduals = fit && !applied ? fit.after : current;

  return (
    <div className="experiment">
      <section className="card">
        <h3>Measured data</h3>
        <div className="design">
          <button className="btn primary" onClick={() => void doImport()}>Import data…</button>
          <button className="btn" onClick={synthesize} disabled={!run.series[obs]} title="Sample the current run with added noise — useful for trying the workflow or checking which parameters the data can pin down">Make test data from this run</button>
          {data && (
            <>
              <label>
                <span className="field-label">Time column</span>
                <select value={data.timeCol} onChange={(e) => setData({ ...data, timeCol: Number(e.target.value) })}>
                  {data.columns.map((c, i) => <option key={i} value={i}>{c.name}</option>)}
                </select>
              </label>
              <label>
                <span className="field-label">Measured column</span>
                <select value={data.valueCol} onChange={(e) => setData({ ...data, valueCol: Number(e.target.value) })}>
                  {data.columns.map((c, i) => <option key={i} value={i}>{c.name}</option>)}
                </select>
              </label>
            </>
          )}
          <label>
            <span className="field-label">Compare with</span>
            <select value={obs} onChange={(e) => { setObservable(e.target.value); setFit(null); }}>
              {observables.map((n) => <option key={n} value={n}>{n}{unitOf(n) ? ` (${unitOf(n)})` : ''}</option>)}
            </select>
          </label>
        </div>
        <p className="muted help">
          {data
            ? <>{data.name} · {dataset!.t.length.toLocaleString()} rows · time {fmtNum(Math.min(...dataset!.t), 4)} to {fmtNum(tDataMax, 4)}. The data stays in this session; it is not saved inside the simulation file.</>
            : <>Import a table with a time column and at least one measured column (CSV, TSV or whitespace-separated; a header row is optional). Time must be in the same units as the model.</>}
        </p>
        {uncovered > 0 && (
          <div className="stale-note">
            {uncovered} of {dataset!.t.length} data points fall outside the simulated time span and are ignored.{' '}
            {tDataMax > model.tEnd && <button className="link" onClick={() => patch({ tEnd: tDataMax, stopWhen: undefined })}>Extend the run to t = {fmtNum(tDataMax, 4)}</button>}
          </div>
        )}
        {message && <div className="readout error">{message}</div>}
      </section>

      {dataset && (
        <section className="card">
          <h3>
            Model against data
            <span className="card-tools">
              {busy ? <button className="btn small" onClick={cancel}>Cancel</button> : <button className="btn small primary" disabled={!params.length} onClick={start} title={params.length ? '' : 'Tick at least one parameter to fit'}>Fit parameters</button>}
            </span>
          </h3>
          <div className="field-label">Parameters free to vary</div>
          <div className="fit-params">
            {model.params.map((p) => (
              <label key={p.name} title={p.label}>
                <input type="checkbox" checked={chosen.includes(p.name)} onChange={(e) => { setChosen(e.target.checked ? [...chosen, p.name] : chosen.filter((n) => n !== p.name)); }} />
                <code>{p.name}</code> <span className="muted">= {fmtNum(p.value, 5)}{p.unit ? ` ${p.unit}` : ''}</span>
              </label>
            ))}
          </div>
          {busy && <progress className="scan-progress" aria-label="Fitting" />}
          <Plot height={320} series={series} xLabel="time" yLabel={`${obs}${unitOf(obs) ? ` (${unitOf(obs)})` : ''}`} xDomain={dataset.t.length ? [Math.min(0, Math.min(...dataset.t)), Math.max(tDataMax, 0) * 1.02 || 1] : undefined} />
          {shownResiduals && Number.isFinite(shownResiduals.rms) && (
            <div className="fit-stats">
              <span>RMS residual <b>{fmtNum(shownResiduals.rms, 5)}</b>{unitOf(obs) ? ` ${unitOf(obs)}` : ''}</span>
              <span>R² <b>{Number.isFinite(shownResiduals.r2) ? shownResiduals.r2.toFixed(5) : '—'}</b></span>
              <span className="muted">{shownResiduals.used} points compared</span>
              {fit && <span className="muted">before the fit: RMS {fmtNum(fit.before.rms, 5)}, R² {Number.isFinite(fit.before.r2) ? fit.before.r2.toFixed(5) : '—'} · {fit.evals} model runs{fit.converged ? '' : ' · stopped at the evaluation limit'}</span>}
            </div>
          )}

          {fit && (
            <>
              <table className="table compact">
                <thead><tr><th>Parameter</th><th className="num">Before</th><th className="num">Fitted</th><th className="num">Change</th><th>Unit</th></tr></thead>
                <tbody>
                  {Object.entries(fit.values).map(([name, v]) => {
                    const p = model.params.find((q) => q.name === name);
                    const before = applied ? undefined : p?.value;
                    return (
                      <tr key={name}>
                        <td><code>{name}</code>{p?.label && <span className="muted"> {p.label}</span>}</td>
                        <td className="num">{before === undefined ? '—' : fmtNum(before, 7)}</td>
                        <td className="num"><b>{fmtNum(v, 7)}</b></td>
                        <td className="num">{before === undefined || before === 0 ? '—' : `${((v / before - 1) * 100).toFixed(2)} %`}</td>
                        <td className="muted">{p?.unit ?? ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="eq-actions" style={{ justifyContent: 'flex-start', marginTop: 10 }}>
                {applied ? <span className="good">Fitted values applied to the model.</span> : (
                  <button className="btn primary" onClick={() => patch({ params: model.params.map((p) => (p.name in fit.values ? { ...p, value: fit.values[p.name] } : p)) })}>Apply fitted values</button>
                )}
              </div>
              <p className="muted help">Least squares on the chosen observable by Nelder–Mead simplex, starting from the current values. It finds a local optimum: start near a plausible answer, and fit only parameters the data can distinguish.</p>
            </>
          )}

          {shownResiduals && shownResiduals.used > 0 && (
            <details className="data-table">
              <summary>Residuals (model − data)</summary>
              <Plot height={200} series={[{ name: 'residual', x: dataset.t, y: shownResiduals.residuals, slot: 2, points: true }]} xLabel="time" yLabel="residual" hover={false} />
            </details>
          )}
        </section>
      )}
    </div>
  );
}
