/**
 * Reading and writing document files, and saying what differs between two.
 *
 * Files are JSON laid out for version control: keys in a fixed order, one
 * state, parameter, block or wire per line, and for flows the positions of
 * the blocks kept apart from what the blocks compute. A diff of two saved
 * versions then shows what changed scientifically, a line at a time.
 */
import type { OdeModel } from './ode';

// ------------------------------------------------------------------ writing

/** Keys that read best first within an item, in this order; the rest follow alphabetically. */
const ITEM_ORDER = ['id', 'name', 'param', 'from', 'to', 'points', 'param2', 'from2', 'to2', 'points2', 'observable', 'kind', 'label', 'symbol', 'value', 'init', 'deriv', 'expr', 'when', 'then', 'unit', 'min', 'max', 'step',
  'measure', 'compare', 'dist', 'a', 'b', 'source', 'sourceHandle', 'target', 'targetHandle'];
const rank = (k: string) => { const i = ITEM_ORDER.indexOf(k); return i < 0 ? ITEM_ORDER.length : i; };
const ordered = (o: object) => Object.entries(o).filter(([, v]) => v !== undefined).sort(([a], [b]) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));

/** A value on one line, with spaces a person would put there. */
function inline(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
  if (v && typeof v === 'object') {
    const body = ordered(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ');
    return body ? `{ ${body} }` : '{}';
  }
  return JSON.stringify(v ?? null);
}

/**
 * JSON with one top-level entry per block and, inside a list or a group, one
 * item per line. `keys` fixes the order of the top level; anything not named
 * follows alphabetically, so a field added later still has a stable place.
 */
export function writeDocument(doc: Record<string, unknown>, keys: string[]): string {
  const isObject = (x: unknown) => !!x && typeof x === 'object';
  // A list puts each item on a line; a group puts each entry on a line and may open one more level.
  const block = (v: unknown, pad: string, depth: number): string => {
    if (depth > 0 && Array.isArray(v) && v.some(isObject)) return `[\n${v.map((x) => `${pad}  ${inline(x)}`).join(',\n')}\n${pad}]`;
    if (depth > 0 && isObject(v) && !Array.isArray(v) && Object.values(v as object).some(isObject)) {
      const entries = Object.entries(v as object).filter(([, x]) => x !== undefined);
      return `{\n${entries.map(([k, x]) => `${pad}  ${JSON.stringify(k)}: ${block(x, `${pad}  `, depth - 1)}`).join(',\n')}\n${pad}}`;
    }
    return inline(v);
  };
  const names = [...keys.filter((k) => k in doc), ...Object.keys(doc).filter((k) => !keys.includes(k)).sort()];
  const entries = names.filter((k) => doc[k] !== undefined).map((k) => `  ${JSON.stringify(k)}: ${block(doc[k], '  ', 2)}`);
  return `{\n${entries.join(',\n')}\n}\n`;
}

/** What the model computes comes first, how it is displayed after, and the bulky imported data last. */
const SIM_KEYS = ['format', 'app', 'name', 'summary', 'id', 'states', 'params', 'derived', 'events', 'stopWhen', 'method', 'tol', 'dt', 'tEnd',
  'expectations', 'experiment', 'uncertainty', 'notes', 'timeSeries', 'phase', 'view3d', 'scene', 'data'];

export const simFile = (model: OdeModel, format: number, app: string): string => writeDocument({ format, app, ...model }, SIM_KEYS);

/** The parts of a flow document this module needs; the editor's richer node type fits it. */
export interface FlowBlock { id: string; type?: string; position: { x: number; y: number }; data: { kind: string; cfg: Record<string, unknown> | object } }
export interface FlowWire { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }
export interface FlowFile { name: string; description: string; nodes: FlowBlock[]; edges: FlowWire[]; model: Record<string, unknown> | object }

const byId = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * A flow on disk: blocks and wires in a fixed order (so moving or re-selecting
 * a block does not reorder the file), and block positions in their own
 * `layout` section, where dragging a block changes exactly one line.
 */
export function flowFile(doc: FlowFile, format: number, app: string): string {
  const nodes = byId(doc.nodes);
  return writeDocument({
    format, app, name: doc.name, description: doc.description,
    nodes: nodes.map((n) => ({ id: n.id, kind: n.data.kind, cfg: n.data.cfg })),
    edges: byId(doc.edges).map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle ?? undefined, target: e.target, targetHandle: e.targetHandle ?? undefined })),
    model: doc.model,
    layout: Object.fromEntries(nodes.map((n) => [n.id, [Math.round(n.position.x), Math.round(n.position.y)]])),
  }, ['format', 'app', 'name', 'description', 'nodes', 'edges', 'model', 'layout']);
}

// ------------------------------------------------------------------ reading

export type ReadResult =
  | { kind: 'sim'; model: OdeModel }
  | { kind: 'flow'; flow: FlowFile }
  | { kind: 'newer'; format: number }
  | { kind: 'unknown' };

/**
 * Parse a document file of any format this version understands.
 * Migrations: 1 → 2 added an optional `uncertainty` analysis to simulations
 * (nothing to convert). 2 → 3 moved flow block positions into `layout` and
 * flattened each block to { id, kind, cfg }; both shapes are read.
 */
export function readDocument(text: string, currentFormat: number): ReadResult {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    return { kind: 'unknown' };
  }
  if (!data || typeof data !== 'object') return { kind: 'unknown' };
  // Files record the format they were written in, so a newer file is refused clearly instead of half-loading.
  if (typeof data.format === 'number' && data.format > currentFormat) return { kind: 'newer', format: data.format };
  const { format: _format, app: _app, ...doc } = data;
  if (Array.isArray(doc.states) && Array.isArray(doc.params) && typeof doc.tEnd === 'number') return { kind: 'sim', model: doc as unknown as OdeModel };
  if (Array.isArray(doc.nodes) && Array.isArray(doc.edges)) {
    const layout = (doc.layout && typeof doc.layout === 'object' ? doc.layout : {}) as Record<string, unknown>;
    const nodes = (doc.nodes as Record<string, unknown>[]).map((n): FlowBlock => {
      const at = layout[String(n.id)];
      const old = n.position as { x: number; y: number } | undefined;
      const position = Array.isArray(at) ? { x: Number(at[0]) || 0, y: Number(at[1]) || 0 } : old ?? { x: 0, y: 0 };
      const data = (n.data as FlowBlock['data'] | undefined) ?? { kind: String(n.kind), cfg: (n.cfg ?? {}) as object };
      return { id: String(n.id), type: 'phys', position, data };
    });
    return {
      kind: 'flow',
      flow: { name: String(doc.name ?? 'Untitled flow'), description: String(doc.description ?? ''), nodes, edges: doc.edges as FlowWire[], model: (doc.model ?? {}) as object },
    };
  }
  return { kind: 'unknown' };
}

// ---------------------------------------------------------------- comparing

export interface Change {
  /** Heading the change is listed under. */
  section: string;
  kind: 'added' | 'removed' | 'changed';
  /** What changed, in the user's terms: "dx/dt", "k", "wire Mass → Multiply (a)". */
  what: string;
  before?: string;
  after?: string;
  /** False for changes that cannot alter any computed number (names, notes, chart settings, positions). */
  numeric: boolean;
}

const text = (v: unknown): string => (v === undefined || v === null || v === '' ? '—' : typeof v === 'string' ? v : typeof v === 'number' ? String(v) : inline(v));
// Compared in canonical form, so the order keys happen to be stored in never counts as a difference.
const same = (a: unknown, b: unknown) => inline(a ?? null) === inline(b ?? null);

/** Collects the changes of one section. */
function section(out: Change[], name: string, numeric: boolean) {
  return {
    field(what: string, before: unknown, after: unknown, isNumeric = numeric) {
      if (!same(before, after)) out.push({ section: name, kind: 'changed', what, before: text(before), after: text(after), numeric: isNumeric });
    },
    /** Items matched by key: report those added and removed, and hand the pairs present in both to `both`. */
    keyed<T>(before: T[], after: T[], key: (item: T) => string, describe: (item: T) => string, both: (a: T, b: T) => void) {
      const old = new Map(before.map((x) => [key(x), x]));
      const now = new Map(after.map((x) => [key(x), x]));
      for (const [k, x] of old) if (!now.has(k)) out.push({ section: name, kind: 'removed', what: k, before: describe(x), numeric });
      for (const [k, x] of now) {
        const prior = old.get(k);
        if (prior === undefined) out.push({ section: name, kind: 'added', what: k, after: describe(x), numeric });
        else both(prior, x);
      }
    },
    /** Items with no name of their own: compared as a set of descriptions. */
    listed<T>(before: T[], after: T[], describe: (item: T) => string, noun: string) {
      const old = before.map(describe), now = after.map(describe);
      for (const d of old) if (!now.includes(d)) out.push({ section: name, kind: 'removed', what: noun, before: d, numeric });
      for (const d of now) if (!old.includes(d)) out.push({ section: name, kind: 'added', what: noun, after: d, numeric });
    },
  };
}

const METHODS: Record<string, string> = { rk45: 'adaptive RK45', ros23: 'Rosenbrock 2(3)', rk4: 'RK4 fixed step', euler: 'Euler' };

/** What differs between two simulations, from `before` to `after`. */
export function diffSim(before: OdeModel, after: OdeModel): Change[] {
  const out: Change[] = [];

  const states = section(out, 'State variables', true);
  states.keyed(before.states, after.states, (s) => s.name, (s) => `starts at ${s.init}; d${s.name}/dt = ${s.deriv}`, (a, b) => {
    states.field(`d${b.name}/dt`, a.deriv, b.deriv);
    states.field(`${b.name} at t = 0`, a.init, b.init);
    states.field(`unit of ${b.name}`, a.unit, b.unit, false);
  });

  const params = section(out, 'Parameters', true);
  params.keyed(before.params, after.params, (p) => p.name, (p) => `${p.value}${p.unit ? ` ${p.unit}` : ''}`, (a, b) => {
    params.field(b.name, a.value, b.value);
    params.field(`unit of ${b.name}`, a.unit, b.unit, false);
    params.field(`range of ${b.name}`, `${a.min} to ${a.max}`, `${b.min} to ${b.max}`, false);
    params.field(`label of ${b.name}`, a.label, b.label, false);
  });

  const derived = section(out, 'Observables', true);
  derived.keyed(before.derived, after.derived, (d) => d.name, (d) => d.expr, (a, b) => {
    derived.field(b.name, a.expr, b.expr);
    derived.field(`unit of ${b.name}`, a.unit, b.unit, false);
  });

  const live = (m: OdeModel) => (m.events ?? []).filter((e) => e.when.trim());
  section(out, 'Events', true).listed(live(before), live(after), (e) => `when ${e.when} then ${e.then}`, 'event');

  const solver = section(out, 'Solver', true);
  const method = (m: OdeModel) => m.method ?? 'rk4';
  solver.field('method', METHODS[method(before)], METHODS[method(after)]);
  const adaptive = (m: OdeModel) => method(m) === 'rk45' || method(m) === 'ros23';
  // Only the setting the chosen method uses can change the numbers.
  solver.field('relative tolerance', before.tol, after.tol, adaptive(before) || adaptive(after));
  solver.field('step', before.dt, after.dt, !adaptive(before) || !adaptive(after));
  solver.field('duration', before.tEnd, after.tEnd);
  solver.field('stop when', before.stopWhen, after.stopWhen);

  section(out, 'Expectations', false).listed(before.expectations ?? [], after.expectations ?? [],
    (e) => `${e.measure} of ${e.observable} ${e.compare === 'equals' ? `= ${e.value} ± ${e.tolerance ?? 0}` : `${e.compare === 'atMost' ? '≤' : '≥'} ${e.value}`}`, 'expectation');

  const analyses = section(out, 'Analyses', false);
  const scan = (m: OdeModel) => {
    const e = m.experiment;
    return e && `${e.measure} of ${e.observable} for ${e.param} from ${e.from} to ${e.to} in ${e.points} steps${e.param2 ? `, and ${e.param2} from ${e.from2} to ${e.to2} in ${e.points2} steps` : ''}`;
  };
  const spread = (m: OdeModel) => {
    const u = m.uncertainty;
    return u && `${u.measure} of ${u.observable}; ${u.samples} samples, seed ${u.seed}; ${u.inputs.map((i) => (i.dist === 'normal' ? `${i.param} = ${i.a} ± ${i.b}` : `${i.param} from ${i.a} to ${i.b}`)).join(', ')}`;
  };
  analyses.field('experiment', scan(before), scan(after));
  analyses.field('uncertainty analysis', spread(before), spread(after));
  const data = (m: OdeModel) => m.data && `${m.data.name}: ${m.data.columns[0]?.values.length ?? 0} rows, ${m.data.columns.map((c) => c.name).join(', ')}`;
  analyses.field('measured data', data(before), data(after));
  if (before.data && after.data && same(data(before), data(after))) {
    if (!same(before.data.columns, after.data.columns)) out.push({ section: 'Analyses', kind: 'changed', what: 'measured data', before: 'different values', after: 'in the same columns', numeric: false });
    analyses.field('data pairing', before.data.pairs, after.data.pairs);
  }

  const about = section(out, 'Description and display', false);
  about.field('name', before.name, after.name);
  about.field('summary', before.summary, after.summary);
  about.field('notes', before.notes || undefined, after.notes || undefined);
  about.field('charted quantities', before.timeSeries.join(', '), after.timeSeries.join(', '));
  about.field('phase portrait', before.phase.join(' vs '), after.phase.join(' vs '));
  about.field('3D axes', before.view3d?.join(', '), after.view3d?.join(', '));
  if (!same(before.scene, after.scene)) out.push({ section: 'Description and display', kind: 'changed', what: 'picture', before: before.scene ? 'defined' : '—', after: after.scene ? (before.scene ? 'edited' : 'defined') : '—', numeric: false });
  return out;
}

/** A block as a person would name it: its label or symbol, falling back to what kind it is. */
export function blockName(b: FlowBlock): string {
  const cfg = b.data.cfg as Record<string, unknown>;
  const name = cfg.label || cfg.symbol || cfg.constId || cfg.op;
  return name ? String(name) : b.data.kind;
}

/** What differs between two flows, from `before` to `after`. */
export function diffFlow(before: FlowFile, after: FlowFile): Change[] {
  const out: Change[] = [];
  const names = new Map([...before.nodes, ...after.nodes].map((n) => [n.id, blockName(n)]));

  const blocks = section(out, 'Blocks', true);
  const settings = (b: FlowBlock) => `${b.data.kind}: ${ordered(b.data.cfg).map(([k, v]) => `${k} ${text(v)}`).join(', ')}`;
  blocks.keyed(before.nodes, after.nodes, (n) => n.id, settings, (a, b) => {
    blocks.field(`${blockName(b)}: kind`, a.data.kind, b.data.kind);
    const ca = a.data.cfg as Record<string, unknown>, cb = b.data.cfg as Record<string, unknown>;
    for (const k of new Set([...Object.keys(ca), ...Object.keys(cb)])) {
      // A label, or the range a slider offers, changes how a block reads, not what it computes.
      blocks.field(`${blockName(b)}: ${k}`, ca[k], cb[k], !['label', 'min', 'max'].includes(k));
    }
  });
  // Blocks are matched by id; show them by name.
  for (const c of out) if (c.section === 'Blocks' && c.kind !== 'changed') c.what = names.get(c.what) ?? c.what;

  const wire = (e: FlowWire) => `${names.get(e.source) ?? e.source} → ${names.get(e.target) ?? e.target}${e.targetHandle ? ` (${e.targetHandle})` : ''}`;
  const key = (e: FlowWire) => `${e.source}>${e.target}:${e.targetHandle ?? ''}`;
  const wires = section(out, 'Wires', true);
  wires.keyed(before.edges, after.edges, key, wire, () => {});
  for (const c of out) if (c.section === 'Wires') { c.what = 'wire'; }

  const moved = after.nodes.filter((n) => {
    const p = before.nodes.find((m) => m.id === n.id)?.position;
    return p && (Math.round(p.x) !== Math.round(n.position.x) || Math.round(p.y) !== Math.round(n.position.y));
  });
  if (moved.length) {
    out.push({ section: 'Layout and description', kind: 'changed', what: 'positions', before: '—', after: `${moved.length} ${moved.length === 1 ? 'block' : 'blocks'} moved`, numeric: false });
  }
  const about = section(out, 'Layout and description', false);
  about.field('name', before.name, after.name);
  about.field('description', before.description, after.description);
  const ma = before.model as Record<string, unknown>, mb = after.model as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ma), ...Object.keys(mb)])) about.field(`chart setting: ${k}`, ma[k], mb[k]);
  return out;
}

// ------------------------------------------------------------- auto-layout

/**
 * Positions that read left to right: each block one column to the right of
 * the furthest block feeding it, level with the middle of those blocks where
 * there is room. Blocks caught in a loop (which the editor does not evaluate anyway)
 * are placed as if the wire closing the loop were absent.
 */
export function layoutFlow(nodes: { id: string }[], edges: { source: string; target: string }[], spacing = { x: 260, y: 160 }): Record<string, { x: number; y: number }> {
  const ids = nodes.map((n) => n.id);
  const known = new Set(ids);
  const wires = edges.filter((e) => known.has(e.source) && known.has(e.target) && e.source !== e.target);
  const column = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    const done = column.get(id);
    if (done !== undefined) return done;
    if (visiting.has(id)) return -1;
    visiting.add(id);
    let d = 0;
    for (const e of wires) if (e.target === id) d = Math.max(d, depth(e.source) + 1);
    visiting.delete(id);
    column.set(id, d);
    return d;
  };
  ids.forEach(depth);

  const columns: string[][] = [];
  for (const id of ids) (columns[column.get(id)!] ??= []).push(id);
  const row = new Map<string, number>();
  columns.forEach((col, c) => {
    if (c === 0) return col.forEach((id, i) => row.set(id, i));
    // Each block wants to sit level with the middle of the blocks feeding it; ties keep their existing order.
    const wanted = new Map(col.map((id) => {
      const from = wires.filter((e) => e.target === id && row.has(e.source)).map((e) => row.get(e.source)!);
      return [id, from.length ? from.reduce((sum, v) => sum + v, 0) / from.length : Infinity];
    }));
    col.sort((a, b) => wanted.get(a)! - wanted.get(b)!);
    // Give each its wish where there is room, otherwise the next free slot below.
    let next = -Infinity;
    for (const id of col) {
      const want = wanted.get(id)!;
      const at = Math.max(Number.isFinite(want) ? want : 0, next);
      row.set(id, at);
      next = at + 1;
    }
  });
  return Object.fromEntries(ids.map((id) => [id, { x: column.get(id)! * spacing.x, y: Math.round(row.get(id)! * spacing.y) }]));
}
