/** Arithmetic on dimensional quantities, with physically meaningful errors. */
import { DIMLESS, dimDiv, dimEq, dimMul, dimName, dimPow, isDimless, type Quantity } from './units';

export class DimensionError extends Error {}

const q = (v: number, d = DIMLESS): Quantity => ({ v, d });
export const scalar = (v: number): Quantity => q(v);

function sameDim(a: Quantity, b: Quantity, verb: string) {
  if (!dimEq(a.d, b.d)) {
    throw new DimensionError(`Cannot ${verb} ${dimName(a.d)} and ${dimName(b.d)} — the units don't match`);
  }
}
function needDimless(a: Quantity, what: string) {
  if (!isDimless(a.d)) throw new DimensionError(`${what} must be dimensionless, got ${dimName(a.d)}`);
}

export const add = (a: Quantity, b: Quantity): Quantity => (sameDim(a, b, 'add'), q(a.v + b.v, a.d));
export const sub = (a: Quantity, b: Quantity): Quantity => (sameDim(a, b, 'subtract'), q(a.v - b.v, a.d));
export const mul = (a: Quantity, b: Quantity): Quantity => q(a.v * b.v, dimMul(a.d, b.d));
export const div = (a: Quantity, b: Quantity): Quantity => q(a.v / b.v, dimDiv(a.d, b.d));
export const negate = (a: Quantity): Quantity => q(-a.v, a.d);
export function pow(a: Quantity, b: Quantity): Quantity {
  needDimless(b, 'An exponent');
  return q(Math.pow(a.v, b.v), dimPow(a.d, b.v));
}

type Fn = (...args: Quantity[]) => Quantity;
const pure = (name: string, f: (x: number) => number): Fn => (a) => {
  needDimless(a, `The argument of ${name}()`);
  return q(f(a.v));
};

/** Functions available both as operator nodes and inside formula nodes. */
export const FUNCTIONS: Record<string, Fn> = {
  sqrt: (a) => q(Math.sqrt(a.v), dimPow(a.d, 0.5)),
  cbrt: (a) => q(Math.cbrt(a.v), dimPow(a.d, 1 / 3)),
  abs: (a) => q(Math.abs(a.v), a.d),
  sin: pure('sin', Math.sin),
  cos: pure('cos', Math.cos),
  tan: pure('tan', Math.tan),
  asin: pure('asin', Math.asin),
  acos: pure('acos', Math.acos),
  atan: pure('atan', Math.atan),
  sinh: pure('sinh', Math.sinh),
  cosh: pure('cosh', Math.cosh),
  tanh: pure('tanh', Math.tanh),
  exp: pure('exp', Math.exp),
  ln: pure('ln', Math.log),
  log: pure('log', Math.log),
  log10: pure('log10', Math.log10),
  atan2: (a, b) => (sameDim(a, b, 'compare'), q(Math.atan2(a.v, b.v))),
  min: (a, b) => (sameDim(a, b, 'compare'), q(Math.min(a.v, b.v), a.d)),
  max: (a, b) => (sameDim(a, b, 'compare'), q(Math.max(a.v, b.v), a.d)),
};
