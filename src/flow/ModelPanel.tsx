import { provenanceTitle } from '../core/brand';
import { useContext, useMemo, useState } from 'react';
import { hasCalculus, toLatex, toText } from '../core/expr';
import { toCsv } from '../core/measure';
import { exportCsv } from '../documents';
import { linspace, sweep, sweep2D, upstreamOf, type OutputData, type QuantityData } from '../core/graph';
import { symbolToLatex } from '../core/expr';
import { dimName, fmtNumLatex, formatQuantity, getUnit, quantityText, unitLatex, dimEq } from '../core/units';
import { Heatmap } from '../components/Heatmap';
import { Plot } from '../components/Plot';
import { Plot3D } from '../components/Plot3D';
import { Tex } from '../components/Tex';
import { NumberField, ResultsContext } from './PhysNode';
import { useNav } from '../nav';
import { APP_VERSION } from '../version';
import { useSim } from '../sim/store';
import { useFlow } from './store';
import { addFlowToSimulation } from './toSimulation';
import { toGraph } from './types';

const axisLabel = (name: string, unit: string) => (unit ? `${name} (${unit})` : name);

export function ModelPanel() {
  const nodes = useFlow((s) => s.nodes);
  const edges = useFlow((s) => s.edges);
  const model = useFlow((s) => s.model);
  const setModel = useFlow((s) => s.setModel);
  const results = useContext(ResultsContext);
  const [status, setStatus] = useState('');
  const [sent, setSent] = useState('');

  // The engine only cares about wiring and settings, not where blocks sit.
  const graphKey = JSON.stringify([nodes.map((n) => [n.id, n.data]), edges.map((e) => [e.source, e.target, e.targetHandle])]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const graph = useMemo(() => toGraph(nodes, edges), [graphKey]);

  const outputs = nodes.filter((n) => n.data.kind === 'output');
  const output = outputs.find((n) => n.id === model.outputId) ?? outputs[0];
  const outCfg = output?.data.cfg as OutputData | undefined;
  const result = output ? results.get(output.id) : undefined;

  const inputs = useMemo(() => {
    if (!output) return [];
    const up = upstreamOf(graph, output.id);
    return nodes.filter((n) => n.data.kind === 'quantity' && up.has(n.id));
  }, [graph, nodes, output]);
  const xNode = inputs.find((n) => n.id === model.xId) ?? inputs[0];
  const yNode = inputs.find((n) => n.id === model.yId && n.id !== xNode?.id) ?? inputs.find((n) => n.id !== xNode?.id);
  const xCfg = xNode?.data.cfg as QuantityData | undefined;
  const yCfg = yNode?.data.cfg as QuantityData | undefined;

  // Chart the output in its chosen display unit when that unit fits.
  const display = result?.q ? formatQuantity(result.q, outCfg?.unit) : undefined;
  const outUnit = display?.unit ?? '';
  const unitDef = getUnit(outUnit);
  const factor = result?.q && unitDef && dimEq(unitDef.d, result.q.d) ? unitDef.f : 1;

  const mode = model.mode !== 'curve' && yNode ? model.mode : 'curve';
  const valid = model.max > model.min;

  const curve = useMemo(() => {
    if (!output || !xNode || !valid || mode !== 'curve') return null;
    const s = sweep(graph, output.id, xNode.id, linspace(model.min, model.max, 240, model.logX));
    return { x: s.x, y: s.y.map((v) => v / factor) };
  }, [graph, output, xNode, model.min, model.max, model.logX, factor, valid, mode]);

  const map = useMemo(() => {
    if (!output || !xNode || !yNode || !valid || mode === 'curve' || !(model.yMax > model.yMin)) return null;
    const xs = linspace(model.min, model.max, 70);
    const ys = linspace(model.yMin, model.yMax, 50);
    return { xs, ys, z: sweep2D(graph, output.id, xNode.id, xs, yNode.id, ys).map((row) => row.map((v) => v / factor)) };
  }, [graph, output, xNode, yNode, model.min, model.max, model.yMin, model.yMax, factor, valid, mode]);

  if (!output) {
    return (
      <section className="model-panel empty">
        <p className="muted">Add a <b>Result</b> block (under Outputs) and wire a value into it to see its equation and chart here.</p>
      </section>
    );
  }

  const symTex = symbolToLatex(outCfg?.symbol || outCfg?.label || 'y');
  const outName = outCfg?.label || 'Output';

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(`${what} copied`);
    } catch {
      setStatus('Copy failed');
    }
  };
  const exportData = async () => {
    const xName = xCfg ? axisLabel(xCfg.label, xCfg.unit) : 'x';
    const zName = axisLabel(outName, outUnit);
    let csv = '';
    // Record what produced the numbers: the formula and every input's value.
    const header = [
      provenanceTitle(APP_VERSION, new Date().toISOString()),
      `flow: ${useFlow.getState().name}`,
      ...(result?.ex ? [`formula: ${outCfg?.symbol || outName} = ${toText(result.ex)}`] : []),
      `inputs: ${inputs.map((i) => { const c = i.data.cfg as QuantityData; return `${c.symbol || c.label} = ${c.value}${c.unit ? ` ${c.unit}` : ''}`; }).join('; ')}`,
    ];
    if (curve) csv = toCsv([{ name: xName, values: curve.x }, { name: zName, values: curve.y }], header);
    else if (map && yCfg) {
      // Long format: one row per grid point.
      const cols = [[], [], []] as number[][];
      map.ys.forEach((yv, j) => map.xs.forEach((xv, i) => { cols[0].push(xv); cols[1].push(yv); cols[2].push(map.z[j][i]); }));
      csv = toCsv([{ name: xName, values: cols[0] }, { name: axisLabel(yCfg.label, yCfg.unit), values: cols[1] }, { name: zName, values: cols[2] }], header);
    }
    if (!csv) return;
    try {
      setStatus(await exportCsv(csv, `${outName} sweep`));
    } catch (err) {
      setStatus(`Export failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  return (
    <section className="model-panel">
      <div className="model-eq">
        <div className="model-head">
          <span className="panel-title plain">Equation</span>
          {outputs.length > 1 && (
            <select value={output.id} onChange={(e) => setModel({ outputId: e.target.value })} aria-label="Output to model">
              {outputs.map((o) => <option key={o.id} value={o.id}>{(o.data.cfg as OutputData).label}</option>)}
            </select>
          )}
        </div>
        {result?.ex && result.q && display ? (
          <div className="eq-steps">
            <div className="eq-main"><Tex block tex={`${symTex} = ${toLatex(result.ex)}`} /></div>
            <div className="eq-sub"><Tex block tex={`= ${toLatex(result.ex, { substitute: true })}`} /></div>
            <div className="eq-result">
              <Tex block tex={`= ${fmtNumLatex(display.value, 5)}${unitLatex(display.unit)}`} />
            </div>
            <div className="eq-actions">
              <button className="btn small" title="Plain-text expression, ready to paste into a simulation equation or a Formula block" onClick={() => void copy(toText(result.ex!), 'Expression')}>Copy expression</button>
              <button className="btn small" onClick={() => void copy(`${symTex} = ${toLatex(result.ex!)}`, 'LaTeX')}>Copy LaTeX</button>
              <button
                className="btn small"
                // A simulation's equations are worked out at every step and have no integrals, sums or limits in them.
                disabled={hasCalculus(result.ex!)}
                title={hasCalculus(result.ex!)
                  ? 'This formula contains an integral, sum, product, derivative or limit, which a simulation equation cannot hold'
                  : 'Add this formula to the open simulation as an observable; its inputs become parameters in SI units'}
                onClick={() => {
                  const tr = addFlowToSimulation(result.ex!, outCfg?.symbol || outCfg?.label || 'result', formatQuantity(result.q!).unit);
                  setSent(`${tr.replaced ? 'Updated' : 'Added'} observable “${tr.observable}” in “${useSim.getState().model.name}”${tr.added.length ? `, with new parameter${tr.added.length > 1 ? 's' : ''} ${tr.added.join(', ')}` : ''}${tr.reused.length ? `; uses its existing ${tr.reused.join(', ')}` : ''}.`);
                }}
              >Add to simulation</button>
            </div>
            {sent && <div className="sent-note">{sent} <button className="link" onClick={() => useNav.getState().setTab('sim')}>Open simulation</button></div>}
            <div className="muted center">
              {status ? `${status} · ` : ''}Quantity: {dimName(result.q.d)}{display.unit !== formatQuantity(result.q).unit ? ` · ${quantityText(result.q)} in SI` : ''}
            </div>
          </div>
        ) : (
          <div className="readout error">{result?.error ?? 'Wire a value into the result block.'}</div>
        )}
      </div>

      <div className="model-chart">
        <div className="model-controls">
          <span className="panel-title plain">Model</span>
          {xNode && xCfg ? (
            <>
              <label>
                vary
                <select value={xNode.id} onChange={(e) => {
                  const n = inputs.find((i) => i.id === e.target.value);
                  const v = (n?.data.cfg as QuantityData).value;
                  setModel({ xId: e.target.value, min: Math.min(0, v * 2), max: v === 0 ? 10 : Math.max(0, v * 2), logX: false });
                }}>
                  {inputs.map((i) => <option key={i.id} value={i.id}>{(i.data.cfg as QuantityData).label}</option>)}
                </select>
              </label>
              <label>from <NumberField value={model.min} onChange={(min) => setModel({ min })} label="Sweep from" /></label>
              <label>to <NumberField value={model.max} onChange={(max) => setModel({ max })} label="Sweep to" /> <span className="muted">{xCfg.unit}</span></label>
              <div className="seg" role="group" aria-label="Chart type">
                <button className={mode === 'curve' ? 'on' : ''} onClick={() => setModel({ mode: 'curve' })}>Curve</button>
                <button className={mode === 'map' ? 'on' : ''} disabled={!yNode} title={yNode ? 'Vary two inputs at once' : 'Needs a second input'} onClick={() => setModel({ mode: 'map', yId: yNode?.id ?? '' })}>Map</button>
                <button className={mode === 'surface' ? 'on' : ''} disabled={!yNode} title={yNode ? 'Vary two inputs and see the result as a 3-D surface' : 'Needs a second input'} onClick={() => setModel({ mode: 'surface', yId: yNode?.id ?? '' })}>3D</button>
              </div>
              {mode === 'curve' ? (
                <span className="checks">
                  <label className="check"><input type="checkbox" checked={model.logX} onChange={(e) => setModel({ logX: e.target.checked })} /> log x</label>
                  <label className="check"><input type="checkbox" checked={model.logY} onChange={(e) => setModel({ logY: e.target.checked })} /> log y</label>
                </span>
              ) : yNode && yCfg && (
                <>
                  <label>
                    and
                    <select value={yNode.id} onChange={(e) => {
                      const v = (inputs.find((i) => i.id === e.target.value)?.data.cfg as QuantityData).value;
                      setModel({ yId: e.target.value, yMin: Math.min(0, v * 2), yMax: v === 0 ? 10 : Math.max(0, v * 2) });
                    }}>
                      {inputs.filter((i) => i.id !== xNode.id).map((i) => <option key={i.id} value={i.id}>{(i.data.cfg as QuantityData).label}</option>)}
                    </select>
                  </label>
                  <label>from <NumberField value={model.yMin} onChange={(yMin) => setModel({ yMin })} label="Second sweep from" /></label>
                  <label>to <NumberField value={model.yMax} onChange={(yMax) => setModel({ yMax })} label="Second sweep to" /> <span className="muted">{yCfg.unit}</span></label>
                </>
              )}
            </>
          ) : (
            <span className="muted">Connect at least one input block to chart how {outName.toLowerCase()} responds.</span>
          )}
          {(curve || map) && <button className="btn small" onClick={() => void exportData()}>Export (CSV)</button>}
        </div>
        {xNode && xCfg && !valid && <div className="readout error">The sweep range needs “to” greater than “from”.</div>}
        {curve && xCfg && (
          <Plot
            height={222}
            series={[{ name: outName, x: curve.x, y: curve.y }]}
            xLabel={axisLabel(xCfg.label, xCfg.unit)}
            yLabel={axisLabel(outName, outUnit)}
            logX={model.logX}
            logY={model.logY}
            markers={display ? [{ x: xCfg.value, y: display.value, slot: 2, label: 'current value' }] : []}
          />
        )}
        {map && mode === 'map' && xCfg && yCfg && (
          <Heatmap
            height={222}
            xs={map.xs} ys={map.ys} z={map.z}
            xLabel={axisLabel(xCfg.label, xCfg.unit)}
            yLabel={axisLabel(yCfg.label, yCfg.unit)}
            zLabel={axisLabel(outName, outUnit)}
            marker={{ x: xCfg.value, y: yCfg.value }}
          />
        )}
        {map && mode === 'surface' && xCfg && yCfg && (
          <Plot3D
            height={236}
            surface={map}
            labels={[axisLabel(xCfg.label, xCfg.unit), axisLabel(yCfg.label, yCfg.unit), axisLabel(outName, outUnit)]}
            markers={display ? [{ p: [xCfg.value, yCfg.value, display.value], slot: 2 }] : []}
          />
        )}
      </div>
    </section>
  );
}
