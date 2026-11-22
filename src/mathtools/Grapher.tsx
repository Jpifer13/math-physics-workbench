import { compile, derivative as symDerivative, parse, simplify } from 'mathjs';
import { useMemo, useState } from 'react';
import { linspace } from '../core/graph';
import { derivative, findExtrema, findRoots, integrate } from '../core/numeric';
import { fmtNum } from '../core/units';
import { NumberField } from '../components/NumberField';
import { Plot, seriesColor, type Series } from '../components/Plot';
import { Tex } from '../components/Tex';

interface Row { expr: string; on: boolean }

const PRESETS: { name: string; rows: string[]; range: [number, number] }[] = [
  { name: 'Sine & cosine', rows: ['sin(x)', 'cos(x)'], range: [-6.283, 6.283] },
  { name: 'Damped wave', rows: ['exp(-x/4) * cos(3*x)', 'exp(-x/4)', '-exp(-x/4)'], range: [0, 12] },
  { name: 'Gaussian', rows: ['exp(-x^2 / 2) / sqrt(2*pi)'], range: [-4, 4] },
  { name: 'Lennard-Jones potential', rows: ['4 * ((1/x)^12 - (1/x)^6)'], range: [0.9, 3] },
  { name: 'Polynomial', rows: ['x^3 - 3*x', '3*x^2 - 3'], range: [-2.5, 2.5] },
  { name: 'Beats', rows: ['sin(10*x) + sin(11*x)'], range: [0, 13] },
];

function compileRow(expr: string): { f?: (x: number) => number; error?: string } {
  if (!expr.trim()) return { error: 'empty' };
  try {
    const code = compile(expr);
    const f = (x: number) => {
      const v = code.evaluate({ x });
      return typeof v === 'number' ? v : NaN;
    };
    f(1);
    return { f };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function Grapher() {
  const [rows, setRows] = useState<Row[]>([{ expr: 'sin(x)', on: true }, { expr: 'x^2 / 10', on: true }]);
  const [range, setRange] = useState<[number, number]>([-6.283, 6.283]);
  const [sel, setSel] = useState(0);
  const [showDeriv, setShowDeriv] = useState(false);
  const [a, setA] = useState(0);
  const [b, setB] = useState(3.1416);
  const [x0, setX0] = useState(1);

  const compiled = useMemo(() => rows.map((r) => compileRow(r.expr)), [rows]);
  const valid = range[1] > range[0];
  const xs = useMemo(() => (valid ? linspace(range[0], range[1], 800) : []), [range, valid]);
  const active = Math.min(sel, rows.length - 1);
  const f = compiled[active]?.f;

  const series = useMemo(() => {
    const out: Series[] = [];
    rows.forEach((r, i) => {
      const fn = compiled[i].f;
      if (fn && r.on) out.push({ name: r.expr, x: xs, y: xs.map(fn), slot: i + 1 });
    });
    if (showDeriv && f) out.push({ name: `d/dx of ${rows[active].expr}`, x: xs, y: xs.map((x) => derivative(f, x)), slot: active + 1, dashed: true });
    return out;
  }, [rows, compiled, xs, showDeriv, f, active]);

  const analysis = useMemo(() => {
    if (!f || !valid) return null;
    let dTex: string | null = null;
    try {
      dTex = simplify(symDerivative(parse(rows[active].expr), 'x')).toTex();
    } catch {
      dTex = null;
    }
    let fTex = '';
    try { fTex = parse(rows[active].expr).toTex(); } catch { /* shown as text instead */ }
    return {
      fTex, dTex,
      roots: findRoots(f, range[0], range[1]).slice(0, 12),
      extrema: findExtrema(f, range[0], range[1]).slice(0, 12),
      integral: integrate(f, a, b),
      at: f(x0),
      slope: derivative(f, x0),
    };
  }, [f, rows, active, range, a, b, x0, valid]);

  const setRow = (i: number, p: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));

  return (
    <div className="tool-layout">
      <aside className="tool-side">
        <div className="panel-subtitle first">Functions of x</div>
        {rows.map((r, i) => (
          <div className={`fn-row${i === active ? ' sel' : ''}`} key={i}>
            <input type="checkbox" checked={r.on} onChange={(e) => setRow(i, { on: e.target.checked })} aria-label={`Show ${r.expr}`} />
            <span className="swatch" style={{ background: seriesColor(i + 1) }} />
            <input
              className={`code${compiled[i].error && r.expr ? ' invalid' : ''}`} value={r.expr} spellCheck={false}
              onChange={(e) => setRow(i, { expr: e.target.value })} onFocus={() => setSel(i)} aria-label={`Function ${i + 1}`}
              title={compiled[i].error && r.expr ? compiled[i].error : undefined}
            />
            <button className="btn icon" title="Remove" disabled={rows.length === 1} onClick={() => { setRows(rows.filter((_, j) => j !== i)); setSel(0); }}>×</button>
          </div>
        ))}
        <button className="btn small" disabled={rows.length >= 8} onClick={() => { setRows([...rows, { expr: '', on: true }]); setSel(rows.length); }}>+ Function</button>

        <div className="panel-subtitle">Window</div>
        <div className="ed-row">
          <span className="muted">x from</span><NumberField className="code" value={range[0]} onChange={(v) => setRange([v, range[1]])} label="x minimum" />
          <span className="muted">to</span><NumberField className="code" value={range[1]} onChange={(v) => setRange([range[0], v])} label="x maximum" />
        </div>
        {!valid && <div className="readout error">“to” must be greater than “from”.</div>}

        <div className="panel-subtitle">Examples</div>
        <div className="chips wrap">
          {PRESETS.map((p) => (
            <button key={p.name} className="chip" onClick={() => { setRows(p.rows.map((expr) => ({ expr, on: true }))); setRange(p.range); setSel(0); }}>{p.name}</button>
          ))}
        </div>
        <p className="muted">Functions: sin cos tan asin acos atan sinh cosh tanh exp log (natural) log10 sqrt abs. Constants: pi, e.</p>
      </aside>

      <main className="tool-main">
        <section className="card">
          <Plot height={380} series={series} xLabel="x" empty="Type a function of x on the left" />
        </section>
        <section className="card">
          <h3>
            <span>Calculus on <code>{rows[active]?.expr || '…'}</code></span>
            <span className="card-tools">
              <label className="check"><input type="checkbox" checked={showDeriv} onChange={(e) => setShowDeriv(e.target.checked)} /> plot derivative</label>
            </span>
          </h3>
          {analysis ? (
            <div className="analysis">
              <div>
                <div className="field-label">Function and derivative</div>
                {analysis.fTex && <Tex block tex={`f(x) = ${analysis.fTex}`} />}
                {analysis.dTex ? <Tex block tex={`f'(x) = ${analysis.dTex}`} /> : <p className="muted">No symbolic derivative available; the plot uses a numerical one.</p>}
              </div>
              <div>
                <div className="field-label">At a point</div>
                <div className="ed-row"><span className="muted">x =</span><NumberField className="code" value={x0} onChange={setX0} label="Evaluation point" /></div>
                <p>f(x) = <b>{fmtNum(analysis.at, 6)}</b><br />slope f′(x) = <b>{fmtNum(analysis.slope, 6)}</b></p>
                <div className="field-label">Definite integral</div>
                <div className="ed-row">
                  <span className="muted">from</span><NumberField className="code" value={a} onChange={setA} label="Integral from" />
                  <span className="muted">to</span><NumberField className="code" value={b} onChange={setB} label="Integral to" />
                </div>
                <p>area = <b>{fmtNum(analysis.integral, 7)}</b></p>
              </div>
              <div>
                <div className="field-label">Zeros in window</div>
                <p>{analysis.roots.length ? analysis.roots.map((r) => fmtNum(r, 5)).join(',  ') : 'none'}</p>
                <div className="field-label">Turning points in window</div>
                {analysis.extrema.length ? (
                  <ul className="plain">{analysis.extrema.map((e, i) => <li key={i}>{e.kind} at x = {fmtNum(e.x, 5)}, f = {fmtNum(e.y, 5)}</li>)}</ul>
                ) : <p>none</p>}
              </div>
            </div>
          ) : (
            <p className="muted">Select a valid function to analyse it.</p>
          )}
        </section>
      </main>
    </div>
  );
}
