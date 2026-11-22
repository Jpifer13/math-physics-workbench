import { useContext } from 'react';
import {
  getOp, inputPorts, OPS, type ConstantData, type FormulaData, type OpData, type OutputData, type QuantityData,
} from '../core/graph';
import { compatibleUnits, CONSTANTS, dimName, fmtNum, getConstant, quantityText } from '../core/units';
import { Tex } from '../components/Tex';
import { NumberField, ResultsContext, UnitSelect } from './PhysNode';
import { useFlow } from './store';

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Inspector() {
  const selectedId = useFlow((s) => s.selectedId);
  const node = useFlow((s) => s.nodes.find((n) => n.id === selectedId));
  const description = useFlow((s) => s.description);
  const updateCfg = useFlow((s) => s.updateCfg);
  const removeNode = useFlow((s) => s.removeNode);
  const setMeta = useFlow((s) => s.setMeta);
  const result = useContext(ResultsContext).get(selectedId ?? '');

  if (!node) {
    return (
      <aside className="inspector">
        <div className="panel-title">About this flow</div>
        <div className="inspector-scroll">
          <textarea
            className="notes"
            value={description}
            placeholder="Describe what this flow models…"
            onChange={(e) => setMeta({ description: e.target.value })}
            aria-label="Flow description"
          />
          <div className="panel-subtitle">Working with flows</div>
          <ul className="howto">
            <li><b>Compose</b> by dragging blocks onto the canvas and wiring an output port (right) to an input port (left).</li>
            <li><b>Dimensions are checked</b> on every wire; a mismatch is reported on the block that caused it.</li>
            <li>A <b>Result</b> block gives the composed equation, its value, and a sweep over any input in the panel below.</li>
            <li><b>Copy expression</b> puts the composed formula on the clipboard, ready to paste into a simulation's equations.</li>
          </ul>
          <p className="muted">Select a block to edit it here. <kbd>Backspace</kbd> deletes the selection; scroll to zoom, drag the background to pan.</p>
        </div>
      </aside>
    );
  }

  const { kind, cfg } = node.data;
  const set = (patch: Record<string, unknown>) => updateCfg(node.id, patch);

  return (
    <aside className="inspector">
      <div className="panel-title">
        {kind === 'quantity' ? 'Input' : kind === 'constant' ? 'Constant' : kind === 'op' ? 'Operation' : kind === 'formula' ? 'Formula' : 'Output'}
        <button className="btn danger small" onClick={() => removeNode(node.id)}>Delete</button>
      </div>
      <div className="inspector-scroll">
        {kind === 'quantity' && (() => {
          const d = cfg as QuantityData;
          const lo = d.min ?? Math.min(0, d.value * 2);
          const hi = d.max ?? (d.value === 0 ? 10 : Math.max(0, d.value * 2));
          return (
            <>
              <Field label="Name"><input value={d.label} onChange={(e) => set({ label: e.target.value })} /></Field>
              <Field label="Symbol" hint="Use _ for subscripts and Greek names: v_0, theta, lambda">
                <input value={d.symbol} onChange={(e) => set({ symbol: e.target.value })} />
              </Field>
              <div className="field-row">
                <Field label="Value"><NumberField value={d.value} onChange={(value) => set({ value })} /></Field>
                <Field label="Unit"><UnitSelect value={d.unit} onChange={(unit) => set({ unit })} /></Field>
              </div>
              <Field label={`Explore: ${fmtNum(d.value)} ${d.unit}`} hint="Drag to watch every downstream value update">
                <input
                  type="range" min={lo} max={hi} step={(hi - lo) / 400 || 1} value={d.value}
                  onChange={(e) => set({ value: Number(e.target.value), min: lo, max: hi })}
                />
              </Field>
              <div className="field-row">
                <Field label="Slider min"><NumberField value={lo} onChange={(min) => set({ min, max: hi })} label="Slider minimum" /></Field>
                <Field label="Slider max"><NumberField value={hi} onChange={(max) => set({ min: lo, max })} label="Slider maximum" /></Field>
              </div>
            </>
          );
        })()}

        {kind === 'constant' && (() => {
          const c = getConstant((cfg as ConstantData).constId);
          return (
            <>
              <Field label="Constant">
                <select value={(cfg as ConstantData).constId} onChange={(e) => set({ constId: e.target.value })}>
                  {CONSTANTS.map((k) => <option key={k.id} value={k.id}>{k.name} ({k.symbol})</option>)}
                </select>
              </Field>
              {c && (
                <div className="readout">
                  <Tex tex={`${c.latex} = `} /> {fmtNum(c.q.v, 9)} {c.unit}
                  {c.note && <div className="muted">{c.note}</div>}
                </div>
              )}
            </>
          );
        })()}

        {kind === 'op' && (
          <>
            <Field label="Operation" hint={getOp((cfg as OpData).op)?.hint}>
              <select value={(cfg as OpData).op} onChange={(e) => set({ op: e.target.value })}>
                {OPS.map((o) => <option key={o.id} value={o.id}>{o.label} ({o.glyph})</option>)}
              </select>
            </Field>
            <p className="muted">Inputs: {inputPorts({ kind, data: cfg }).join(', ')}</p>
          </>
        )}

        {kind === 'formula' && (
          <>
            <Field label="Name"><input value={(cfg as FormulaData).label} onChange={(e) => set({ label: e.target.value })} /></Field>
            <Field label="Expression" hint="Operators + − * / ^ and functions sqrt, sin, cos, tan, exp, ln, log10, abs, atan2, min, max. pi and e are built in.">
              <textarea className="code" rows={3} spellCheck={false} value={(cfg as FormulaData).expr} onChange={(e) => set({ expr: e.target.value })} />
            </Field>
            <p className="muted">Input ports: {inputPorts({ kind, data: cfg }).join(', ') || 'none yet'}</p>
          </>
        )}

        {kind === 'output' && (() => {
          const d = cfg as OutputData;
          const units = result?.q ? compatibleUnits(result.q.d) : [];
          return (
            <>
              <Field label="Name"><input value={d.label} onChange={(e) => set({ label: e.target.value })} /></Field>
              <Field label="Symbol"><input value={d.symbol} onChange={(e) => set({ symbol: e.target.value })} /></Field>
              <Field label="Display unit" hint={units.length ? undefined : 'Connect a value to choose from matching units'}>
                <select value={units.some((u) => u.symbol === d.unit) ? d.unit : ''} onChange={(e) => set({ unit: e.target.value })}>
                  <option value="">SI default</option>
                  {units.filter((u) => u.symbol).map((u) => <option key={u.symbol} value={u.symbol}>{u.symbol} — {u.name}</option>)}
                </select>
              </Field>
            </>
          );
        })()}

        <div className="panel-subtitle">Live value</div>
        {result?.error ? (
          <div className="readout error">{result.error}</div>
        ) : result?.q ? (
          <div className="readout">
            <b>{quantityText(result.q, kind === 'output' ? (cfg as OutputData).unit : kind === 'quantity' ? (cfg as QuantityData).unit : undefined)}</b>
            <div className="muted">SI: {quantityText(result.q)} · {dimName(result.q.d)}</div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
