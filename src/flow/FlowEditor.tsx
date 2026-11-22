import {
  Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { confirmDiscard, newDocument, openDocument, saveDocument } from '../documents';
import { evaluate } from '../core/graph';
import type { PaletteItem } from './catalog';
import { EXAMPLES } from './examples';
import { Inspector } from './Inspector';
import { ModelPanel } from './ModelPanel';
import { DRAG_MIME, findPaletteItem, Palette } from './Palette';
import { PhysNode, ResultsContext } from './PhysNode';
import { markSaved, useFlow } from './store';
import { toGraph } from './types';

const nodeTypes = { phys: PhysNode };
// Stable handlers: React Flow re-runs selection callbacks whenever their identity changes.
const onSelectionChange = ({ nodes }: { nodes: { id: string }[] }) => {
  const id = nodes.length === 1 ? nodes[0].id : null;
  if (useFlow.getState().selectedId !== id) useFlow.getState().select(id);
};
const isValidConnection = (c: { source: string | null; target: string | null }) => c.source !== c.target;
const snapGrid: [number, number] = [10, 10];
const deleteKeys = ['Backspace', 'Delete'];
const defaultEdgeOptions = {
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: '#8a8886' },
};

function Editor() {
  const s = useFlow();
  const rf = useReactFlow();
  const wrap = useRef<HTMLDivElement>(null);
  const [showModel, setShowModel] = useState(true);

  const graphKey = JSON.stringify([s.nodes.map((n) => [n.id, n.data]), s.edges.map((e) => [e.source, e.target, e.targetHandle])]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const results = useMemo(() => evaluate(toGraph(s.nodes, s.edges)), [graphKey]);

  useEffect(() => {
    const t = setTimeout(() => rf.fitView({ padding: '8%', maxZoom: 1, duration: 200 }), 180);
    return () => clearTimeout(t);
  }, [s.docVersion, rf, showModel]);

  const addAtCentre = useCallback((item: PaletteItem) => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return;
    const p = rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    // Nudge so repeated clicks don't stack blocks exactly on top of each other.
    const jitter = (useFlow.getState().nodes.length % 6) * 24;
    useFlow.getState().addNode(item.kind, item.cfg, { x: p.x - 110 + jitter, y: p.y - 50 + jitter });
  }, [rf]);

  const onDrop = useCallback((e: React.DragEvent) => {
    const item = findPaletteItem(e.dataTransfer.getData(DRAG_MIME));
    if (!item) return;
    e.preventDefault();
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    useFlow.getState().addNode(item.kind, item.cfg, { x: p.x - 110, y: p.y - 30 });
  }, [rf]);

  const fileName = s.filePath?.split(/[\\/]/).pop();

  return (
    <ResultsContext.Provider value={results}>
      <div className="flow-layout">
        <Palette onAdd={addAtCentre} />
        <div className="flow-main">
          <div className="commandbar">
            <input className="flow-name" value={s.name} onChange={(e) => s.setMeta({ name: e.target.value })} aria-label="Flow name" />
            <span className="file-status" title={s.filePath ?? 'Not saved to a file yet'}>
              {fileName ?? 'Unsaved'}{s.dirty ? ' • edited' : ''}
            </span>
            <span className="spacer" />
            <select
              className="examples"
                value=""
                onChange={(e) => {
                  const ex = EXAMPLES.find((x) => x.name === e.target.value);
                  if (ex && confirmDiscard('flow')) {
                    s.load(ex);
                    markSaved(null);
                  }
                }}
                aria-label="Load an example flow"
              >
                <option value="" disabled>Examples…</option>
                {EXAMPLES.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
            </select>
            <button className="btn" onClick={() => newDocument('flow')}>New</button>
            <button className="btn" onClick={() => void openDocument()}>Open</button>
            <button className="btn" onClick={() => void saveDocument('flow')} title={fileName ? `Save to ${s.filePath}` : 'Save this flow to a file'}>Save</button>
            <button className="btn" onClick={() => void saveDocument('flow', true)}>Save As</button>
            <button className="btn" onClick={() => setShowModel(!showModel)} aria-pressed={showModel}>{showModel ? 'Hide model' : 'Show model'}</button>
          </div>
          {s.notice && <div className="notice" role="alert">{s.notice} <button className="link" onClick={() => useFlow.setState({ notice: '' })}>Dismiss</button></div>}
          <div className="canvas" ref={wrap} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }} onDrop={onDrop}>
            <ReactFlow
              nodes={s.nodes}
              edges={s.edges}
              nodeTypes={nodeTypes}
              defaultEdgeOptions={defaultEdgeOptions}
              onNodesChange={s.onNodesChange}
              onEdgesChange={s.onEdgesChange}
              onConnect={s.onConnect}
              onSelectionChange={onSelectionChange}
              isValidConnection={isValidConnection}
              minZoom={0.2}
              maxZoom={2}
              snapToGrid
              snapGrid={snapGrid}
              deleteKeyCode={deleteKeys}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="#d2d0ce" />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable nodeColor="#c8c6c4" maskColor="rgba(243,242,241,0.7)" style={{ width: 132, height: 88 }} />
            </ReactFlow>
            {!s.nodes.length && (
              <div className="canvas-empty">
                <h3>Start building</h3>
                <p>Drag a block from the left, or load one of the examples from the bar above.</p>
              </div>
            )}
          </div>
          {showModel && <ModelPanel />}
        </div>
        <Inspector />
      </div>
    </ResultsContext.Provider>
  );
}

export function FlowEditor() {
  return (
    <ReactFlowProvider>
      <Editor />
    </ReactFlowProvider>
  );
}
