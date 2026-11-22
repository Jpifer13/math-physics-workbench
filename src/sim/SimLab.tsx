import { useEffect, useMemo, useRef, useState } from 'react';
import { simulate, type OdeModel } from '../core/ode';
import { fmtNum } from '../core/units';
import { Plot } from '../components/Plot';
import { NumberField } from '../components/NumberField';
import { Tex } from '../components/Tex';
import { MODELS } from './models';
import { Scene } from './Scene';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const SPEEDS = [0.25, 0.5, 1, 2, 4];

export function SimLab() {
  const [model, setModel] = useState<OdeModel>(() => clone(MODELS[0]));
  const [shown, setShown] = useState<string[]>(MODELS[0].timeSeries);
  const [phase, setPhase] = useState<[string, string]>(MODELS[0].phase);
  const [editing, setEditing] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [tNow, setTNow] = useState(0);

  const run = useMemo(() => simulate(model), [model]);
  const names = Object.keys(run.series);
  const tLast = run.t.length ? run.t[run.t.length - 1] : 0;

  const pick = (m: OdeModel) => {
    setModel(clone(m));
    setShown(m.timeSeries);
    setPhase(m.phase);
    setTNow(0);
    setPlaying(true);
  };
  const patch = (p: Partial<OdeModel>) => setModel((m) => ({ ...m, ...p }));

  // Playback clock.
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
  const frame = tLast > 0 ? Math.round((t / tLast) * (run.t.length - 1)) : 0;

  const visible = shown.filter((n) => run.series[n]);
  const unitOf = (n: string) => model.states.find((s) => s.name === n)?.unit ?? model.derived.find((d) => d.name === n)?.unit ?? '';
  const withUnit = (n: string) => (unitOf(n) ? `${n} (${unitOf(n)})` : n);
  const tsSeries = useMemo(
    () => visible.map((n) => ({ name: withUnit(n), x: run.t, y: run.series[n], slot: names.indexOf(n) + 1 })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, visible.join('|')],
  );
  const px = run.series[phase[0]] ? phase[0] : names[0];
  const py = run.series[phase[1]] ? phase[1] : names[1] ?? names[0];
  const phaseSeries = useMemo(
    () => (px && py ? [{ name: `${py} vs ${px}`, x: run.series[px], y: run.series[py] }] : []),
    [run, px, py],
  );

  return (
    <div className="sim-layout">
      <aside className="sim-side">
        <div className="panel-title">Models</div>
        <div className="sim-side-scroll">
          <div className="model-list">
            {MODELS.map((m) => (
              <button key={m.id} className={`model-item${m.id === model.id ? ' on' : ''}`} onClick={() => pick(m)}>{m.name}</button>
            ))}
          </div>
          <p className="summary">{model.summary}</p>
          <div className="equations">{model.equations.map((e, i) => <Tex key={i} block tex={e} />)}</div>
          {model.explore && <div className="explore"><b>Try this.</b> {model.explore}</div>}

          <div className="panel-subtitle">Parameters</div>
          {model.params.map((p, i) => (
            <label className="slider" key={i}>
              <span className="slider-head">
                <span>{p.label ?? p.name} <code>{p.name}</code></span>
                <b>{fmtNum(p.value, 4)}{p.unit ? ` ${p.unit}` : ''}</b>
              </span>
              <input
                type="range" min={p.min} max={p.max} step={p.step ?? (p.max - p.min) / 200} value={p.value}
                onChange={(e) => patch({ params: model.params.map((q, j) => (j === i ? { ...q, value: Number(e.target.value) } : q)) })}
              />
            </label>
          ))}
          <button className="btn small" onClick={() => pick(MODELS.find((m) => m.id === model.id) ?? MODELS[0])}>Reset model</button>

          <button className="palette-group" onClick={() => setEditing(!editing)} aria-expanded={editing}>
            <span className={`chev${editing ? ' open' : ''}`}>›</span> Edit the equations
          </button>
          {editing && <ModelEditor model={model} patch={patch} />}
        </div>
      </aside>

      <main className="sim-main">
        {run.error && <div className="notice" role="alert">{run.error}</div>}
        <div className="transport">
          <button className="btn primary" onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Play'}</button>
          <button className="btn" onClick={() => setTNow(0)}>Restart</button>
          <input
            className="scrub" type="range" min={0} max={tLast || 1} step={(tLast || 1) / 1000} value={t}
            onChange={(e) => { setPlaying(false); setTNow(Number(e.target.value)); }}
            aria-label="Time"
          />
          <span className="clock">t = {t.toFixed(2)} / {tLast.toFixed(2)} s</span>
          <div className="seg" role="group" aria-label="Playback speed">
            {SPEEDS.map((s) => <button key={s} className={s === speed ? 'on' : ''} onClick={() => setSpeed(s)}>{s}×</button>)}
          </div>
        </div>

        <div className="sim-grid">
          <section className="card">
            <h3>Picture</h3>
            <Scene model={model} run={run} frame={frame} height={290} />
          </section>
          <section className="card">
            <h3>
              Phase portrait
              <span className="card-tools">
                <select value={py} onChange={(e) => setPhase([px, e.target.value])} aria-label="Vertical variable">{names.map((n) => <option key={n}>{n}</option>)}</select>
                vs
                <select value={px} onChange={(e) => setPhase([e.target.value, py])} aria-label="Horizontal variable">{names.map((n) => <option key={n}>{n}</option>)}</select>
              </span>
            </h3>
            <Plot
              height={290} series={phaseSeries} xLabel={withUnit(px ?? '')} yLabel={withUnit(py ?? '')} hover={false}
              equal={!!px && !!py && px !== py && unitOf(px) === unitOf(py) && model.states.some((s) => s.name === px) && model.states.some((s) => s.name === py)}
              markers={px && py && run.t.length ? [{ x: run.series[px][frame], y: run.series[py][frame], slot: 2 }] : []}
            />
          </section>
          <section className="card wide">
            <h3>
              Over time
              <span className="card-tools chips">
                {names.map((n) => (
                  <button
                    key={n}
                    className={`chip${shown.includes(n) ? ' on' : ''}`}
                    aria-pressed={shown.includes(n)}
                    onClick={() => setShown(shown.includes(n) ? shown.filter((x) => x !== n) : [...shown, n])}
                  >
                    <span className="swatch" style={{ background: `var(--series-${(names.indexOf(n) % 8) + 1})` }} />{n}
                  </button>
                ))}
              </span>
            </h3>
            <Plot
              height={250} series={tsSeries} xLabel="time (s)" yLabel={visible.length === 1 ? withUnit(visible[0]) : undefined} cursorX={t}
              empty="Pick a variable above to chart it"
            />
            <div className="readouts">
              {names.map((n) => (
                <span key={n}><code>{n}</code> {run.series[n].length ? fmtNum(run.series[n][frame], 4) : '—'} {unitOf(n)}</span>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function ModelEditor({ model, patch }: { model: OdeModel; patch: (p: Partial<OdeModel>) => void }) {
  const setState = (i: number, p: Partial<OdeModel['states'][number]>) =>
    patch({ states: model.states.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const setParam = (i: number, p: Partial<OdeModel['params'][number]>) =>
    patch({ params: model.params.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const setDerived = (i: number, p: Partial<OdeModel['derived'][number]>) =>
    patch({ derived: model.derived.map((s, j) => (j === i ? { ...s, ...p } : s)) });

  return (
    <div className="model-editor">
      <p className="muted">Each state variable needs a starting value and a rate of change. Expressions may use <code>t</code>, parameters, states and functions such as <code>sin</code>, <code>sqrt</code>, <code>exp</code>.</p>
      <div className="panel-subtitle">State variables</div>
      {model.states.map((s, i) => (
        <div className="ed-block" key={i}>
          <div className="ed-row">
            <input className="code name" value={s.name} onChange={(e) => setState(i, { name: e.target.value })} aria-label="State name" />
            <span className="muted">starts at</span>
            <input className="code" value={s.init} onChange={(e) => setState(i, { init: e.target.value })} aria-label={`Initial value of ${s.name}`} />
            <button className="btn icon" title="Remove" onClick={() => patch({ states: model.states.filter((_, j) => j !== i) })}>×</button>
          </div>
          <div className="ed-row">
            <span className="muted">d{s.name}/dt =</span>
            <input className="code" value={s.deriv} onChange={(e) => setState(i, { deriv: e.target.value })} aria-label={`Rate of change of ${s.name}`} />
          </div>
        </div>
      ))}
      <button className="btn small" onClick={() => patch({ states: [...model.states, { name: `s${model.states.length + 1}`, init: '0', deriv: '0' }] })}>+ State variable</button>

      <div className="panel-subtitle">Parameters</div>
      {model.params.map((p, i) => (
        <div className="ed-row" key={i}>
          <input className="code name" value={p.name} onChange={(e) => setParam(i, { name: e.target.value, label: undefined })} aria-label="Parameter name" />
          <NumberField className="code" value={p.min} onChange={(min) => setParam(i, { min })} label={`Minimum of ${p.name}`} />
          <NumberField className="code" value={p.max} onChange={(max) => setParam(i, { max })} label={`Maximum of ${p.name}`} />
          <button className="btn icon" title="Remove" onClick={() => patch({ params: model.params.filter((_, j) => j !== i) })}>×</button>
        </div>
      ))}
      <button className="btn small" onClick={() => patch({ params: [...model.params, { name: `p${model.params.length + 1}`, value: 1, min: 0, max: 10 }] })}>+ Parameter</button>

      <div className="panel-subtitle">Derived quantities</div>
      {model.derived.map((d, i) => (
        <div className="ed-row" key={i}>
          <input className="code name" value={d.name} onChange={(e) => setDerived(i, { name: e.target.value })} aria-label="Derived name" />
          <span className="muted">=</span>
          <input className="code" value={d.expr} onChange={(e) => setDerived(i, { expr: e.target.value })} aria-label={`Expression for ${d.name}`} />
          <button className="btn icon" title="Remove" onClick={() => patch({ derived: model.derived.filter((_, j) => j !== i) })}>×</button>
        </div>
      ))}
      <button className="btn small" onClick={() => patch({ derived: [...model.derived, { name: `d${model.derived.length + 1}`, expr: '0' }] })}>+ Derived quantity</button>

      <div className="panel-subtitle">Run settings</div>
      <div className="ed-row">
        <span className="muted">duration</span>
        <NumberField className="code" value={model.tEnd} onChange={(tEnd) => patch({ tEnd })} label="Duration" />
        <span className="muted">step</span>
        <NumberField className="code" value={model.dt} onChange={(dt) => patch({ dt })} label="Time step" />
      </div>
      <div className="ed-row">
        <span className="muted">stop when</span>
        <input className="code" value={model.stopWhen ?? ''} placeholder="e.g. y < 0" onChange={(e) => patch({ stopWhen: e.target.value || undefined })} aria-label="Stop condition" />
      </div>
    </div>
  );
}
