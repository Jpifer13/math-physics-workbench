import { useTheme } from '../theme';
import { compile } from 'mathjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtNum } from '../core/units';
import { NumberField } from '../components/NumberField';
import { useWidth } from '../components/useSize';

const PRESETS = [
  { name: 'Point charge', fx: 'x / (x^2 + y^2)^1.5', fy: 'y / (x^2 + y^2)^1.5', note: 'Electric field of a positive charge at the origin: straight out, fading as 1/r².' },
  { name: 'Dipole', fx: '(x-1) / ((x-1)^2 + y^2)^1.5 - (x+1) / ((x+1)^2 + y^2)^1.5', fy: 'y / ((x-1)^2 + y^2)^1.5 - y / ((x+1)^2 + y^2)^1.5', note: 'A positive charge at x = 1 and a negative one at x = −1. Field lines run from + to −.' },
  { name: 'Vortex', fx: '-y', fy: 'x', note: 'Rigid rotation, like water in a spinning bucket. It has curl but no divergence.' },
  { name: 'Saddle', fx: 'x', fy: '-y', note: 'Flow in along one axis and out along the other — an unstable equilibrium.' },
  { name: 'Damped oscillator flow', fx: 'y', fy: '-x - 0.3*y', note: 'Phase space of a damped spring (x = position, y = velocity). Every trajectory spirals in.' },
  { name: 'Pendulum flow', fx: 'y', fy: '-sin(x)', note: 'Phase space of a pendulum (x = angle, y = angular velocity): closed loops are swings, wavy lines are full rotations.' },
];

const LO = [150, 187, 232];
const HI = [9, 48, 105];
const DARK_LO = [38, 72, 118];
const DARK_HI = [190, 220, 255];
const GRID = 23;

export function VectorField() {
  const [fx, setFx] = useState(PRESETS[1].fx);
  const [fy, setFy] = useState(PRESETS[1].fy);
  const [note, setNote] = useState(PRESETS[1].note);
  const [half, setHalf] = useState(4);
  const [seeds, setSeeds] = useState<[number, number][]>([]);
  const [tip, setTip] = useState<{ left: number; top: number; lines: string[] } | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = Math.min(width, 620);

  const field = useMemo(() => {
    try {
      const cx = compile(fx);
      const cy = compile(fy);
      const F = (x: number, y: number): [number, number] => {
        const s = { x, y };
        return [Number(cx.evaluate(s)), Number(cy.evaluate(s))];
      };
      F(0.3, 0.7);
      return { F };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [fx, fy]);

  const theme = useTheme((t) => t.theme);
  // Strong is dark on a light page and bright on a dark one.
  const [weak, strong] = theme === 'dark' ? [DARK_LO, DARK_HI] : [LO, HI];
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const F = field.F;
    if (!F || !(half > 0)) return;
    const X = (x: number) => ((x + half) / (2 * half)) * size;
    const Y = (y: number) => (1 - (y + half) / (2 * half)) * size;
    const style = getComputedStyle(document.documentElement);

    ctx.strokeStyle = style.getPropertyValue('--grid');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Y(0)); ctx.lineTo(size, Y(0)); ctx.moveTo(X(0), 0); ctx.lineTo(X(0), size);
    ctx.stroke();

    // Sample the field, then colour by rank so a 1/r² spike doesn't wash everything out.
    const pts: { x: number; y: number; u: number; v: number; m: number }[] = [];
    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
      const x = -half + ((i + 0.5) / GRID) * 2 * half;
      const y = -half + ((j + 0.5) / GRID) * 2 * half;
      const [u, v] = F(x, y);
      const m = Math.hypot(u, v);
      if (Number.isFinite(m) && m > 0) pts.push({ x, y, u, v, m });
    }
    const sorted = pts.map((p) => p.m).sort((p, q) => p - q);
    const rank = (m: number) => sorted.findIndex((s) => s >= m) / Math.max(1, sorted.length - 1);
    const cell = size / GRID;
    for (const p of pts) {
      const r = rank(p.m);
      const col = weak.map((c0, k) => Math.round(c0 + (strong[k] - c0) * r));
      const len = cell * (0.35 + 0.5 * r);
      const ux = p.u / p.m, uy = -p.v / p.m;
      const x0 = X(p.x) - (ux * len) / 2, y0 = Y(p.y) - (uy * len) / 2;
      const x1 = x0 + ux * len, y1 = y0 + uy * len;
      ctx.strokeStyle = ctx.fillStyle = `rgb(${col.join(',')})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      const hs = 4.5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - ux * hs - uy * hs * 0.6, y1 - uy * hs + ux * hs * 0.6);
      ctx.lineTo(x1 - ux * hs + uy * hs * 0.6, y1 - uy * hs - ux * hs * 0.6);
      ctx.fill();
    }

    // Field lines through each clicked seed, traced both ways with midpoint steps.
    ctx.strokeStyle = style.getPropertyValue('--series-2');
    ctx.lineWidth = 2;
    const h = half / 150;
    for (const [sx, sy] of seeds) {
      for (const dir of [1, -1]) {
        let x = sx, y = sy;
        ctx.beginPath();
        ctx.moveTo(X(x), Y(y));
        for (let n = 0; n < 2500; n++) {
          const [u1, v1] = F(x, y);
          const m1 = Math.hypot(u1, v1);
          if (!Number.isFinite(m1) || m1 < 1e-9) break;
          const [u2, v2] = F(x + (dir * h * u1) / m1 / 2, y + (dir * h * v1) / m1 / 2);
          const m2 = Math.hypot(u2, v2);
          if (!Number.isFinite(m2) || m2 < 1e-9) break;
          x += (dir * h * u2) / m2;
          y += (dir * h * v2) / m2;
          if (Math.abs(x) > half * 1.1 || Math.abs(y) > half * 1.1) break;
          ctx.lineTo(X(x), Y(y));
        }
        ctx.stroke();
      }
      ctx.fillStyle = style.getPropertyValue('--series-2');
      ctx.beginPath(); ctx.arc(X(sx), Y(sy), 4, 0, 2 * Math.PI); ctx.fill();
    }
  }, [field, half, seeds, size, theme]);

  const toData = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: -half + ((e.clientX - r.left) / r.width) * 2 * half,
      y: half - ((e.clientY - r.top) / r.height) * 2 * half,
      left: e.clientX - r.left, top: e.clientY - r.top,
    };
  };

  return (
    <div className="tool-layout">
      <aside className="tool-side">
        <div className="panel-subtitle first">Field F(x, y)</div>
        <label className="field"><span className="field-label">x-component</span>
          <textarea className="code" rows={2} spellCheck={false} value={fx} onChange={(e) => { setFx(e.target.value); setSeeds([]); }} />
        </label>
        <label className="field"><span className="field-label">y-component</span>
          <textarea className="code" rows={2} spellCheck={false} value={fy} onChange={(e) => { setFy(e.target.value); setSeeds([]); }} />
        </label>
        {field.error && <div className="readout error">{field.error}</div>}
        <div className="ed-row"><span className="muted">window ±</span><NumberField className="code" value={half} onChange={(v) => v > 0 && setHalf(v)} label="Window half-width" /></div>
        <div className="panel-subtitle">Examples</div>
        <div className="chips wrap">
          {PRESETS.map((p) => (
            <button key={p.name} className="chip" onClick={() => { setFx(p.fx); setFy(p.fy); setNote(p.note); setSeeds([]); }}>{p.name}</button>
          ))}
        </div>
        {note && <div className="explore">{note}</div>}
        <button className="btn small" disabled={!seeds.length} onClick={() => setSeeds([])}>Clear field lines</button>
      </aside>
      <main className="tool-main">
        <section className="card">
          <h3>Direction and strength <span className="card-tools muted">Click anywhere to trace a field line</span></h3>
          <div ref={ref} className="field-wrap">
            <div className="field-canvas" style={{ width: size, height: size }}>
              <canvas
                ref={canvas}
                style={{ width: size, height: size }}
                aria-label="Vector field plot"
                onClick={(e) => { const p = toData(e); setSeeds([...seeds, [p.x, p.y]]); }}
                onMouseMove={(e) => {
                  const p = toData(e);
                  const v = field.F?.(p.x, p.y);
                  setTip({
                    left: p.left + 14, top: p.top + 8,
                    lines: [`(${fmtNum(p.x, 3)}, ${fmtNum(p.y, 3)})`, v ? `F = (${fmtNum(v[0], 3)}, ${fmtNum(v[1], 3)})` : '', v ? `|F| = ${fmtNum(Math.hypot(v[0], v[1]), 3)}` : ''],
                  });
                }}
                onMouseLeave={() => setTip(null)}
              />
              {tip && <div className="plot-tip" style={{ left: Math.min(tip.left, size - 150), top: tip.top }}>{tip.lines.map((l, i) => <div key={i}>{l}</div>)}</div>}
            </div>
            <div className="field-legend">
              <span>weaker</span>
              <span className="ramp" style={{ background: `linear-gradient(90deg, rgb(${weak.join(',')}), rgb(${strong.join(',')}))` }} />
              <span>stronger</span>
              <span className="muted">· arrow colour and length rank the field strength within the window (±{fmtNum(half, 3)})</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
