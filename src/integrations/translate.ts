/**
 * Translating model expressions into other languages.
 *
 * Expressions are never copied into generated code as text. Each one is parsed
 * and re-emitted node by node from a fixed set of operators and functions, and
 * every identifier must be a name the model defines. That is what makes it
 * safe to run a generated script from a model file someone else sent you: a
 * model cannot smuggle arbitrary code into the script.
 */
import { parse, type MathNode } from 'mathjs';

export class ExportError extends Error {}

export type BinaryOp = '+' | '-' | '*' | '/' | '^' | '<' | '>' | '<=' | '>=' | '==' | '!=' | 'and' | 'or' | 'mod';

export interface Dialect {
  number(v: number): string;
  constant(name: 'pi' | 'e'): string;
  negate(a: string): string;
  not(a: string): string;
  binary(op: BinaryOp, a: string, b: string): string;
  /** Translate a call to one of the supported functions; `null` if this dialect cannot express it. */
  call(name: string, args: string[]): string | null;
  conditional(c: string, a: string, b: string): string;
}

export const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'exp', 'log', 'ln', 'log10', 'log2',
  'sqrt', 'cbrt', 'abs', 'sign', 'floor', 'ceil', 'round', 'min', 'max', 'pow', 'mod',
]);
const ARITY: Record<string, [number, number]> = {
  atan2: [2, 2], pow: [2, 2], mod: [2, 2], log: [1, 2], min: [1, 8], max: [1, 8],
};
const OPS: Record<string, BinaryOp> = {
  '+': '+', '-': '-', '*': '*', '/': '/', '^': '^', '<': '<', '>': '>', '<=': '<=', '>=': '>=', '==': '==', '!=': '!=',
  and: 'and', or: 'or', mod: 'mod', '%': 'mod',
};

/**
 * @param symbol maps a model name to its spelling in the target code, or returns undefined for unknown names.
 */
export function translate(expr: string, d: Dialect, symbol: (name: string) => string | undefined): string {
  const walk = (node: MathNode): string => {
    const n = node as any;
    switch (n.type) {
      case 'ConstantNode':
        if (typeof n.value !== 'number' || !Number.isFinite(n.value)) throw new ExportError(`"${expr}" contains a constant that cannot be exported`);
        return d.number(n.value);
      case 'SymbolNode': {
        const s = symbol(n.name);
        if (s !== undefined) return s;
        if (n.name === 'pi' || n.name === 'e') return d.constant(n.name);
        throw new ExportError(`"${expr}" uses "${n.name}", which the model does not define`);
      }
      case 'ParenthesisNode':
        return walk(n.content);
      case 'OperatorNode': {
        if (n.args.length === 1) {
          const a = walk(n.args[0]);
          if (n.op === '-') return d.negate(a);
          if (n.op === '+') return a;
          if (n.op === 'not') return d.not(a);
        } else if (n.args.length === 2 && OPS[n.op]) {
          return d.binary(OPS[n.op], walk(n.args[0]), walk(n.args[1]));
        }
        throw new ExportError(`"${expr}" uses the operator "${n.op}", which cannot be exported`);
      }
      case 'FunctionNode': {
        const name: string = n.fn?.name ?? '';
        if (!FUNCTIONS.has(name)) throw new ExportError(`"${expr}" uses the function "${name || '?'}", which cannot be exported`);
        const [lo, hi] = ARITY[name] ?? [1, 1];
        if (n.args.length < lo || n.args.length > hi) throw new ExportError(`"${expr}": ${name}() takes ${lo === hi ? lo : `${lo} to ${hi}`} argument(s)`);
        const out = d.call(name, n.args.map(walk));
        if (out === null) throw new ExportError(`"${expr}" uses ${name}(), which this target does not support`);
        return out;
      }
      case 'ConditionalNode':
        return d.conditional(walk(n.condition), walk(n.trueExpr), walk(n.falseExpr));
      default:
        throw new ExportError(`"${expr}" uses syntax that cannot be exported`);
    }
  };
  let tree: MathNode;
  try {
    tree = parse(expr);
  } catch (err) {
    throw new ExportError(`"${expr}" could not be parsed: ${err instanceof Error ? err.message : err}`);
  }
  return walk(tree);
}

/** Split an event's reset text into (state, expression) assignments. */
export function parseResets(text: string, states: string[]): { state: string; expr: string }[] {
  return text.split(/[;\n]/).map((a) => a.trim()).filter(Boolean).map((a) => {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)\s*(.+)$/.exec(a);
    if (!m || !states.includes(m[1])) throw new ExportError(`Event reset "${a}" is not an assignment to a state variable`);
    return { state: m[1], expr: m[2] };
  });
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Give every model name a spelling that is legal and unreserved in the target language. */
export function nameTable(names: string[], reserved: Set<string>, rename: (name: string) => string = (n) => `${n}_`): (name: string) => string {
  const table = new Map<string, string>();
  const used = new Set<string>();
  for (const name of names) {
    if (!IDENT.test(name)) throw new ExportError(`"${name}" is not a valid name`);
    let out = reserved.has(name) ? rename(name) : name;
    while (used.has(out) || reserved.has(out)) out = `${out}_`;
    used.add(out);
    table.set(name, out);
  }
  return (name) => table.get(name)!;
}

/** A number written so that every target reads it back as the same double. */
export const numberLiteral = (v: number): string => {
  const s = String(v);
  return /[.eE]/.test(s) ? s : `${s}.0`;
};
