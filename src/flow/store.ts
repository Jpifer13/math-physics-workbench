import { readStored, storageKey } from '../core/brand';
import { addEdge, type Connection, type EdgeChangeset, type NodeChangeset } from '@xyflow/react';
import { create } from 'zustand';
import { layoutFlow } from '../core/docfile';
import { groupNodes, inputPorts, ungroupNode, type GEdge, type GroupData, type NodeKind } from '../core/graph';
import { EXAMPLES } from './examples';
import { emptyModel, toGraph, type Cfg, type FEdge, type FlowDoc, type FNode, type ModelCfg } from './types';

const STORAGE = 'flow.v1';

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
  /** Arrange the blocks left to right along the wires. */
  tidy: () => void;
  /** Collapse the selected blocks into one group block. Sets `notice` when they cannot be one. */
  groupSelected: () => void;
  /** Put a group's blocks back in its place. */
  ungroup: (id: string) => void;
  /** A second copy of a block beside the first. */
  duplicate: (id: string) => void;
  clear: () => void;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function restore(): FlowDoc {
  try {
    const raw = readStored(localStorage, STORAGE);
    if (raw) {
      const doc = JSON.parse(raw) as FlowDoc;
      if (Array.isArray(doc.nodes) && Array.isArray(doc.edges)) return { ...doc, model: { ...emptyModel(), ...doc.model } };
    }
  } catch {
    /* fall through to the default example */
  }
  return clone(EXAMPLES[0]);
}

/** A wire of the engine's graph as the canvas draws it. */
const wire = (e: GEdge): FEdge => ({ id: `${e.source}->${e.target}:${e.port}`, source: e.source, target: e.target, targetHandle: e.port });

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
  tidy: () => {
    const at = layoutFlow(get().nodes, get().edges);
    // Keep the arrangement where the flow already is, rather than jumping to the origin.
    const x0 = Math.min(...get().nodes.map((n) => n.position.x));
    const y0 = Math.min(...get().nodes.map((n) => n.position.y));
    if (!get().nodes.length) return;
    set({ nodes: get().nodes.map((n) => ({ ...n, position: { x: x0 + at[n.id].x, y: y0 + at[n.id].y } })), docVersion: get().docVersion + 1 });
  },
  groupSelected: () => {
    const { nodes, edges } = get();
    const chosen = nodes.filter((n) => n.selected);
    const id = newId();
    const r = groupNodes(toGraph(nodes, edges), chosen.map((n) => n.id), id, 'Group');
    if ('problem' in r) return set({ notice: r.problem });
    // The group sits in the middle of the blocks it replaces and remembers where each was.
    const x = Math.round(chosen.reduce((s, n) => s + n.position.x, 0) / chosen.length);
    const y = Math.round(chosen.reduce((s, n) => s + n.position.y, 0) / chosen.length);
    const made = r.graph.nodes.find((n) => n.id === id)!;
    const cfg: GroupData = { ...(made.data as GroupData), layout: Object.fromEntries(chosen.map((n) => [n.id, [n.position.x - x, n.position.y - y]])) };
    const inside = new Set(chosen.map((n) => n.id));
    set({
      nodes: [...nodes.filter((n) => !inside.has(n.id)), { id, type: 'phys', position: { x, y }, data: { kind: 'group', cfg }, selected: true }],
      edges: r.graph.edges.map(wire),
      selectedId: id,
      notice: '',
    });
  },
  ungroup: (id) => {
    const { nodes, edges } = get();
    const group = nodes.find((n) => n.id === id);
    const r = ungroupNode(toGraph(nodes, edges), id, () => newId());
    if (!group || !r) return;
    const cfg = group.data.cfg as GroupData;
    const restored = cfg.nodes.map((n, i): FNode => {
      const [dx, dy] = cfg.layout?.[n.id] ?? [i * 40, i * 40];
      return { id: r.ids[n.id], type: 'phys', position: { x: group.position.x + dx, y: group.position.y + dy }, data: { kind: n.kind, cfg: n.data as Cfg }, selected: true };
    });
    set({ nodes: [...nodes.filter((n) => n.id !== id), ...restored], edges: r.graph.edges.map(wire), selectedId: null });
  },
  duplicate: (id) => {
    const node = get().nodes.find((n) => n.id === id);
    if (!node) return;
    const copy: FNode = { id: newId(), type: 'phys', position: { x: node.position.x + 40, y: node.position.y + 40 }, data: clone(node.data), selected: true };
    set({ nodes: [...get().nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), copy], selectedId: copy.id });
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
      localStorage.setItem(storageKey(STORAGE), json);
    } catch {
      /* storage unavailable — the working copy simply isn't kept */
    }
  }, 300);
});
