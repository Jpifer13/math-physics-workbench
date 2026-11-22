import { useEffect, useMemo, useRef, useState } from 'react';
import { MEASURES, measureRun, toCsv } from '../core/measure';
import type { OdeModel, Param, SimResult, UncertainInput, UncertaintyConfig } from '../core/ode';
import {
  histogram, inputProblem, makeDesign, overridesOf, quantileBands, sampleCount, sobolIndices, spread, totalRuns,
  type SobolResult, type Spread,
} from '../core/sensitivity';
import { provenance } from '../core/trust';
import { fmtNum } from '../core/units';
import { APP_VERSION } from '../version';
import { exportCsv } from '../documents';
import { Bars } from '../components/Bars';
import { NumberField } from '../components/NumberField';
import { Plot } from '../components/Plot';
import { runEnsemble, type Ensemble, type Task } from './compute';
import { useSim } from './store';

/** Intervals of the time grid the ensemble is resampled onto for the band chart. */
const TRACE_POINTS = 200;

interface Result {
  config: UncertaintyConfig;
  /** Fingerprint of everything the result depends on, to detect staleness. */
  basis: string;
  n: number;
  /** Sampled parameter values, one row per run, in the design's order. */
  points: number[][];
  values: number[];
  spread: Spread;
  sobol: SobolResult | null;
  /** Quantiles of the observable over time: 2.5%, 16%, 50%, 84%, 97.5%. */
  bands: { t: number[]; q: number[][] } | null;
  ms: number;
}

// The last result survives switching between views.
let cached: { docVersion: number; result: Result } | null = null;

const round = (v: number) => parseFloat(v.toPrecision(6));

/** A starting guess when nothing better is known: normally distributed, 5% of the value either way. */
const defaultInput = (p: Param): UncertainInput => ({
  param: p.name, dist: 'normal', a: p.value,
  b: round(p.value !== 0 ? Math.abs(p.value) * 0.05 : (p.max - p.min) / 20 || 0.05),
});

function defaultConfig(model: OdeModel): UncertaintyConfig | null {
  const observable = model.experiment?.observable ?? model.timeSeries[0] ?? model.states[0]?.name;
  if (!model.params.length || !observable) return null;
  // A parameter set to zero has no natural scale to guess a spread from, so it starts out fixed.
  const varied = model.params.filter((p) => p.value !== 0);
  return { inputs: (varied.length ? varied : model.params).map(defaultInput), samples: 512, observable, measure: model.experiment?.measure ?? 'final', seed: 1 };
}

const basisOf = (model: OdeModel, c: UncertaintyConfig) =>
  JSON.stringify([
    c, model.states, model.derived,
    model.params.map((p) => (c.inputs.some((i) => i.param === p.name) ? p.name : [p.name, p.value])),
    model.tEnd, model.dt, model.method, model.tol, model.stopWhen, model.events,
  ]);

const pct = (v: number) => `${Math.round(Math.min(1, Math.max(0, v)) * 100)}%`;
const list = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/**
 * Uncertainty analysis: give parameters a spread, sample them all together,
 * and see how much a measurement varies and which inputs are responsible.
 */
export function UncertaintyView({ model, run }: { model: OdeModel; run: SimResult }) {
  const patch = useSim((s) => s.patch);
  const docVersion = useSim((s) => s.docVersion);
  const [result, setResultState] = useState<Result | null>(cached?.docVersion === docVersion ? cached.result : null);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const task = useRef<Task<Ensemble> | null>(null);
  const setResult = (r: Result | null) => {
    cached = r ? { docVersion: useSim.getState().docVersion, result: r } : null;
    setResultState(r);
  };

  useEffect(() => {
    setResultState(cached?.docVersion === docVersion ? cached.result : null);
    return () => { task.current?.cancel(); task.current = null; };
  }, [docVersion]);

  // The histogram as a stepped outline over a shaded area.
  const hist = useMemo(() => {
    if (!result) return null;
    const h = histogram(result.values.slice(0, 2 * result.n));
    const x = h.counts.flatMap((_, i) => [h.edges[i], h.edges[i + 1]]);
    const y = h.counts.flatMap((c) => [c, c]);
    return { x, y, zero: x.map(() => 0), top: Math.max(1, ...h.counts) };
  }, [result]);

  const fallback = useMemo(() => defaultConfig(model), [model]);
  const saved = model.uncertainty;
  const observables = ['t', ...model.states.map((s) => s.name), ...model.derived.map((d) => d.name)];
  const paramOf = (n: string) => model.params.find((p) => p.name === n);
  // Repair a saved setup if the model has since been edited underneath it.
  const config: UncertaintyConfig | null = saved && fallback
    ? {
        ...saved,
        inputs: saved.inputs.filter((i) => paramOf(i.param)),
        observable: observables.includes(saved.observable) ? saved.observable : fallback.observable,
      }
    : fallback;

  if (!config) {
    return <p className="muted pad">Add at least one parameter and one state variable to set up an uncertainty analysis.</p>;
  }

  const set = (p: Partial<UncertaintyConfig>) => patch({ uncertainty: { ...config, ...p } });
  const inputOf = (n: string) => config.inputs.find((i) => i.param === n);
  const setInput = (name: string, next: UncertainInput | null) =>
    // Keep the inputs in the model's parameter order whatever order they were ticked in.
    set({ inputs: model.params.flatMap((p) => (p.name === name ? (next ? [next] : []) : inputOf(p.name) ?? [])) });
  const setDist = (i: UncertainInput, dist: UncertainInput['dist']) => {
    if (dist === i.dist) return;
    // Convert so the mean and the standard deviation stay the same.
    const next = dist === 'normal'
      ? { a: round((i.a + i.b) / 2), b: round((i.b - i.a) / Math.sqrt(12)) }
      : { a: round(i.a - Math.sqrt(3) * i.b), b: round(i.a + Math.sqrt(3) * i.b) };
    setInput(i.param, { ...i, dist, ...next });
  };

  const problems = config.inputs.map(inputProblem).filter(Boolean);
  const valid = config.inputs.length > 0 && !problems.length;
  const runs = totalRuns(config.samples, config.inputs.length);
  const mdef = MEASURES.find((m) => m.id === config.measure)!;
  const unitOf = (n: string) => model.states.find((s) => s.name === n)?.unit ?? model.derived.find((d) => d.name === n)?.unit ?? '';

  const start = (c: UncertaintyConfig) => {
    task.current?.cancel();
    const snapshot = useSim.getState().model;
    const design = makeDesign(c.inputs, c.samples, c.seed);
    const began = performance.now();
    setProgress(0);
    setStatus('');
    // A stop condition can end runs long before the set duration; size the time grid to how long they actually last.
    const ended = run.error ? NaN : run.t[run.t.length - 1];
    const span = ended < snapshot.tEnd * 0.999 ? Math.min(snapshot.tEnd, ended * 1.5) : snapshot.tEnd;
    const t = runEnsemble(snapshot, overridesOf(design), c.observable, c.measure, setProgress, { jobs: design.n, points: TRACE_POINTS, span });
    task.current = t;
    t.promise.then(
      ({ values, traces }) => {
        if (task.current !== t) return;
        const kept = traces.filter((x): x is number[] => !!x);
        setResult({
          config: c, basis: basisOf(snapshot, c), n: design.n, points: design.points, values,
          // Samples A and B are both plain draws from the input distributions; the remaining blocks are not.
          spread: spread(values.slice(0, 2 * design.n)),
          sobol: sobolIndices(values, design.n, c.inputs.length, 200, c.seed),
          bands: kept.length >= 8
            ? { t: Array.from({ length: TRACE_POINTS + 1 }, (_, k) => (span * k) / TRACE_POINTS), q: quantileBands(kept, [0.025, 0.16, 0.5, 0.84, 0.975]) }
            : null,
          ms: performance.now() - began,
        });
        setProgress(null);
      },
      (err) => {
        if (task.current !== t) return;
        setProgress(null);
        if (err?.message !== 'cancelled') setStatus(`The analysis failed: ${err?.message ?? err}`);
      },
    );
  };
  const cancel = () => { task.current?.cancel(); task.current = null; setProgress(null); };

  const r = result;
  const stale = !!r && r.basis !== basisOf(model, config);
  const rMeasure = r ? MEASURES.find((m) => m.id === r.config.measure)! : mdef;
  const yUnit = r ? (rMeasure.isTime ? '' : unitOf(r.config.observable)) : '';
  const what = r ? `${rMeasure.label.toLowerCase()} of ${r.config.observable}` : '';
  const whatLabel = `${what}${yUnit ? ` (${yUnit})` : ''}`;
  const s = r?.spread;
  const here = r && !stale ? measureRun(run, r.config.observable, r.config.measure) : NaN;

  // Inputs ranked by how much of the variance they are involved in.
  const ranked = r?.sobol
    ? r.sobol.indices.map((index, i) => ({ name: r.config.inputs[i].param, ...index })).sort((a, b) => b.total - a.total)
    : [];
  const top = ranked[0];
  const alone = ranked.reduce((sum, x) => sum + Math.max(0, x.first), 0);
  const negligible = ranked.filter((x) => x.totalHi < 0.02).map((x) => x.name);
  const rough = ranked.some((x) => x.totalHi - x.totalLo > 0.25 || x.firstHi - x.firstLo > 0.25);
  // The ranking is only as good as the intervals: say so when the first two could swap.
  const unsettled = ranked.length > 1 && ranked[0].totalLo < ranked[1].totalHi && ranked[1].total > 0.02;

  const doExport = async () => {
    if (!r || !s) return;
    const rows = r.points.slice(0, 2 * r.n);
    const cols = [
      ...r.config.inputs.map((input, i) => ({ name: `${input.param}${paramOf(input.param)?.unit ? ` (${paramOf(input.param)!.unit})` : ''}`, values: rows.map((p) => p[i]) })),
      { name: whatLabel, values: r.values.slice(0, 2 * r.n) },
    ];
    const notes = [
      ...provenance(model, { appVersion: APP_VERSION, when: new Date().toISOString(), uncertainty: r.config }),
      `result: mean ${s.mean}, standard deviation ${s.sd}, median ${s.median}, 68% interval ${s.lo68} to ${s.hi68}, 95% interval ${s.lo95} to ${s.hi95}, from ${s.count} runs`,
      ...(r.sobol?.indices ?? []).map((x, i) => `sensitivity to ${r.config.inputs[i].param}: first-order ${x.first.toFixed(4)} (95% interval ${x.firstLo.toFixed(4)} to ${x.firstHi.toFixed(4)}), total ${x.total.toFixed(4)} (${x.totalLo.toFixed(4)} to ${x.totalHi.toFixed(4)})`),
    ];
    try {
      setStatus(await exportCsv(toCsv(cols, notes), `${model.name} uncertainty of ${r.config.observable}`));
    } catch (err) {
      setStatus(`Export failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  return (
    <div className="experiment">
      <section className="card">
        <h3>Uncertain inputs</h3>
        <div className="table-scroll">
          <table className="table compact uq-inputs">
            <thead><tr><th>Parameter</th><th>Set to</th><th>Varies as</th><th>Spread</th></tr></thead>
            <tbody>
              {model.params.map((p) => {
                const input = inputOf(p.name);
                return (
                  <tr key={p.name} className={input ? '' : 'off'}>
                    <td>
                      <label className="uq-name">
                        <input type="checkbox" checked={!!input} onChange={(e) => setInput(p.name, e.target.checked ? defaultInput(p) : null)} />
                        <code>{p.name}</code>{p.label && <span className="muted">{p.label}</span>}
                      </label>
                    </td>
                    <td className="num">{fmtNum(p.value, 6)}{p.unit ? ` ${p.unit}` : ''}</td>
                    <td>
                      {input ? (
                        <select value={input.dist} aria-label={`How ${p.name} varies`} onChange={(e) => setDist(input, e.target.value as UncertainInput['dist'])}>
                          <option value="normal">Normal (mean ± std. dev.)</option>
                          <option value="uniform">Uniform (anywhere in a range)</option>
                        </select>
                      ) : <span className="muted">fixed</span>}
                    </td>
                    <td>
                      {input && (
                        <span className="uq-spread">
                          <NumberField className="code" value={input.a} onChange={(a) => setInput(p.name, { ...input, a })} label={input.dist === 'normal' ? `Mean of ${p.name}` : `Lowest ${p.name}`} />
                          <span className="muted">{input.dist === 'normal' ? '±' : 'to'}</span>
                          <NumberField className="code" value={input.b} onChange={(b) => setInput(p.name, { ...input, b })} label={input.dist === 'normal' ? `Standard deviation of ${p.name}` : `Highest ${p.name}`} />
                          {p.unit && <span className="muted">{p.unit}</span>}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="design uq-design">
          <label>
            <span className="field-label">Measure</span>
            <select value={config.measure} title={mdef.hint} onChange={(e) => set({ measure: e.target.value as UncertaintyConfig['measure'] })}>
              {MEASURES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <label>
            <span className="field-label">Of observable</span>
            <select value={config.observable} onChange={(e) => set({ observable: e.target.value })}>
              {observables.map((n) => <option key={n} value={n}>{n === 't' ? 't (time)' : n}</option>)}
            </select>
          </label>
          <label title="Base sample size. More samples narrow the intervals on the sensitivity indices.">
            <span className="field-label">Samples</span>
            <NumberField className="code narrow" value={config.samples} onChange={(v) => set({ samples: sampleCount(v) })} label="Base sample size" />
          </label>
          <label title="The same seed draws the same samples, so a result can be reproduced exactly.">
            <span className="field-label">Seed</span>
            <NumberField className="code narrow" value={config.seed} onChange={(v) => set({ seed: Math.max(0, Math.round(v)) })} label="Sampler seed" />
          </label>
          {progress === null ? (
            <button className="btn primary" disabled={!valid} onClick={() => start(config)}>Run analysis</button>
          ) : (
            <button className="btn" onClick={cancel}>Cancel</button>
          )}
          <span className="muted runs">{runs.toLocaleString()} runs</span>
        </div>
        <p className="muted help">
          Tick the parameters you do not know exactly and say how well you know them. All of them are varied together (a Latin hypercube
          sample), so the result covers combinations of values, not one parameter at a time. Unticked parameters stay as set.
          Runs execute in background threads.
        </p>
        {!config.inputs.length && <div className="readout error">Tick at least one parameter to vary.</div>}
        {problems.map((p) => <div key={p} className="readout error">{p}.</div>)}
        {status && <p className="muted help">{status}</p>}
        {progress !== null && <progress className="scan-progress" value={progress} max={1} aria-label="Analysis progress" />}
      </section>

      {r && s && (
        <section className={`card${stale ? ' stale' : ''}`}>
          <h3>
            <span>Spread of the {what}</span>
            <span className="card-tools"><button className="btn small" onClick={() => void doExport()}>Export (CSV)</button></span>
          </h3>
          {stale && (
            <div className="stale-note" role="status">
              The model or the analysis has changed since this was computed. <button className="link" disabled={!valid} onClick={() => start(config)}>Run again</button>
            </div>
          )}
          {s.count < 2 ? (
            <div className="readout error">Every run failed, so there is nothing to summarise. Check the model for errors, or narrow the spread of the inputs.</div>
          ) : (
            <>
              <div className="fit-stats">
                <span>mean <b>{fmtNum(s.mean, 5)}</b> ± <b>{fmtNum(s.sd, 3)}</b>{yUnit ? ` ${yUnit}` : ''}{s.mean !== 0 && <span className="muted"> ({fmtNum((100 * s.sd) / Math.abs(s.mean), 3)}%)</span>}</span>
                <span>median <b>{fmtNum(s.median, 5)}</b></span>
                <span>68% of runs between <b>{fmtNum(s.lo68, 5)}</b> and <b>{fmtNum(s.hi68, 5)}</b></span>
                <span>95% between <b>{fmtNum(s.lo95, 5)}</b> and <b>{fmtNum(s.hi95, 5)}</b></span>
              </div>
              <div className="result-plot">
                {hist && (
                  <Plot
                    height={240}
                    series={[{ name: 'runs', x: hist.x, y: hist.y }]}
                    bands={[{ x: hist.x, lo: hist.zero, hi: hist.y, slot: 1 }]}
                    xLabel={whatLabel} yLabel="number of runs" yDomain={[0, hist.top * 1.1]} hover={false}
                    markers={Number.isFinite(here) ? [{ x: here, y: 0, slot: 2, label: 'with parameters as set' }] : []}
                    exportName={`${model.name} spread of ${r.config.observable}`}
                  />
                )}
              </div>
              <div className="readouts">
                {s.failed > 0 && <span className="warn">{s.failed} of {s.count + s.failed} runs gave no measurement and are left out</span>}
                <span className="muted">{r.values.length.toLocaleString()} runs in {r.ms < 1000 ? `${Math.round(r.ms)} ms` : `${(r.ms / 1000).toFixed(1)} s`}; intervals are read off the sample, not assumed normal</span>
              </div>
            </>
          )}
        </section>
      )}

      {r && s && s.count >= 2 && (
        <section className={`card${stale ? ' stale' : ''}`}>
          <h3>What drives the spread</h3>
          {r.config.inputs.length < 2 ? (
            <p className="muted help">Only <code>{r.config.inputs[0]?.param}</code> is varied, so all of the spread comes from it. Tick a second parameter to see which matters more.</p>
          ) : !r.sobol || !top ? (
            <p className="muted help">The {what} did not change across the samples, or too few runs gave a measurement, so there is no variation to attribute.</p>
          ) : (
            <>
              <div className="result-plot">
                <Bars
                  label={`Share of the variance of the ${what} due to each input`}
                  series={['on its own', 'including its interactions']}
                  rows={ranked.map((x) => ({
                    label: x.name,
                    values: [{ value: x.first, lo: x.firstLo, hi: x.firstHi }, { value: x.total, lo: x.totalLo, hi: x.totalHi }],
                  }))}
                />
              </div>
              <ul className="howto uq-findings">
                <li>
                  <code>{top.name}</code> matters most: on its own it accounts for <b>{pct(top.first)}</b> of the variance of the {what}
                  {top.total - top.first > 0.05 ? <>, and <b>{pct(top.total)}</b> once its interactions with the other inputs are counted.</> : '.'}
                </li>
                {alone < 0.75 && (
                  <li className="warn">
                    Only {pct(alone)} of the variance comes from inputs acting alone. The rest arises from combinations of inputs, which
                    varying one parameter at a time cannot show.
                  </li>
                )}
                {negligible.length > 0 && negligible.length < ranked.length && (
                  <li>{list(negligible)} {negligible.length > 1 ? 'have' : 'has'} almost no influence here (under 2% of the variance): knowing {negligible.length > 1 ? 'them' : 'it'} better would not narrow the result.</li>
                )}
                {unsettled && <li className="warn">The intervals of <code>{ranked[0].name}</code> and <code>{ranked[1].name}</code> overlap, so which of the two matters more is not settled.</li>}
                {rough && <li className="warn">These estimates are still rough — the whiskers show the 95% interval. Raise the number of samples to narrow them.</li>}
                {r.sobol.rows < r.n && <li className="warn">{r.n - r.sobol.rows} of {r.n} sample rows were left out because one of their runs gave no measurement.</li>}
              </ul>
              <details className="data-table">
                <summary>Sensitivity indices ({ranked.length} inputs)</summary>
                <div className="table-scroll">
                  <table className="table compact">
                    <thead><tr><th>Input</th><th className="num">First-order</th><th className="num">95% interval</th><th className="num">Total</th><th className="num">95% interval</th></tr></thead>
                    <tbody>
                      {ranked.map((x) => (
                        <tr key={x.name}>
                          <td><code>{x.name}</code></td>
                          <td className="num">{x.first.toFixed(3)}</td><td className="num muted">{x.firstLo.toFixed(3)} to {x.firstHi.toFixed(3)}</td>
                          <td className="num">{x.total.toFixed(3)}</td><td className="num muted">{x.totalLo.toFixed(3)} to {x.totalHi.toFixed(3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="muted help">
                  Sobol indices from {(r.sobol.rows * (ranked.length + 2)).toLocaleString()} runs. First-order: the share of the variance that would
                  disappear on average if that input were known exactly. Total: the share that would remain if every other input were known exactly.
                </p>
              </details>
            </>
          )}
        </section>
      )}

      {r && r.bands && s && s.count >= 2 && (
        <section className={`card${stale ? ' stale' : ''}`}>
          <h3><span><code>{r.config.observable}</code> over time, across the samples</span></h3>
          <div className="result-plot">
            <Plot
              height={300}
              bands={[
                { x: r.bands.t, lo: r.bands.q[0], hi: r.bands.q[4], slot: 1, opacity: 0.14 },
                { x: r.bands.t, lo: r.bands.q[1], hi: r.bands.q[3], slot: 1, opacity: 0.22 },
              ]}
              series={[
                { name: 'median of the samples', x: r.bands.t, y: r.bands.q[2], slot: 1 },
                ...(!stale && run.series[r.config.observable] ? [{ name: 'with parameters as set', x: run.t, y: run.series[r.config.observable], slot: 2, dashed: true }] : []),
              ]}
              xLabel="time" yLabel={`${r.config.observable}${unitOf(r.config.observable) ? ` (${unitOf(r.config.observable)})` : ''}`}
              exportName={`${model.name} ${r.config.observable} uncertainty band`}
            />
          </div>
          <p className="muted help">
            The darker band holds 68% of the runs at each moment and the lighter one 95%. Where fewer than half of the runs are still going
            (a stop condition ended the others), nothing is drawn.
          </p>
        </section>
      )}
    </div>
  );
}
