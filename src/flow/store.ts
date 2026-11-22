import { addEdge, type Connection, type EdgeChangeset, type NodeChangeset } from '@xyflow/react';
import { create } from 'zustand';
import { inputPorts, type NodeKind } from '../core/graph';
import { EXAMPLES } from './examples';
import { emptyModel, type Cfg, type FEdge, type FlowDoc, type FNode, type ModelCfg } from './types';

const STORAGE_KEY = 'physics-tooling.flow.v1';

interface FlowState extends FlowDoc {
  selectedId: string | null;
  /** Path of the file this flow was opened from or last saved to. */
  filePath: string | null;
  /** True when the flow differs from what is on disk. */
  dirty: boolean;
  /** A dismissible error message for the editor. */
  notice: string;
  /** Bumped whenever a whole document is loaded, so the canvas can re-fit. */
  docVersion: number;
  onNodesChange: (changes: NodeChangeset<FNode>) => void;
  onEdgesChange: (changes: EdgeChangeset<FEdge>) => void;
  onConnect: (c: Connection) => void;
  addNode: (kind: NodeKind, cfg: Cfg, position: { x: number; y: number }) => string;
  updateCfg: (id: string, patch: Partial<Record<string, unknown>>) => void;
  removeNode: (id: string) => void;
  select: (id: string | null) => void;
  setMeta: (patch: Partial<Pick<FlowDoc, 'name' | 'description'>>) => void;
  setModel: (patch: Partial<ModelCfg>) => void;
  load: (doc: FlowDoc) => void;
  clear: () => void;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function restore(): FlowDoc {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const doc = JSON.parse(raw) as FlowDoc;
      if (Array.isArray(doc.nodes) && Array.isArray(doc.edges)) return { ...doc, model: { ...emptyModel(), ...doc.model } };
    }
  } catch {
    /* fall through to the default example */
  }
  return clone(EXAMPLES[0]);
}

let counter = 0;
const newId = () => `n${Date.now().toString(36)}${(counter++).toString(36)}`;

export const useFlow = create<FlowState>((set, get) => ({
  ...restore(),
  selectedId: null,
  filePath: null,
  dirty: false,
  notice: '',
  docVersion: 0,
  onNodesChange: (changes) => {
    const nodes = changes.applyTo(get().nodes);
    const selectedId = get().selectedId;
    set({ nodes, selectedId: selectedId && nodes.some((n) => n.id === selectedId) ? selectedId : null });
  },
  onEdgesChange: (changes) => set({ edges: changes.applyTo(get().edges) }),
  onConnect: (c) => {
    if (c.source === c.target) return;
    // An input port carries exactly one wire: a new connection replaces the old one.
    const edges = get().edges.filter((e) => !(e.target === c.target && e.targetHandle === c.targetHandle));
    set({ edges: addEdge({ ...c, id: `${c.source}->${c.target}:${c.targetHandle}` }, edges) });
  },
  addNode: (kind, cfg, position) => {
    const id = newId();
    const node: FNode = { id, type: 'phys', position, data: { kind, cfg: clone(cfg) }, selected: true };
    set({
      nodes: [...get().nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), node],
      selectedId: id,
    });
    // First output added becomes the modelled output.
    if (kind === 'output' && !get().nodes.some((n) => n.id === get().model.outputId)) get().setModel({ outputId: id });
    return id;
  },
  updateCfg: (id, patch) => {
    const nodes = get().nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, cfg: { ...n.data.cfg, ...patch } as Cfg } } : n,
    );
    // Drop wires into ports that no longer exist (e.g. a formula variable was renamed).
    const node = nodes.find((n) => n.id === id);
    const ports = node ? inputPorts({ kind: node.data.kind, data: node.data.cfg }) : [];
    const edges = get().edges.filter((e) => e.target !== id || ports.includes(e.targetHandle ?? ''));
    set({ nodes, edges });
  },
  removeNode: (id) =>
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      selectedId: get().selectedId === id ? null : get().selectedId,
    }),
  select: (id) => set({ selectedId: id }),
  setMeta: (patch) => set(patch),
  setModel: (patch) => set({ model: { ...get().model, ...patch } }),
  load: (doc) => {
    const d = clone(doc);
    set({
      name: d.name, description: d.description, nodes: d.nodes, edges: d.edges,
      model: { ...emptyModel(), ...d.model }, selectedId: null, docVersion: get().docVersion + 1,
    });
  },
  clear: () =>
    set({
      name: 'Untitled flow', description: '', nodes: [], edges: [], model: emptyModel(), selectedId: null,
      docVersion: get().docVersion + 1,
    }),
}));

export const currentDoc = (): FlowDoc => {
  const { name, description, nodes, edges, model } = useFlow.getState();
  return {
    name, description, model, edges,
    nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data }) as FNode),
  };
};

// Unsaved-changes tracking: compare against the last version written to (or read from) disk.
let savedJson = JSON.stringify(currentDoc());

/** Record that the current flow matches the file at `filePath`. */
export function markSaved(filePath: string | null) {
  savedJson = JSON.stringify(currentDoc());
  useFlow.setState({ filePath, dirty: false, notice: '' });
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
useFlow.subscribe(() => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const json = JSON.stringify(currentDoc());
    const dirty = json !== savedJson;
    if (dirty !== useFlow.getState().dirty) useFlow.setState({ dirty });
    // Also keep a working copy so an unsaved flow survives closing the app.
    try {
      localStorage.setItem(STORAGE_KEY, json);
    } catch {
      /* storage unavailable — the working copy simply isn't kept */
    }
  }, 300);
});
