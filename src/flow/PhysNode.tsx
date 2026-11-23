import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { createContext, memo, useContext, useEffect } from 'react';
import {
  getOp, inputPorts, type ConstantData, type FormulaData, type GroupData, type NodeResult, type OpData, type OutputData, type QuantityData,
} from '../core/graph';
import { symbolToLatex } from '../core/expr';
import { getConstant, knownDimName, quantityText, UNITS, unitGroups } from '../core/units';
import { NumberField } from '../components/NumberField';
import { Tex } from '../components/Tex';
import { toneOf } from './catalog';
import { useFlow } from './store';
import type { FNode } from './types';

/** Latest evaluation results, provided by the editor. */
export const ResultsContext = createContext<Map<string, NodeResult>>(new Map());

export function UnitSelect({ value, onChange, className }: { value: string; onChange: (u: string) => void; className?: string }) {
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Unit">
      {unitGroups().map((g) => (
        <optgroup key={g} label={g}>
          {UNITS.filter((u) => u.group === g).map((u) => (
            <option key={u.symbol} value={u.symbol}>{u.symbol || '—'}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function header(node: FNode['data']): { glyph: string; title: string; caption: string } {
  switch (node.kind) {
    case 'quantity': {
      const d = node.cfg as QuantityData;
      return { glyph: '', title: d.label, caption: 'Input' };
    }
    case 'constant': {
      const c = getConstant((node.cfg as ConstantData).constId);
      return { glyph: c?.symbol ?? '?', title: c?.name ?? 'Constant', caption: 'Constant' };
    }
    case 'op': {
      const o = getOp((node.cfg as OpData).op);
      return { glyph: o?.glyph ?? '?', title: o?.label ?? 'Operation', caption: 'Operation' };
    }
    case 'formula':
      return { glyph: 'ƒ', title: (node.cfg as FormulaData).label, caption: 'Formula' };
    case 'output':
      return { glyph: '=', title: (node.cfg as OutputData).label, caption: 'Output' };
    case 'group': {
      const g = node.cfg as GroupData;
      return { glyph: '▣', title: g.label, caption: `Group of ${g.nodes.length} blocks` };
    }
  }
}

export const PhysNode = memo(function PhysNode({ id, data, selected }: NodeProps<FNode>) {
  const result = useContext(ResultsContext).get(id);
  const updateCfg = useFlow((s) => s.updateCfg);
  const ports = inputPorts({ kind: data.kind, data: data.cfg });
  const portKey = ports.join('|');
  const updateInternals = useUpdateNodeInternals();
  useEffect(() => updateInternals(id), [id, portKey, updateInternals]);

  const h = header(data);
  const tone = toneOf(data.kind);
  const q = result?.q;
  const outUnit = data.kind === 'output' ? (data.cfg as OutputData).unit : data.kind === 'quantity' ? (data.cfg as QuantityData).unit : undefined;
  const symbolTex =
    data.kind === 'quantity' ? symbolToLatex((data.cfg as QuantityData).symbol || '?')
      : data.kind === 'output' ? symbolToLatex((data.cfg as OutputData).symbol || '?') : null;

  return (
    <div className={`pnode tone-${tone}${selected ? ' selected' : ''}${result?.error ? ' has-error' : ''}`}>
      <div className="pnode-head">
        <span className="pnode-icon">{data.kind === 'quantity' && symbolTex ? <Tex tex={symbolTex} /> : h.glyph}</span>
        <span className="pnode-titles">
          <span className="pnode-title">{h.title || 'Untitled'}</span>
          <span className="pnode-caption">{h.caption}</span>
        </span>
      </div>

      {data.kind === 'quantity' && (
        <div className="pnode-body pnode-row nodrag">
          <span className="pnode-sym"><Tex tex={`${symbolTex} =`} /></span>
          <NumberField className="pnode-input" value={(data.cfg as QuantityData).value} onChange={(value) => updateCfg(id, { value })} />
          <UnitSelect className="pnode-unit" value={(data.cfg as QuantityData).unit} onChange={(unit) => updateCfg(id, { unit })} />
        </div>
      )}

      {data.kind === 'formula' && (
        <div className="pnode-body">
          <code className="pnode-expr">{(data.cfg as FormulaData).expr || '…'}</code>
        </div>
      )}

      {ports.length > 0 && (
        <div className="pnode-ports">
          {ports.map((p) => (
            <div className="pnode-port" key={p}>
              <Handle type="target" position={Position.Left} id={p} />
              <span>{data.kind === 'output' ? 'value' : p}</span>
            </div>
          ))}
        </div>
      )}

      <div className="pnode-foot">
        {result?.error ? (
          <span className="pnode-error" title={result.error}>{result.upstream ? '…' : '⚠'} {result.error}</span>
        ) : q ? (
          <>
            <span className="pnode-value">
              {data.kind === 'output' && symbolTex && <Tex tex={`${symbolTex} =`} />} {quantityText(q, outUnit)}
            </span>
            {knownDimName(q.d) && <span className="pnode-dim">{knownDimName(q.d)}</span>}
          </>
        ) : (
          <span className="pnode-dim">—</span>
        )}
      </div>

      {data.kind !== 'output' && <Handle type="source" position={Position.Right} />}
    </div>
  );
});

export { NumberField };
