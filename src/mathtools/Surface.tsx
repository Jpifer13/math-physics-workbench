import { compile } from 'mathjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { linspace } from '../core/graph';
import { fmtNum } from '../core/units';
import { NumberField } from '../components/NumberField';
import { Plot3D } from '../components/Plot3D';

const PRESETS = [
  { name: 'Two-source interference', expr: 'cos(3*sqrt((x-1.5)^2 + y^2) - 3*t) + cos(3*sqrt((x+1.5)^2 + y^2) - 3*t)', half: 5, note: 'Ripples from two sources. Where crests meet crests the surface doubles; where crest meets trough it stays flat — the still lines are nodal lines.' },
  { name: 'Travelling wave', expr: 'sin(2*x - 3*t)', half: 4, note: 'A wave of the form sin(kx − ωt) slides along +x at speed ω/k = 1.5.' },
  { name: 'Standing wave', expr: 'sin(2*x) * cos(3*t)', half: 4, note: 'Two equal waves travelling in opposite directions add up to a pattern that oscillates in place.' },
  { name: 'Drumhead mode', expr: 'sin(x) * sin(2*y) * cos(2*t)', half: 3.1416, note: 'A vibration mode of a square membrane clamped at its edges.' },
  { name: 'Gravity well', expr: '-1 / sqrt(x^2 + y^2 + 0.08)', half: 3, note: 'Gravitational potential around a mass. A ball rolling on this surface mimics an orbit.' },
  { name: 'Dipole potential', expr: '1/sqrt((x-1)^2 + y^2 + 0.1) - 1/sqrt((x+1)^2 + y^2 + 0.1)', half: 3.5, note: 'Electric potential of a + and − charge: a hill beside a pit. Field lines run straight downhill.' },
  { name: 'Saddle', expr: 'x^2 - y^2', half: 2, note: 'Curves up one way and down the other — the shape of an unstable equilibrium.' },
  { name: 'Gaussian packet', expr: 'exp(-((x - 2*sin(t))^2 + y^2)) * cos(4*x)', half: 4, note: 'A localised wave packet sloshing back and forth.' },
];

const N = 64;

export function Surface() {
  const [expr, setExpr] = useState(PRESETS[0].expr);
  const [note, setNote] = useState(PRESETS[0].note);
  const [half, setHalf] = useState(PRESETS[0].half);
  const [playing, setPlaying] = useState(true);
  const [t, setT] = useState(0);

  const compiled = useMemo(() => {
    try {
      const code = compile(expr);
      const v = code.evaluate({ x: 0.3, y: 0.7, t: 0 });
      if (typeof v !== 'number') throw new Error('The expression must produce a number');
      return { code, usesT: /\bt\b/.test(expr) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [expr]);
  const usesT = !!compiled.usesT;

  useEffect(() => {
    if (!playing || !usesT) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      // ~30 fps is plenty and halves the work of re-meshing the surface.
      if (now - last >= 33) {
        setT((v) => v + Math.min(0.1, (now - last) / 1000));
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, usesT]);

  const surface = useMemo(() => {
    if (!compiled.code) return null;
    const xs = linspace(-half, half, N);
    const scope = { x: 0, y: 0, t };
    const z = xs.map((y) => xs.map((x) => {
      scope.x = x; scope.y = y;
      const v = compiled.code.evaluate(scope);
      return typeof v === 'number' ? v : NaN;
    }));
    return { xs, ys: xs, z };
  }, [compiled, half, t]);

  // Keep the vertical range steady while animating: it only ever grows for a given expression.
  const range = useRef<{ key: string; lo: number; hi: number }>({ key: '', lo: 0, hi: 1 });
  const zDomain = useMemo((): [number, number] | undefined => {
    if (!surface) return undefined;
    let lo = Infinity, hi = -Infinity;
    for (const row of surface.z) for (const v of row) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!(lo < hi)) return undefined;
    const key = `${expr}|${half}`;
    const r = range.current;
    if (r.key !== key) range.current = { key, lo, hi };
    else if (lo < r.lo - 1e-9 || hi > r.hi + 1e-9) range.current = { key, lo: Math.min(lo, r.lo), hi: Math.max(hi, r.hi) };
    return [range.current.lo, range.current.hi];
  }, [surface, expr, half]);

  return (
    <div className="tool-layout">
      <aside className="tool-side">
        <div className="panel-subtitle first">Surface z = f(x, y, t)</div>
        <label className="field"><span className="field-label">Height z</span>
          <textarea className="code" rows={3} spellCheck={false} value={expr} onChange={(e) => setExpr(e.target.value)} />
          <span className="field-hint">Use <code>x</code> and <code>y</code> for position and, optionally, <code>t</code> for time to animate it.</span>
        </label>
        {compiled.error && <div className="readout error">{compiled.error}</div>}
        <div className="ed-row"><span className="muted">window ±</span><NumberField className="code" value={half} onChange={(v) => v > 0 && setHalf(v)} label="Window half-width" /></div>
        <div className="panel-subtitle">Examples</div>
        <div className="chips wrap">
          {PRESETS.map((p) => (
            <button key={p.name} className="chip" onClick={() => { setExpr(p.expr); setNote(p.note); setHalf(p.half); setT(0); setPlaying(true); }}>{p.name}</button>
          ))}
        </div>
        {note && <div className="explore">{note}</div>}
      </aside>
      <main className="tool-main">
        <section className="card">
          <h3>
            Surface
            <span className="card-tools">
              {usesT ? (
                <>
                  <span className="clock">t = {t.toFixed(2)}</span>
                  <button className="btn small" onClick={() => setT(0)}>Restart</button>
                  <button className="btn small primary" onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Play'}</button>
                </>
              ) : <span className="muted">Add <code>t</code> to the expression to animate it</span>}
            </span>
          </h3>
          {surface ? <Plot3D height={520} surface={surface} zDomain={zDomain} labels={['x', 'y', 'z']} /> : <p className="muted pad">Enter a valid expression to draw the surface.</p>}
          {zDomain && (
            <div className="field-legend">
              <span>low {fmtNum(zDomain[0], 3)}</span>
              <span className="ramp" style={{ background: 'linear-gradient(90deg, rgb(222,235,250), rgb(9,48,105))' }} />
              <span>high {fmtNum(zDomain[1], 3)}</span>
              <span className="muted">· colour and height both show z</span>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
