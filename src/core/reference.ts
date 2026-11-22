/**
 * What can be written in an equation: the functions, constants and operators
 * the solver understands, as data for the in-app reference and for
 * completing names while typing. Every entry carries an example with its
 * value, and the tests evaluate each one, so the reference cannot drift from
 * what the engine does.
 */

export type RefKind = 'function' | 'constant' | 'operator';

export interface RefEntry {
  name: string;
  kind: RefKind;
  /** How it is written. */
  usage: string;
  meaning: string;
  group: string;
  /** An expression using it, and what it evaluates to. */
  example: string;
  value: number;
}

const fn = (group: string, name: string, usage: string, meaning: string, example: string, value: number): RefEntry => ({ name, kind: 'function', usage, meaning, group, example, value });
const op = (name: string, usage: string, meaning: string, example: string, value: number): RefEntry => ({ name, kind: 'operator', usage, meaning, group: 'Operators', example, value });

export const REFERENCE: readonly RefEntry[] = [
  op('+', 'a + b', 'Sum', '2 + 3', 5),
  op('-', 'a - b', 'Difference; also the sign of a number, as in -x', '2 - 3', -1),
  op('*', 'a * b', 'Product. Always write the star: 2 * x, not 2x', '2 * 3', 6),
  op('/', 'a / b', 'Quotient', '3 / 4', 0.75),
  op('^', 'a ^ b', 'a raised to the power b. Binds tighter than a leading minus: -x^2 is -(x^2)', '2 ^ 10', 1024),
  op('%', 'a % b', 'Remainder after dividing a by b, with the sign of b', '7 % 3', 1),
  op('<', 'a < b', 'Comparisons give 1 when true and 0 when false: < > <= >= == !=', '(2 < 3) + (3 <= 3)', 2),
  op('and', 'a and b', 'True when both are true; also or, and not a', '(1 < 2) and (2 < 1)', 0),
  op('? :', 'c ? a : b', 'a when the condition c is true, otherwise b: a switch inside an equation', '3 > 2 ? 10 : 20', 10),

  fn('Powers and roots', 'sqrt', 'sqrt(x)', 'Square root', 'sqrt(16)', 4),
  fn('Powers and roots', 'cbrt', 'cbrt(x)', 'Cube root', 'cbrt(27)', 3),
  fn('Powers and roots', 'pow', 'pow(x, n)', 'x to the power n; the same as x ^ n', 'pow(2, 3)', 8),
  fn('Powers and roots', 'exp', 'exp(x)', 'e to the power x', 'exp(0)', 1),
  fn('Powers and roots', 'log', 'log(x)', 'Natural logarithm (there is no ln); log(x, b) is the logarithm to base b', 'log(e ^ 2)', 2),
  fn('Powers and roots', 'log10', 'log10(x)', 'Logarithm to base 10', 'log10(1000)', 3),
  fn('Powers and roots', 'log2', 'log2(x)', 'Logarithm to base 2', 'log2(8)', 3),

  fn('Trigonometry', 'sin', 'sin(x)', 'Sine of an angle in radians', 'sin(pi / 2)', 1),
  fn('Trigonometry', 'cos', 'cos(x)', 'Cosine of an angle in radians', 'cos(pi)', -1),
  fn('Trigonometry', 'tan', 'tan(x)', 'Tangent of an angle in radians', 'tan(pi / 4)', 1),
  fn('Trigonometry', 'asin', 'asin(x)', 'Inverse sine: an angle in radians between -pi/2 and pi/2', 'asin(1)', Math.PI / 2),
  fn('Trigonometry', 'acos', 'acos(x)', 'Inverse cosine: an angle in radians between 0 and pi', 'acos(1)', 0),
  fn('Trigonometry', 'atan', 'atan(x)', 'Inverse tangent: an angle in radians between -pi/2 and pi/2', 'atan(1)', Math.PI / 4),
  fn('Trigonometry', 'atan2', 'atan2(y, x)', 'Angle of the point (x, y) from the x axis, in the right quadrant', 'atan2(1, -1)', (3 * Math.PI) / 4),
  fn('Trigonometry', 'sinh', 'sinh(x)', 'Hyperbolic sine', 'sinh(0)', 0),
  fn('Trigonometry', 'cosh', 'cosh(x)', 'Hyperbolic cosine', 'cosh(0)', 1),
  fn('Trigonometry', 'tanh', 'tanh(x)', 'Hyperbolic tangent: a smooth step from -1 to 1', 'tanh(0)', 0),

  fn('Shaping', 'abs', 'abs(x)', 'Magnitude of x', 'abs(-3)', 3),
  fn('Shaping', 'sign', 'sign(x)', '-1, 0 or 1 according to the sign of x: the direction of friction, for instance', 'sign(-2.5)', -1),
  fn('Shaping', 'min', 'min(a, b, …)', 'Smallest of its arguments', 'min(3, 1, 2)', 1),
  fn('Shaping', 'max', 'max(a, b, …)', 'Largest of its arguments: max(x, 0) cuts a quantity off below zero', 'max(-4, 0)', 0),
  fn('Shaping', 'floor', 'floor(x)', 'Largest whole number not above x', 'floor(2.7)', 2),
  fn('Shaping', 'ceil', 'ceil(x)', 'Smallest whole number not below x', 'ceil(2.1)', 3),
  fn('Shaping', 'round', 'round(x)', 'Nearest whole number', 'round(2.5)', 3),
  fn('Shaping', 'mod', 'mod(a, b)', 'Remainder after dividing a by b: mod(t, T) repeats every T', 'mod(7.5, 2)', 1.5),

  { name: 'pi', kind: 'constant', usage: 'pi', meaning: 'π = 3.14159…', group: 'Constants', example: 'pi', value: Math.PI },
  { name: 'e', kind: 'constant', usage: 'e', meaning: 'Base of the natural logarithm, 2.71828…, unless the model defines its own e', group: 'Constants', example: 'e', value: Math.E },
  { name: 'tau', kind: 'constant', usage: 'tau', meaning: '2π: one full turn in radians', group: 'Constants', example: 'tau', value: 2 * Math.PI },
];

/** Entries whose name, usage or meaning contains every word of the query. */
export function searchReference(query: string, entries: readonly RefEntry[] = REFERENCE): RefEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((r) => {
    const hay = `${r.name} ${r.usage} ${r.meaning} ${r.group}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** A name the model defines, offered while typing. */
export interface ModelName { name: string; kind: 'state' | 'parameter' | 'observable' | 'time'; detail?: string }

export interface Completion {
  /** Text shown and matched against. */
  label: string;
  /** Text put in place of what was typed. */
  insert: string;
  detail: string;
}

export interface CompletionSet {
  /** The stretch of the text being completed. */
  from: number;
  to: number;
  options: Completion[];
}

/**
 * What could finish the name being typed at the caret: the model's own names
 * first, then functions and constants. Null when the caret is not at the end
 * of a name, or nothing fits.
 */
export function completions(text: string, caret: number, names: ModelName[], limit = 8): CompletionSet | null {
  // A name is being typed only if the caret sits at its end.
  if (/[A-Za-z0-9_]/.test(text[caret] ?? '')) return null;
  const typed = /[A-Za-z_][A-Za-z0-9_]*$/.exec(text.slice(0, caret))?.[0];
  if (!typed) return null;
  // Not after a digit: in 2e3 the e is part of the number.
  const start = caret - typed.length;
  if (/[0-9.]/.test(text[start - 1] ?? '')) return null;
  const lower = typed.toLowerCase();
  const fits = (name: string) => name.toLowerCase().startsWith(lower) && name !== typed;
  const own = names.filter((n) => fits(n.name)).map((n): Completion => ({ label: n.name, insert: n.name, detail: n.detail ?? n.kind }));
  const taken = new Set(names.map((n) => n.name));
  const built = REFERENCE.filter((r) => r.kind !== 'operator' && fits(r.name) && !taken.has(r.name))
    .map((r): Completion => ({ label: r.usage, insert: r.kind === 'function' ? `${r.name}(` : r.name, detail: r.meaning }));
  const options = [...own, ...built].slice(0, limit);
  return options.length ? { from: start, to: caret, options } : null;
}

/** The text with a completion put in, and where the caret should go. */
export function applyCompletion(text: string, set: CompletionSet, option: Completion): { text: string; caret: number } {
  const next = text.slice(0, set.from) + option.insert + text.slice(set.to);
  return { text: next, caret: set.from + option.insert.length };
}
