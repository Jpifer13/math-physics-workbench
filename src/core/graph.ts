/**
 * The flow-graph engine: a framework-free model of nodes and wires plus an
 * evaluator that produces, for every node, a dimensional value and a symbolic
 * expression. The React Flow canvas is just one view of this.
 */
import { bin, fn, neg, num, sym, symbolToLatex, type Ex } from './expr';
import { evalFormula, formulaInputs, type Val } from './formula';
import * as Q from './qmath';
import { fmtNumLatex, fromUnit, getConstant, getUnit, siUnitFor, unitLatex, type Quantity } from './units';

export type NodeKind = 'quantity' | 'constant' | 'op' | 'formula' | 'output';

export interface QuantityData { label: string; symbol: string; value: number; unit: string; min?: number; max?: number }
export interface ConstantData { constId: string }
export interface OpData { op: string }
export interface FormulaData { label: string; expr: string }
export interface OutputData { label: string; symbol: string; unit: string }

export interface GNode {
  id: string;
  kind: NodeKind;
  data: QuantityData | ConstantData | OpData | FormulaData | OutputData;
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
    default:
      return [];
  }
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

export function evaluate(graph: Graph, opts: EvalOptions = {}): Map<string, NodeResult> {
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
