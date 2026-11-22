/**
 * Formula nodes: a typed-in expression such as `v^2 * sin(2*theta) / g`.
 * The text is parsed with mathjs, then evaluated by walking the syntax tree
 * over dimensional quantities so units are still checked.
 */
import { parse, type MathNode } from 'mathjs';
import { bin, fn, neg, num, sym, symbolToLatex, type Ex } from './expr';
import * as Q from './qmath';
import type { Quantity } from './units';

export interface Val {
  q: Quantity;
  ex: Ex;
}

const BUILTIN: Record<string, Val> = {
  pi: { q: Q.scalar(Math.PI), ex: sym('\\pi') },
  e: { q: Q.scalar(Math.E), ex: sym('\\mathrm{e}') },
};

const cache = new Map<string, MathNode>();
export function parseFormula(text: string): MathNode {
  let node = cache.get(text);
  if (!node) {
    node = parse(text);
    cache.set(text, node);
  }
  return node;
}

/** Free variables of a formula, in order of first appearance. */
export function formulaInputs(text: string): string[] {
  try {
    const names: string[] = [];
    parseFormula(text).traverse((node: MathNode, _path: string, parent: MathNode) => {
      const n = node as MathNode & { name?: string };
      if (n.type !== 'SymbolNode' || !n.name) return;
      const p = parent as (MathNode & { fn?: MathNode }) | null;
      if (p && p.type === 'FunctionNode' && p.fn === node) return;
      if (n.name in BUILTIN) return;
      if (!names.includes(n.name)) names.push(n.name);
    });
    return names;
  } catch {
    return [];
  }
}

const OPS: Record<string, (a: Quantity, b: Quantity) => Quantity> = {
  '+': Q.add, '-': Q.sub, '*': Q.mul, '/': Q.div, '^': Q.pow,
};

export function evalFormula(text: string, scope: Record<string, Val>): Val {
  const walk = (node: MathNode): Val => {
    const n = node as any;
    switch (n.type) {
      case 'ConstantNode':
        if (typeof n.value !== 'number') throw new Error('Only numeric constants are supported');
        return { q: Q.scalar(n.value), ex: num(n.value) };
      case 'SymbolNode': {
        const v = scope[n.name] ?? BUILTIN[n.name];
        if (!v) throw new Error(`Unknown symbol "${n.name}"`);
        return v;
      }
      case 'ParenthesisNode':
        return walk(n.content);
      case 'OperatorNode': {
        if (n.args.length === 1) {
          const a = walk(n.args[0]);
          if (n.op === '-') return { q: Q.negate(a.q), ex: neg(a.ex) };
          if (n.op === '+') return a;
          throw new Error(`Unsupported operator "${n.op}"`);
        }
        const f = OPS[n.op];
        if (!f || n.args.length !== 2) throw new Error(`Unsupported operator "${n.op}"`);
        const a = walk(n.args[0]);
        const b = walk(n.args[1]);
        return { q: f(a.q, b.q), ex: bin(n.op, a.ex, b.ex) };
      }
      case 'FunctionNode': {
        const name: string = n.fn?.name ?? String(n.fn);
        const f = Q.FUNCTIONS[name];
        if (!f) throw new Error(`Unknown function "${name}"`);
        const args: Val[] = n.args.map(walk);
        if (args.length !== f.length && !(f.length === 0)) {
          if (args.length < f.length) throw new Error(`${name}() needs ${f.length} argument(s)`);
        }
        return { q: f(...args.map((a) => a.q)), ex: fn(name, ...args.map((a) => a.ex)) };
      }
      default:
        throw new Error(`Unsupported syntax (${n.type})`);
    }
  };
  return walk(parseFormula(text));
}

export { symbolToLatex };
