/**
 * The flow-graph engine: a framework-free model of nodes and wires plus an
 * evaluator that produces, for every node, a dimensional value and a symbolic
 * expression. The React Flow canvas is just one view of this.
 */
import { bin, fn, neg, num, sym, symbolToLatex, type Ex } from './expr';
import { evalFormula, formulaInputs, type Val } from './formula';
import * as Q from './qmath';
import { fmtNumLatex, fromUnit, getConstant, getUnit, siUnitFor, unitLatex, type Quantity } from './units';

export type NodeKind = 'quantity' | 'constant' | 'op' | 'formula' | 'output' | 'group';

export interface QuantityData { label: string; symbol: string; value: number; unit: string; min?: number; max?: number }
export interface ConstantData { constId: string }
export interface OpData { op: string }
export interface FormulaData { label: string; expr: string }
export interface OutputData { label: string; symbol: string; unit: string }
/**
 * Several blocks collapsed into one. The blocks and the wires between them
 * are kept inside; wires that crossed the boundary became the group's input
 * ports and its single output.
 */
export interface GroupData {
  label: string;
  nodes: GNode[];
  edges: GEdge[];
  /** Each input port, and the inner input it feeds. One port may feed several. */
  inputs: { port: string; node: string; nodePort: string }[];
  /** The inner block whose value is the group's value. */
  output: string;
  /** Where each inner block sat relative to the group, for when it is opened again. */
  layout?: Record<string, [number, number]>;
}

export interface GNode {
  id: string;
  kind: NodeKind;
  data: QuantityData | ConstantData | OpData | FormulaData | OutputData | GroupData;
}
export interface GEdge {
  source: string;
  target: string;
  /** Name of the input port on the target node. */
  port: string;
}
export interface Graph {
  nodes: GNode[];
  edges: GEdge[];
}

export interface OpDef {
  id: string;
  label: string;
  /** Short glyph shown on the node, e.g. "×". */
  glyph: string;
  inputs: string[];
  group: 'Arithmetic' | 'Powers & roots' | 'Trigonometry' | 'Exponential';
  hint: string;
  apply: (...a: Quantity[]) => Quantity;
  ex: (...a: Ex[]) => Ex;
}

const two = Q.scalar(2);
const binary = (
  id: string, label: string, glyph: string, op: '+' | '-' | '*' | '/' | '^', hint: string,
  apply: (a: Quantity, b: Quantity) => Quantity, inputs = ['a', 'b'],
  group: OpDef['group'] = 'Arithmetic',
): OpDef => ({ id, label, glyph, inputs, group, hint, apply, ex: (a, b) => bin(op, a, b) });
const unary = (id: string, label: string, glyph: string, group: OpDef['group'], hint: string): OpDef => ({
  id, label, glyph, inputs: ['x'], group, hint, apply: Q.FUNCTIONS[id], ex: (a) => fn(id, a),
});

export const OPS: readonly OpDef[] = [
  binary('add', 'Add', '+', '+', 'a + b — both inputs must have the same units', Q.add),
  binary('sub', 'Subtract', '−', '-', 'a − b — both inputs must have the same units', Q.sub),
  binary('mul', 'Multiply', '×', '*', 'a × b — units multiply too', Q.mul),
  binary('div', 'Divide', '÷', '/', 'a ÷ b — units divide too', Q.div),
  { id: 'neg', label: 'Negate', glyph: '−x', inputs: ['x'], group: 'Arithmetic', hint: 'Flip the sign', apply: Q.negate, ex: (a) => neg(a) },
  { id: 'recip', label: 'Reciprocal', glyph: '1/x', inputs: ['x'], group: 'Arithmetic', hint: '1 ÷ x', apply: (a) => Q.div(Q.scalar(1), a), ex: (a) => bin('/', num(1), a) },
  { id: 'abs', label: 'Absolute value', glyph: '|x|', inputs: ['x'], group: 'Arithmetic', hint: 'Magnitude of x', apply: Q.FUNCTIONS.abs, ex: (a) => fn('abs', a) },
  { id: 'half', label: 'Half', glyph: '½x', inputs: ['x'], group: 'Arithmetic', hint: 'x ÷ 2 — handy for ½mv²', apply: (a) => Q.div(a, two), ex: (a) => bin('*', bin('/', num(1), num(2)), a) },
  { id: 'double', label: 'Double', glyph: '2x', inputs: ['x'], group: 'Arithmetic', hint: 'x × 2', apply: (a) => Q.mul(two, a), ex: (a) => bin('*', num(2), a) },
  { id: 'square', label: 'Square', glyph: 'x²', inputs: ['x'], group: 'Powers & roots', hint: 'x × x', apply: (a) => Q.pow(a, two), ex: (a) => bin('^', a, num(2)) },
  { id: 'cube', label: 'Cube', glyph: 'x³', inputs: ['x'], group: 'Powers & roots', hint: 'x × x × x', apply: (a) => Q.pow(a, Q.scalar(3)), ex: (a) => bin('^', a, num(3)) },
  binary('pow', 'Power', 'xⁿ', '^', 'x raised to n (n must be a plain number)', Q.pow, ['x', 'n'], 'Powers & roots'),
  unary('sqrt', 'Square root', '√x', 'Powers & roots', 'Square root — halves every unit exponent'),
  unary('cbrt', 'Cube root', '∛x', 'Powers & roots', 'Cube root'),
  unary('sin', 'Sine', 'sin', 'Trigonometry', 'sin(x), x in radians (use the deg unit for degrees)'),
  unary('cos', 'Cosine', 'cos', 'Trigonometry', 'cos(x), x in radians'),
  unary('tan', 'Tangent', 'tan', 'Trigonometry', 'tan(x), x in radians'),
  unary('asin', 'Arcsine', 'sin⁻¹', 'Trigonometry', 'Inverse sine → angle in radians'),
  unary('acos', 'Arccosine', 'cos⁻¹', 'Trigonometry', 'Inverse cosine → angle in radians'),
  unary('atan', 'Arctangent', 'tan⁻¹', 'Trigonometry', 'Inverse tangent → angle in radians'),
  unary('exp', 'Exponential', 'eˣ', 'Exponential', 'e raised to x (x must be dimensionless)'),
  unary('ln', 'Natural log', 'ln', 'Exponential', 'Logarithm base e'),
  unary('log10', 'Log base 10', 'log₁₀', 'Exponential', 'Logarithm base 10'),
];
const OP_MAP = new Map(OPS.map((o) => [o.id, o]));
export const getOp = (id: string): OpDef | undefined => OP_MAP.get(id);

/** Names of the input ports a node exposes. */
export function inputPorts(node: Pick<GNode, 'kind' | 'data'>): string[] {
  switch (node.kind) {
    case 'op':
      return getOp((node.data as OpData).op)?.inputs ?? [];
    case 'formula':
      return formulaInputs((node.data as FormulaData).expr);
    case 'output':
      return ['in'];
    case 'group':
      return [...new Set((node.data as GroupData).inputs.map((i) => i.port))];
    default:
      return [];
  }
}

/** The id an inner block of a group takes when the group is expanded for evaluation. */
const innerId = (group: string, id: string) => `${group}/${id}`;

/**
 * Replace every group by the blocks inside it, so the evaluator only ever
 * sees plain blocks. Wires into a group go to the inner inputs its ports
 * feed; wires out of it come from its output block. `outputs` records which
 * expanded block stands for each group.
 */
export function expandGroups(graph: Graph): { graph: Graph; outputs: Map<string, string> } {
  const outputs = new Map<string, string>();
  if (!graph.nodes.some((n) => n.kind === 'group')) return { graph, outputs };
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const groups = new Map<string, GroupData>();
  for (const n of graph.nodes) {
    if (n.kind !== 'group') { nodes.push(n); continue; }
    const g = n.data as GroupData;
    groups.set(n.id, g);
    outputs.set(n.id, innerId(n.id, g.output));
    for (const inner of g.nodes) nodes.push({ ...inner, id: innerId(n.id, inner.id) });
    for (const e of g.edges) edges.push({ source: innerId(n.id, e.source), target: innerId(n.id, e.target), port: e.port });
  }
  for (const e of graph.edges) {
    const source = outputs.get(e.source) ?? e.source;
    const into = groups.get(e.target);
    if (!into) { edges.push({ source, target: e.target, port: e.port }); continue; }
    for (const i of into.inputs) if (i.port === e.port) edges.push({ source, target: innerId(e.target, i.node), port: i.nodePort });
  }
  // A group inside a group is now a top-level group of the expanded graph: go round again.
  const deeper = expandGroups({ nodes, edges });
  for (const [id, out] of outputs) outputs.set(id, deeper.outputs.get(out) ?? out);
  for (const [id, out] of deeper.outputs) if (!outputs.has(id)) outputs.set(id, out);
  return { graph: deeper.graph, outputs };
}

/** A short name for a block, for messages and port labels. */
export function nodeLabel(node: Pick<GNode, 'kind' | 'data'>): string {
  const d = node.data as unknown as Record<string, unknown>;
  if (node.kind === 'op') return getOp(String(d.op))?.label ?? 'Operation';
  if (node.kind === 'constant') return getConstant(String(d.constId))?.name ?? 'Constant';
  return String(d.label || d.symbol || node.kind);
}

/**
 * Collapse the blocks `ids` into one group block called `groupId`. Wires that
 * crossed into the selection become input ports; the one block whose value
 * leaves the selection becomes the output. Returns the reason instead when
 * the selection cannot be a group.
 */
export function groupNodes(graph: Graph, ids: string[], groupId: string, label: string): { graph: Graph } | { problem: string } {
  const inside = new Set(ids.filter((id) => graph.nodes.some((n) => n.id === id)));
  if (inside.size < 2) return { problem: 'Select at least two blocks to group.' };
  const members = graph.nodes.filter((n) => inside.has(n.id));
  if (members.some((n) => n.kind === 'output')) return { problem: 'A Result block cannot go inside a group: it has no value to pass on. Leave it out of the selection.' };

  const inner = graph.edges.filter((e) => inside.has(e.source) && inside.has(e.target));
  const incoming = graph.edges.filter((e) => !inside.has(e.source) && inside.has(e.target));
  const outgoing = graph.edges.filter((e) => inside.has(e.source) && !inside.has(e.target));

  // The output: the one block wired to the outside, or failing that the one block nothing inside consumes.
  let sources = [...new Set(outgoing.map((e) => e.source))];
  if (!sources.length) sources = members.filter((n) => !inner.some((e) => e.source === n.id)).map((n) => n.id);
  if (sources.length !== 1) {
    const names = sources.map((id) => nodeLabel(graph.nodes.find((n) => n.id === id)!));
    return { problem: `A group has one output, but ${names.length} of these blocks (${names.join(', ')}) pass a value on. Group a part of the flow that ends in a single block.` };
  }

  // One port per outside block feeding the selection. A port is named after the quantity wired to it now
  // (m, c) so the collapsed block reads like the formula; failing that, after the inner input it reaches.
  const hint = (sourceId: string, fallback: string) => {
    const n = graph.nodes.find((x) => x.id === sourceId);
    if (n?.kind === 'quantity') return (n.data as QuantityData).symbol || (n.data as QuantityData).label || fallback;
    if (n?.kind === 'constant') return getConstant((n.data as ConstantData).constId)?.symbol || fallback;
    return fallback;
  };
  const inputs: GroupData['inputs'] = [];
  const portOf = new Map<string, string>();
  const taken = new Set<string>();
  for (const e of incoming) {
    let port = portOf.get(e.source);
    if (!port) {
      const base = hint(e.source, e.port);
      port = base;
      for (let k = 2; taken.has(port); k++) port = `${base}${k}`;
      taken.add(port);
      portOf.set(e.source, port);
    }
    inputs.push({ port, node: e.target, nodePort: e.port });
  }

  const group: GNode = { id: groupId, kind: 'group', data: { label, nodes: members, edges: inner, inputs, output: sources[0] } };
  const seen = new Set<string>();
  return {
    graph: {
      nodes: [...graph.nodes.filter((n) => !inside.has(n.id)), group],
      edges: [
        ...graph.edges.filter((e) => !inside.has(e.source) && !inside.has(e.target)),
        // One wire per port, however many inner inputs it feeds.
        ...incoming.filter((e) => !seen.has(e.source) && seen.add(e.source)).map((e) => ({ source: e.source, target: groupId, port: portOf.get(e.source)! })),
        ...outgoing.map((e) => ({ source: groupId, target: e.target, port: e.port })),
      ],
    },
  };
}

/**
 * Put a group's blocks back in its place. `rename` gives a fresh id for an
 * inner block whose own id is already in use (a group that was duplicated).
 */
export function ungroupNode(graph: Graph, groupId: string, rename: (id: string) => string): { graph: Graph; ids: Record<string, string> } | null {
  const node = graph.nodes.find((n) => n.id === groupId);
  if (!node || node.kind !== 'group') return null;
  const g = node.data as GroupData;
  const used = new Set(graph.nodes.filter((n) => n.id !== groupId).map((n) => n.id));
  const ids: Record<string, string> = {};
  for (const n of g.nodes) {
    ids[n.id] = used.has(n.id) ? rename(n.id) : n.id;
    used.add(ids[n.id]);
  }
  return {
    ids,
    graph: {
      nodes: [...graph.nodes.filter((n) => n.id !== groupId), ...g.nodes.map((n) => ({ ...n, id: ids[n.id] }))],
      edges: [
        ...graph.edges.flatMap((e) => {
          if (e.source === groupId) return [{ ...e, source: ids[g.output] }];
          if (e.target === groupId) return g.inputs.filter((i) => i.port === e.port).map((i) => ({ source: e.source, target: ids[i.node], port: i.nodePort }));
          return [e];
        }),
        ...g.edges.map((e) => ({ source: ids[e.source], target: ids[e.target], port: e.port })),
      ],
    },
  };
}

export interface NodeResult {
  q?: Quantity;
  ex?: Ex;
  error?: string;
  /** True when the error originates upstream rather than in this node. */
  upstream?: boolean;
}

export interface EvalOptions {
  /** Override a quantity node's value (expressed in that node's own unit). */
  overrides?: Record<string, number>;
}

export function evaluate(original: Graph, opts: EvalOptions = {}): Map<string, NodeResult> {
  // Groups are evaluated as the blocks inside them; each then reports its output block's result.
  const { graph, outputs } = expandGroups(original);
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, GEdge>();
  for (const e of graph.edges) incoming.set(`${e.target}:${e.port}`, e);

  const results = new Map<string, NodeResult>();
  const visiting = new Set<string>();

  const input = (node: GNode, port: string): Val => {
    const edge = incoming.get(`${node.id}:${port}`);
    if (!edge) throw new Error(`Input "${port}" is not connected`);
    const r = visit(edge.source);
    if (!r.q || !r.ex) throw new UpstreamError();
    return { q: r.q, ex: r.ex };
  };

  const compute = (node: GNode): Val => {
    switch (node.kind) {
      case 'quantity': {
        const d = node.data as QuantityData;
        const value = opts.overrides?.[node.id] ?? d.value;
        if (!getUnit(d.unit)) throw new Error(`Unknown unit "${d.unit}"`);
        if (!Number.isFinite(value)) throw new Error('Enter a number');
        const q = fromUnit(value, d.unit);
        const name = (d.symbol || d.label).replace(/[^A-Za-z0-9_]+/g, '_');
        return {
          q,
          ex: sym(symbolToLatex(d.symbol || d.label), `${fmtNumLatex(value)}${unitLatex(d.unit)}`, name, q.v, siUnitFor(q.d)),
        };
      }
      case 'constant': {
        const c = getConstant((node.data as ConstantData).constId);
        if (!c) throw new Error('Unknown constant');
        if (c.id === 'pi' || c.id === 'euler') return { q: c.q, ex: sym(c.latex, fmtNumLatex(c.q.v), c.id === 'pi' ? 'pi' : 'e') };
        // The elementary charge is written q_e in text so it cannot be mistaken for Euler's number.
        return { q: c.q, ex: sym(c.latex, `${fmtNumLatex(c.q.v)}${unitLatex(c.unit)}`, c.id === 'e' ? 'q_e' : c.id, c.q.v, siUnitFor(c.q.d)) };
      }
      case 'op': {
        const op = getOp((node.data as OpData).op);
        if (!op) throw new Error('Unknown operation');
        const args = op.inputs.map((p) => input(node, p));
        return { q: op.apply(...args.map((a) => a.q)), ex: op.ex(...args.map((a) => a.ex)) };
      }
      case 'formula': {
        const d = node.data as FormulaData;
        if (!d.expr.trim()) throw new Error('Type a formula');
        const scope: Record<string, Val> = {};
        for (const p of formulaInputs(d.expr)) scope[p] = input(node, p);
        return evalFormula(d.expr, scope);
      }
      case 'output':
        return input(node, 'in');
      case 'group':
        // Unreachable: groups are expanded before evaluation.
        throw new Error('This group could not be opened');
    }
  };

  function visit(id: string): NodeResult {
    const done = results.get(id);
    if (done) return done;
    const node = nodes.get(id);
    let r: NodeResult;
    if (!node) r = { error: 'Missing node' };
    else if (visiting.has(id)) r = { error: 'This node is part of a loop' };
    else {
      visiting.add(id);
      try {
        const v = compute(node);
        r = Number.isNaN(v.q.v) ? { ...v, error: 'Result is not a real number' } : v;
      } catch (err) {
        r = err instanceof UpstreamError
          ? { error: 'Waiting on an upstream node', upstream: true }
          : { error: err instanceof Error ? err.message : String(err) };
      }
      visiting.delete(id);
    }
    results.set(id, r);
    return r;
  }

  for (const n of graph.nodes) visit(n.id);
  for (const [group, out] of outputs) {
    const r = results.get(out);
    if (!r) { results.set(group, { error: 'This group has no output block' }); continue; }
    if (!r.error) { results.set(group, r); continue; }
    // The blocks inside cannot be seen, so name the one that actually failed rather than "waiting".
    const culprit = graph.nodes.find((n) => n.id.startsWith(`${group}/`) && results.get(n.id)?.error && !results.get(n.id)!.upstream);
    results.set(group, culprit
      ? { error: `Inside the group, ${nodeLabel(culprit)}: ${results.get(culprit.id)!.error}` }
      : r);
  }
  return results;
}

class UpstreamError extends Error {}

/** Ids of all nodes that feed (directly or indirectly) into `targetId`. */
export function upstreamOf(graph: Graph, targetId: string): Set<string> {
  const seen = new Set<string>();
  const stack = [targetId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of graph.edges) {
      if (e.target === id && !seen.has(e.source)) {
        seen.add(e.source);
        stack.push(e.source);
      }
    }
  }
  return seen;
}

export interface SweepResult {
  x: number[];
  /** Output value at each x, in SI units (NaN where evaluation failed). */
  y: number[];
}

export function linspace(min: number, max: number, n: number, log = false): number[] {
  if (log && min > 0 && max > 0) {
    const a = Math.log10(min);
    const b = Math.log10(max);
    return Array.from({ length: n }, (_, i) => 10 ** (a + ((b - a) * i) / (n - 1)));
  }
  return Array.from({ length: n }, (_, i) => min + ((max - min) * i) / (n - 1));
}

/** Evaluate one output while sweeping a quantity node across a range. */
export function sweep(graph: Graph, outputId: string, inputId: string, xs: number[], fixed: Record<string, number> = {}): SweepResult {
  const y = xs.map((x) => {
    const r = evaluate(graph, { overrides: { ...fixed, [inputId]: x } }).get(outputId);
    return r?.q && !r.error ? r.q.v : NaN;
  });
  return { x: xs, y };
}

/** Evaluate one output over a 2-D grid of two quantity nodes. Returns rows indexed [iy][ix]. */
export function sweep2D(graph: Graph, outputId: string, xId: string, xs: number[], yId: string, ys: number[]): number[][] {
  return ys.map((yv) => sweep(graph, outputId, xId, xs, { [yId]: yv }).y);
}
