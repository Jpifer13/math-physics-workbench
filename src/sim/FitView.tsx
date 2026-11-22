import { useEffect, useMemo, useRef, useState } from 'react';
import { interpolate, parseTable, residuals, runsTest, type FitResult, type FitTarget, type Profile } from '../core/fit';
import { simulate, type ModelData, type OdeModel, type SimResult } from '../core/ode';
import { fmtNum } from '../core/units';
import { importData } from '../documents';
import { Plot, type Series } from '../components/Plot';
import { runFit, runProfile, type Task } from './compute';
import { useSim } from './store';

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const bare = (s: string) => s.toLowerCase().replace(/\s*[([].*$/, '').trim();

/** Compare the model with measured data and fit its parameters by least squares. */
export function FitView({ model, run }: { model: OdeModel; run: SimResult }) {
  const patch = useSim((s) => s.patch);
  const data = model.data;
  const [chosen, setChosen] = useState<string[]>([]);
  const [bounded, setBounded] = useState(false);
  const [fit, setFit] = useState<FitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [profiling, setProfiling] = useState(false);
  const task = useRef<Task<FitResult> | null>(null);
  const profileTask = useRef<Task<Profile[]> | null>(null);
  useEffect(() => () => { task.current?.cancel(); profileTask.current?.cancel(); }, []);
  useEffect(() => { setProfiles(null); profileTask.current?.cancel(); setProfiling(false); }, [fit]);

  const startProfile = () => {
    if (!fit) return;
    // Profile around the fitted values, whether or not they have been applied yet.
    const fitted = { ...model, params: model.params.map((p) => (p.name in fit.values ? { ...p, value: fit.values[p.name] } : p)) };
    setProfiling(true);
    const t = runProfile({ model: fitted, params: Object.keys(fit.values), targets, bounded, values: fit.values, errors: fit.errors });
    profileTask.current = t;
    t.promise.then(
      (r) => { if (profileTask.current === t) { setProfiles(r); setProfiling(false); } },
      (err) => { if (profileTask.current === t) { setProfiling(false); setMessage(err instanceof Error ? err.message : String(err)); } },
    );
  };

  const observables = [...model.states.map((s) => s.name), ...model.derived.map((d) => d.name)];
  const unitOf = (n: string) => model.states.find((s) => s.name === n)?.unit ?? model.derived.find((d) => d.name === n)?.unit ?? '';
  const params = chosen.filter((n) => model.params.some((p) => p.name === n));
  const setData = (d: ModelData | undefined) => { patch({ data: d }); setFit(null); setMessage(''); };

  const doImport = async () => {
    try {
      const file = await importData();
      if (!file) return;
      const columns = parseTable(file.text);
      // Pair up columns whose names match an observable; otherwise the second column with the first charted quantity.
      const pairs = columns.flatMap((c, i) => {
        const obs = i > 0 ? observables.find((o) => o.toLowerCase() === bare(c.name)) : undefined;
        return obs ? [{ valueCol: i, observable: obs }] : [];
      });
      setData({
        name: fileName(file.path), columns, timeCol: 0,
        pairs: pairs.length ? pairs : [{ valueCol: 1, observable: model.timeSeries.find((n) => observables.includes(n)) ?? observables[0] }],
      });
    } catch (err) {
      setMessage(`Could not import: ${err instanceof Error ? err.message : err}`);
    }
  };

  /** Stand-in for a measurement: sample the current run with noise and matching error bars. */
  const synthesize = () => {
    if (run.t.length < 10) return;
    const n = 120;
    const tEnd = run.t[run.t.length - 1];
    const t = Array.from({ length: n }, (_, i) => (tEnd * i) / (n - 1));
    const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
    const columns = [{ name: 't', values: t }];
    for (const s of model.states) {
      const y = run.series[s.name];
      const sigma = 0.02 * (Math.max(...y) - Math.min(...y) || 1);
      columns.push({ name: s.name, values: t.map((ti) => interpolate(run.t, y, ti) + sigma * gauss()) });
      columns.push({ name: `${s.name}_err`, values: t.map(() => sigma) });
    }
    const first = model.timeSeries.find((name) => model.states.some((s) => s.name === name)) ?? model.states[0].name;
    const col = columns.findIndex((c) => c.name === first);
    setData({ name: 'test data sampled from this run (2% noise)', columns, timeCol: 0, pairs: [{ valueCol: col, observable: first, sigmaCol: col + 1 }] });
  };

  const targets: FitTarget[] = useMemo(() => {
    if (!data) return [];
    const t = data.columns[data.timeCol]?.values ?? [];
    return data.pairs
      .filter((p) => data.columns[p.valueCol] && observables.includes(p.observable))
      .map((p) => ({ observable: p.observable, t, y: data.columns[p.valueCol].values, sigma: p.sigmaCol !== undefined ? data.columns[p.sigmaCol]?.values : undefined }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, observables.join('|')]);
  const current = useMemo(() => targets.map((t) => residuals(run, t.observable, t)), [run, targets]);
  const tData = targets[0]?.t ?? [];
  const tDataMax = tData.length ? Math.max(...tData) : 0;
  const tDataMin = tData.length ? Math.min(...tData) : 0;
  const uncovered = current.length ? tData.length - Math.min(...current.map((c) => c.used)) : 0;
  const badSigma = targets.some((t) => t.sigma && !t.sigma.every((v) => v > 0));
  const mixedSigma = targets.some((t) => t.sigma) && !targets.every((t) => t.sigma);

  // The fitted curves are shown alongside the current model until the values are applied.
  const fitted = useMemo(() => (fit ? simulate(model, fit.values) : null), [fit, model]);
  const applied = !!fit && Object.entries(fit.values).every(([k, v]) => model.params.find((p) => p.name === k)?.value === v);

  const start = () => {
    if (!targets.length) return;
    task.current?.cancel();
    setBusy(true);
    setMessage('');
    setFit(null);
    const t = runFit({ model, params, targets, bounded });
    task.current = t;
    t.promise.then(
      (r) => { if (task.current === t) { setFit(r); setBusy(false); } },
      (err) => { if (task.current === t) { setBusy(false); setMessage(err instanceof Error ? err.message : String(err)); } },
    );
  };
  const cancel = () => { task.current?.cancel(); task.current = null; setBusy(false); };
  const setPair = (i: number, p: Partial<ModelData['pairs'][number]>) => data && setData({ ...data, pairs: data.pairs.map((q, j) => (j === i ? { ...q, ...p } : q)) });

  return (
    <div className="experiment">
      <section className="card">
        <h3>
          Measured data
          <span className="card-tools">
            {data && <button className="btn small" onClick={() => setData(undefined)}>Remove data</button>}
          </span>
        </h3>
        <div className="design">
          <button className="btn primary" onClick={() => void doImport()}>Import data…</button>
          <button className="btn" onClick={synthesize} disabled={run.t.length < 10} title="Sample the current run with added noise — useful for trying the workflow or checking which parameters the data can pin down">Make test data from this run</button>
          {data && (
            <label>
              <span className="field-label">Time column</span>
              <select value={data.timeCol} onChange={(e) => setData({ ...data, timeCol: Number(e.target.value) })}>
                {data.columns.map((c, i) => <option key={i} value={i}>{c.name}</option>)}
              </select>
            </label>
          )}
        </div>
        {data && (
          <>
            <table className="table compact pairs">
              <thead><tr><th>Measured column</th><th>Model observable</th><th>Error bars (1σ)</th><th /></tr></thead>
              <tbody>
                {data.pairs.map((p, i) => (
                  <tr key={i}>
                    <td>
                      <select value={p.valueCol} onChange={(e) => setPair(i, { valueCol: Number(e.target.value) })} aria-label={`Measured column ${i + 1}`}>
                        {data.columns.map((c, k) => <option key={k} value={k}>{c.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={p.observable} onChange={(e) => setPair(i, { observable: e.target.value })} aria-label={`Observable ${i + 1}`}>
                        {observables.map((n) => <option key={n} value={n}>{n}{unitOf(n) ? ` (${unitOf(n)})` : ''}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={p.sigmaCol ?? ''} onChange={(e) => setPair(i, { sigmaCol: e.target.value === '' ? undefined : Number(e.target.value) })} aria-label={`Error column ${i + 1}`}>
                        <option value="">none</option>
                        {data.columns.map((c, k) => <option key={k} value={k}>{c.name}</option>)}
                      </select>
                    </td>
                    <td><button className="btn icon" title="Remove series" disabled={data.pairs.length === 1} onClick={() => setData({ ...data, pairs: data.pairs.filter((_, j) => j !== i) })}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              className="btn small" disabled={data.columns.length < 3}
              onClick={() => {
                const used = new Set([data.timeCol, ...data.pairs.flatMap((p) => [p.valueCol, p.sigmaCol])]);
                const col = data.columns.findIndex((_, k) => !used.has(k));
                const obs = observables.find((o) => !data.pairs.some((p) => p.observable === o)) ?? observables[0];
                setData({ ...data, pairs: [...data.pairs, { valueCol: col < 0 ? 1 : col, observable: obs }] });
              }}
            >+ Series</button>
          </>
        )}
        <p className="muted help">
          {data
            ? <>{data.name} · {tData.length.toLocaleString()} rows · time {fmtNum(tDataMin, 4)} to {fmtNum(tDataMax, 4)}. The data is saved inside the simulation file.</>
            : <>Import a table with a time column and one or more measured columns (CSV, TSV or whitespace-separated; a header row is optional). Columns of measurement errors can be used as error bars. Time must be in the same units as the model.</>}
        </p>
        {uncovered > 0 && (
          <div className="stale-note">
            {uncovered} of {tData.length} data points fall outside the simulated time span and are ignored.{' '}
            {tDataMax > model.tEnd && <button className="link" onClick={() => patch({ tEnd: tDataMax, stopWhen: undefined })}>Extend the run to t = {fmtNum(tDataMax, 4)}</button>}
          </div>
        )}
        {badSigma && <div className="stale-note">An error-bar column contains zero or negative values, so error bars are ignored for this fit.</div>}
        {mixedSigma && <div className="stale-note">Only some series have error bars. Give every series one to get χ² and absolute uncertainties; until then each series is weighted by its own spread.</div>}
        {message && <div className="readout error">{message}</div>}
      </section>

      {targets.length > 0 && (
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
            <label className="muted" title="Reject values outside each parameter's configured range"><input type="checkbox" checked={bounded} onChange={(e) => setBounded(e.target.checked)} /> keep within parameter ranges</label>
          </div>
          {busy && <progress className="scan-progress" aria-label="Fitting" />}

          <div className={targets.length > 1 ? 'fit-grid' : undefined}>
            {targets.map((t, k) => {
              const obs = t.observable;
              const colName = data!.columns[data!.pairs.filter((p) => observables.includes(p.observable))[k]?.valueCol]?.name ?? obs;
              const series: Series[] = [{ name: `data: ${colName}`, x: t.t, y: t.y, slot: 2, points: true }];
              if (run.series[obs]) series.push({ name: fit && !applied ? 'model (current parameters)' : 'model', x: run.t, y: run.series[obs], slot: 1, dashed: !!fit && !applied });
              if (fitted?.series[obs] && !applied) series.push({ name: 'model (fitted parameters)', x: fitted.t, y: fitted.series[obs], slot: 3 });
              const res = fit && !applied ? fit.targets[k]?.after : current[k];
              return (
                <div key={k}>
                  <Plot height={targets.length > 1 ? 250 : 320} series={series} xLabel="time" yLabel={`${obs}${unitOf(obs) ? ` (${unitOf(obs)})` : ''}`} xDomain={[Math.min(0, tDataMin), Math.max(tDataMax, 0) * 1.02 || 1]} />
                  {res && Number.isFinite(res.rms) && (
                    <div className="fit-stats">
                      <span><code>{obs}</code> RMS residual <b>{fmtNum(res.rms, 5)}</b>{unitOf(obs) ? ` ${unitOf(obs)}` : ''}</span>
                      <span>R² <b>{Number.isFinite(res.r2) ? res.r2.toFixed(5) : '—'}</b></span>
                      <span className="muted">{res.used} points</span>
                      {fit?.targets[k] && <span className="muted">before: RMS {fmtNum(fit.targets[k].before.rms, 5)}</span>}
                    </div>
                  )}
                  {res && runsTest(res.residuals) < -3 && (
                    <div className="stale-note">
                      The residuals of {obs} are not scattered randomly — they stay on one side for long stretches (runs test z = {runsTest(res.residuals).toFixed(1)}).
                      The model is missing a systematic feature of these data, so the quoted uncertainties understate the real error.
                    </div>
                  )}
                  {res && res.used > 0 && (
                    <details className="data-table">
                      <summary>Residuals of {obs} (model − data)</summary>
                      <Plot height={180} series={[{ name: 'residual', x: t.t, y: res.residuals, slot: 2, points: true }]} xLabel="time" yLabel="residual" hover={false} />
                    </details>
                  )}
                </div>
              );
            })}
          </div>

          {fit && (
            <>
              <div className="fit-stats">
                {fit.reducedChi2 !== undefined && (
                  <span title="Near 1 when the model describes the data to within the stated error bars; much larger means a poor model or underestimated errors, much smaller means overestimated errors.">
                    χ² per degree of freedom <b>{fmtNum(fit.reducedChi2, 4)}</b>
                  </span>
                )}
                <span className="muted">{fit.evals} model runs{fit.converged ? '' : ' · stopped at the evaluation limit'}</span>
              </div>
              <table className="table compact">
                <thead><tr><th>Parameter</th><th className="num">Before</th><th className="num">Fitted</th><th className="num">± 1σ</th><th className="num">Change</th><th>Unit</th></tr></thead>
                <tbody>
                  {Object.entries(fit.values).map(([name, v]) => {
                    const p = model.params.find((q) => q.name === name);
                    const before = applied ? undefined : p?.value;
                    return (
                      <tr key={name}>
                        <td><code>{name}</code>{p?.label && <span className="muted"> {p.label}</span>}</td>
                        <td className="num">{before === undefined ? '—' : fmtNum(before, 7)}</td>
                        <td className="num"><b>{fmtNum(v, 7)}</b></td>
                        <td className="num">{Number.isFinite(fit.errors[name]) ? fmtNum(fit.errors[name], 2) : <span className="warn" title="The data do not constrain this parameter on its own">undetermined</span>}</td>
                        <td className="num">{before === undefined || before === 0 ? '—' : `${((v / before - 1) * 100).toFixed(2)} %`}</td>
                        <td className="muted">{p?.unit ?? ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {(() => {
                const names = Object.keys(fit.values);
                const undetermined = names.some((n) => !Number.isFinite(fit.errors[n]));
                const pairs = names.flatMap((a, i) => names.slice(i + 1).map((b, k) => ({ a, b, r: fit.correlation[i][i + 1 + k] })));
                const strong = pairs.filter((p) => Math.abs(p.r) > 0.95);
                return (
                  <>
                    {pairs.length > 0 && !undetermined && (
                      <p className="fit-corr">Correlations: {pairs.map((p) => `${p.a}–${p.b} ${p.r.toFixed(3)}`).join(' · ')}</p>
                    )}
                    {(strong.length > 0 || undetermined) && (
                      <div className="stale-note">
                        {undetermined
                          ? 'These data cannot determine all of the chosen parameters independently — only a combination of them. Fix one and fit the rest, or add a series that tells them apart.'
                          : `${strong.map((p) => `${p.a} and ${p.b}`).join('; ')} ${strong.length > 1 ? 'are' : 'is a pair that is'} almost perfectly correlated: the data mostly fix a combination, so the individual values are poorly determined.`}
                      </div>
                    )}
                  </>
                );
              })()}
              <div className="eq-actions" style={{ justifyContent: 'flex-start', marginTop: 10 }}>
                {applied ? <span className="good">Fitted values applied to the model.</span> : (
                  <button className="btn primary" onClick={() => patch({ params: model.params.map((p) => (p.name in fit.values ? { ...p, value: fit.values[p.name] } : p)) })}>Apply fitted values</button>
                )}
              </div>
              <div className="profile-head">
                <span className="field-label">Uncertainties without the linear approximation</span>
                {profiling ? <button className="btn small" onClick={() => { profileTask.current?.cancel(); setProfiling(false); }}>Cancel</button>
                  : <button className="btn small" onClick={startProfile}>{profiles ? 'Profile again' : 'Profile the fit'}</button>}
              </div>
              {profiling && <progress className="scan-progress" aria-label="Profiling" />}
              {!profiles && !profiling && <p className="muted help">Steps each parameter across a range, re-fitting the others at every value, and plots how much worse the best possible fit becomes. The interval is read off the curve itself, so it can be asymmetric and it reveals a second minimum if there is one.</p>}
              {profiles && (
                <div className="fit-grid">
                  {profiles.map((pr) => {
                    const [lo, hi] = pr.interval;
                    const v = fit.values[pr.param];
                    const unit = model.params.find((q) => q.name === pr.param)?.unit;
                    return (
                      <div key={pr.param}>
                        <Plot
                          height={200} hover
                          series={[{ name: 'rise in misfit', x: pr.x, y: pr.delta, slot: 1 }, { name: '1σ level', x: [pr.x[0], pr.x[pr.x.length - 1]], y: [1, 1], slot: 2, dashed: true }]}
                          xLabel={`${pr.param}${unit ? ` (${unit})` : ''}`} yLabel={fit.reducedChi2 !== undefined ? 'Δχ²' : 'ΔSS / s²'}
                          yDomain={[0, Math.min(Math.max(...pr.delta.filter(Number.isFinite), 2), 12)]} exportName={`profile of ${pr.param}`}
                        />
                        <div className="fit-stats">
                          <span><code>{pr.param}</code> = <b>{fmtNum(v, 6)}</b>{' '}
                            {lo !== null && hi !== null
                              ? <>−{fmtNum(v - lo, 2)} / +{fmtNum(hi - v, 2)}</>
                              : <span className="warn">{lo === null && hi === null ? 'not bounded within the scanned range' : lo === null ? `no lower bound within the scan; +${fmtNum(hi! - v, 2)}` : `−${fmtNum(v - lo, 2)}; no upper bound within the scan`}</span>}
                          </span>
                          <span className="muted">linear estimate ±{Number.isFinite(fit.errors[pr.param]) ? fmtNum(fit.errors[pr.param], 2) : '—'}</span>
                        </div>
                        {pr.secondMinimum && <div className="stale-note">The misfit dips below the 1σ level a second time: there is another value of {pr.param} that fits about as well.</div>}
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="muted help">
                Each parameter's configured range is surveyed first, then the best region is refined by Nelder–Mead simplex.{' '}
                {fit.reducedChi2 !== undefined
                  ? 'Uncertainties are one standard deviation, propagated from the error bars through the local linearisation.'
                  : 'Uncertainties are one standard deviation from the local linearisation, assuming independent errors of equal size within each series.'}
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
