import { useState } from 'react';
import { Grapher } from './Grapher';
import { Surface } from './Surface';
import { UnitsPanel } from './UnitsPanel';
import { VectorField } from './VectorField';

const TOOLS = [
  { id: 'graph', name: 'Function grapher', el: <Grapher /> },
  { id: 'surface', name: '3D surfaces', el: <Surface /> },
  { id: 'field', name: 'Vector fields', el: <VectorField /> },
  { id: 'units', name: 'Units & constants', el: <UnitsPanel /> },
];

export function MathTools() {
  const [tool, setTool] = useState('graph');
  return (
    <div className="tools">
      <div className="subtabs" role="tablist">
        {TOOLS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tool === t.id} className={tool === t.id ? 'on' : ''} onClick={() => setTool(t.id)}>{t.name}</button>
        ))}
      </div>
      {TOOLS.find((t) => t.id === tool)?.el}
    </div>
  );
}
