/**
 * Fast evaluation of model expressions. mathjs parses the text; this turns the
 * syntax tree into plain JavaScript closures over a flat array of numbers,
 * which is several times quicker than mathjs's generic evaluator in the
 * integrator's inner loop. (No `eval`/`new Function`: the app runs under a
 * strict Content-Security-Policy.)
 *
 * Anything outside the supported numeric subset returns null and the caller
 * falls back to mathjs, so behaviour is never narrower than before.
 */
import { parse as mathParse, type MathNode } from 'mathjs';

const parsed = new Map<string, MathNode>();
function parse(expr: string): MathNode {
  let node = parsed.get(expr);
  if (!node) {
    if (parsed.size > 500) parsed.clear();
    node = mathParse(expr);
    parsed.set(expr, node);
  }
  return node;
}

export type Fast = (v: ArrayLike<number>) => number;

const FN1: Record<string, (x: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, log10: Math.log10, log2: Math.log2,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, sign: Math.sign, floor: Math.floor, ceil: Math.ceil,
  round: Math.round, ln: Math.log,
};
const FN2: Record<string, (a: number, b: number) => number> = {
  atan2: Math.atan2, pow: Math.pow, mod: (a, b) => a - b * Math.floor(a / b),
};
const BIN: Record<string, (a: number, b: number) => number> = {
  '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b, '^': Math.pow,
  '<': (a, b) => +(a < b), '>': (a, b) => +(a > b), '<=': (a, b) => +(a <= b), '>=': (a, b) => +(a >= b),
  '==': (a, b) => +(a === b), '!=': (a, b) => +(a !== b),
  and: (a, b) => +(a !== 0 && b !== 0), or: (a, b) => +(a !== 0 || b !== 0),
  mod: FN2.mod, '%': FN2.mod,
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI, Infinity, NaN };

/** Compile `expr` against a table mapping variable names to array slots, or null if unsupported. */
export function compileFast(expr: string, slot: Record<string, number>): Fast | null {
  const build = (node: MathNode): Fast | null => {
    const n = node as any;
    switch (n.type) {
      case 'ConstantNode': {
        if (typeof n.value !== 'number') return null;
        const c: number = n.value;
        return () => c;
      }
      case 'SymbolNode': {
        if (Object.prototype.hasOwnProperty.call(slot, n.name)) {
          const i = slot[n.name];
          return (v) => v[i];
        }
        if (Object.prototype.hasOwnProperty.call(CONSTANTS, n.name)) {
          const c = CONSTANTS[n.name];
          return () => c;
        }
        return null;
      }
      case 'ParenthesisNode':
        return build(n.content);
      case 'OperatorNode': {
        if (n.args.length === 1) {
          const a = build(n.args[0]);
          if (!a) return null;
          if (n.op === '-') return (v) => -a(v);
          if (n.op === '+') return a;
          if (n.op === 'not') return (v) => +(a(v) === 0);
          return null;
        }
        // mathjs parses a + b + c as a nested binary tree, so two arguments is the only other case.
        const f = BIN[n.op];
        if (!f || n.args.length !== 2) return null;
        const a = build(n.args[0]);
        const b = build(n.args[1]);
        if (!a || !b) return null;
        // Inline the hot operators rather than paying for an extra call.
        if (n.op === '+') return (v) => a(v) + b(v);
        if (n.op === '-') return (v) => a(v) - b(v);
        if (n.op === '*') return (v) => a(v) * b(v);
        if (n.op === '/') return (v) => a(v) / b(v);
        return (v) => f(a(v), b(v));
      }
      case 'FunctionNode': {
        const name: string | undefined = n.fn?.name;
        if (!name || Object.prototype.hasOwnProperty.call(slot, name)) return null;
        const args: (Fast | null)[] = n.args.map(build);
        if (args.some((a) => !a)) return null;
        const [a, b] = args as Fast[];
        if (FN1[name] && args.length === 1) { const f = FN1[name]; return (v) => f(a(v)); }
        if (FN2[name] && args.length === 2) { const f = FN2[name]; return (v) => f(a(v), b(v)); }
        if (name === 'log' && args.length === 1) return (v) => Math.log(a(v));
        if (name === 'log' && args.length === 2) return (v) => Math.log(a(v)) / Math.log(b(v));
        if ((name === 'min' || name === 'max') && args.length >= 1) {
          const f = name === 'min' ? Math.min : Math.max;
          const list = args as Fast[];
          return (v) => { let r = list[0](v); for (let i = 1; i < list.length; i++) r = f(r, list[i](v)); return r; };
        }
        return null;
      }
      case 'ConditionalNode': {
        const c = build(n.condition), t = build(n.trueExpr), f = build(n.falseExpr);
        if (!c || !t || !f) return null;
        return (v) => (c(v) !== 0 ? t(v) : f(v));
      }
      default:
        return null;
    }
  };
  try {
    return build(parse(expr));
  } catch {
    return null;
  }
}
