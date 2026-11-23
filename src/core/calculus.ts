/**
 * Calculus blocks of a flow: an integral, a sum, a product, a derivative or a
 * limit of an expression in one variable. The variable is the block's own;
 * every other name in the expression is an input port, and so are the limits
 * or the point. Values carry their units throughout: integrating a force over
 * a distance gives an energy.
 */
import { symbolToLatex, type Ex } from './expr';
import { evalFormula, formulaInputs, type Val } from './formula';
import * as Q from './qmath';
import type { Quantity } from './units';

export type CalculusOp = 'integral' | 'sum' | 'product' | 'derivative' | 'limit';
export interface CalculusData { label: string; op: CalculusOp; expr: string; variable: string }

export interface CalculusDef {
  label: string;
  glyph: string;
  /** The block's own input ports, before those of the names in its expression. */
  ports: string[];
  hint: string;
  /** A starting point when the block is dropped on the canvas. */
  example: { expr: string; variable: string };
}

export const CALCULUS: Record<CalculusOp, CalculusDef> = {
  integral: { label: 'Integral', glyph: '∫', ports: ['from', 'to'], hint: 'The integral of an expression between two limits. Units multiply: force over distance gives energy.', example: { expr: 'x^2', variable: 'x' } },
  sum: { label: 'Sum', glyph: 'Σ', ports: ['from', 'to'], hint: 'Adds an expression up as a counter runs between two whole numbers.', example: { expr: '1 / n^2', variable: 'n' } },
  product: { label: 'Product', glyph: 'Π', ports: ['from', 'to'], hint: 'Multiplies an expression together as a counter runs between two whole numbers.', example: { expr: 'n', variable: 'n' } },
  derivative: { label: 'Derivative', glyph: 'd/dx', ports: ['at'], hint: 'The rate of change of an expression at a point. Units divide: distance by time gives speed.', example: { expr: 'x^3', variable: 'x' } },
  limit: { label: 'Limit', glyph: 'lim', ports: ['at'], hint: 'The value an expression approaches near a point, even where it cannot be worked out at the point itself.', example: { expr: 'sin(x) / x', variable: 'x' } },
};

/** Input ports of a calculus block: its own, then one for each other name in its expression. */
export function calculusPorts(d: CalculusData): string[] {
  const own = CALCULUS[d.op]?.ports ?? [];
  return [...own, ...formulaInputs(d.expr).filter((n) => n !== d.variable.trim() && !own.includes(n))];
}

const SIMPSON_STEPS = 400;
const MOST_TERMS = 100000;

const number = (v: number): string => String(parseFloat(v.toPrecision(6)));

export function evalCalculus(d: CalculusData, input: (port: string) => Val): Val {
  const def = CALCULUS[d.op];
  if (!def) throw new Error('Unknown kind of calculus block');
  const v = d.variable.trim();
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(v)) throw new Error('Name the variable, such as x or n');
  if (!d.expr.trim()) throw new Error('Type the expression');
  const free = formulaInputs(d.expr).filter((n) => n !== v);
  const clash = free.find((n) => def.ports.includes(n));
  if (clash) throw new Error(`"${clash}" is the name of one of this block's own inputs. Use another name in the expression`);

  const scope: Record<string, Val> = {};
  for (const n of free) scope[n] = input(n);
  const bound: Ex = { t: 'sym', latex: symbolToLatex(v), name: v };
  /** The expression with the variable at x, which has the units of `like`. */
  const at = (x: number, like: Quantity): Val => evalFormula(d.expr, { ...scope, [v]: { q: { v: x, d: like.d }, ex: bound } });
  const big = (body: Ex, rest: { lo?: Ex; hi?: Ex; at?: Ex }): Ex => ({ t: 'big', op: d.op, body, latex: symbolToLatex(v), name: v, ...rest });

  if (d.op === 'integral') {
    const a = input('from');
    const b = input('to');
    let width: Quantity;
    try { width = Q.sub(b.q, a.q); } catch { throw new Error('The two limits must have the same units'); }
    if (!Number.isFinite(a.q.v) || !Number.isFinite(b.q.v)) throw new Error('The limits must be finite numbers');
    const first = at(a.q.v, a.q);
    const h = width.v / SIMPSON_STEPS;
    let s = 0;
    for (let i = 0; i <= SIMPSON_STEPS; i++) {
      const y = i === 0 ? first.q.v : at(a.q.v + i * h, a.q).q.v;
      if (!Number.isFinite(y)) throw new Error(`The expression has no finite value at ${v} = ${number(a.q.v + i * h)}, between the limits`);
      s += y * (i === 0 || i === SIMPSON_STEPS ? 1 : i % 2 ? 4 : 2);
    }
    return { q: { v: (s * h) / 3, d: Q.mul(first.q, width).d }, ex: big(first.ex, { lo: a.ex, hi: b.ex }) };
  }

  if (d.op === 'sum' || d.op === 'product') {
    const a = input('from');
    const b = input('to');
    const what = d.op;
    const whole = (x: Val, end: string): number => {
      try { Q.add(x.q, Q.scalar(0)); } catch { throw new Error(`The ${what} ${end} at a plain number, without units`); }
      if (!Number.isFinite(x.q.v) || Math.abs(x.q.v - Math.round(x.q.v)) > 1e-9) throw new Error(`The ${what} ${end} at a whole number`);
      return Math.round(x.q.v);
    };
    const lo = whole(a, 'starts');
    const hi = whole(b, 'ends');
    if (hi < lo) throw new Error(`The ${what} ends before it starts`);
    if (hi - lo + 1 > MOST_TERMS) throw new Error(`The ${what} has more than ${MOST_TERMS.toLocaleString('en')} terms`);
    const first = at(lo, a.q);
    let total = first.q;
    for (let n = lo + 1; n <= hi; n++) {
      const term = at(n, a.q).q;
      total = d.op === 'sum' ? Q.add(total, term) : Q.mul(total, term);
    }
    return { q: total, ex: big(first.ex, { lo: a.ex, hi: b.ex }) };
  }

  const x = input('at');
  if (!Number.isFinite(x.q.v)) throw new Error('The point must be a finite number');
  const here = at(x.q.v, x.q);
  const scale = Math.abs(x.q.v) || 1;
  const f = (t: number): number => at(t, x.q).q.v;

  if (d.op === 'derivative') {
    const h = 1e-3 * scale;
    // Five-point stencil: accurate to the fourth power of the step.
    const slope = (-f(x.q.v + 2 * h) + 8 * f(x.q.v + h) - 8 * f(x.q.v - h) + f(x.q.v - 2 * h)) / (12 * h);
    if (!Number.isFinite(slope)) throw new Error(`The expression has no finite slope at ${v} = ${number(x.q.v)}`);
    return { q: { v: slope, d: Q.div(here.q, x.q).d }, ex: big(here.ex, { at: x.ex }) };
  }

  // A limit: where the expression has a value and is continuous, that value. Otherwise what it settles on from each side.
  const side = (sign: 1 | -1): number | null | 'unsettled' => {
    // Three steps towards the point, each a tenth of the last. Approaching a limit, the change between
    // steps shrinks; the pattern of shrinking says where the values are heading.
    const [far, mid, near] = [1e-2, 1e-3, 1e-4].map((h) => f(x.q.v + sign * h * scale));
    if ([far, mid, near].every(Number.isNaN)) return null;
    if (![far, mid, near].every(Number.isFinite)) return 'unsettled';
    const first = mid - far;
    const second = near - mid;
    if (Math.abs(second) <= 1e-7 * Math.max(1, Math.abs(near))) return near;
    if (Math.abs(second) > 0.5 * Math.abs(first)) return 'unsettled';
    return near - (second * second) / (second - first);
  };
  const below = side(-1);
  const above = side(1);
  const ex = big(here.ex, { at: x.ex });
  const result = (value: number): Val => ({ q: { v: value, d: here.q.d }, ex });
  if (below === 'unsettled' || above === 'unsettled') {
    throw new Error(`The expression does not settle on a value as ${v} approaches ${number(x.q.v)}: it may grow without bound, or approach its limit too slowly to tell`);
  }
  if (below === null && above === null) throw new Error(`The expression has no value near ${v} = ${number(x.q.v)}`);
  if (below !== null && above !== null && Math.abs(below - above) > 1e-4 * Math.max(1, Math.abs(below), Math.abs(above))) {
    throw new Error(`The expression approaches ${number(below)} from below and ${number(above)} from above, so it has no single limit`);
  }
  const estimate = below === null ? above! : above === null ? below : (below + above) / 2;
  // Where the expression is continuous, its own value is the limit, exactly.
  if (Number.isFinite(here.q.v) && Math.abs(here.q.v - estimate) <= 1e-4 * Math.max(1, Math.abs(estimate))) return result(here.q.v);
  // Otherwise round off the error of stopping a short way from the point.
  return result(parseFloat(estimate.toPrecision(7)));
}
