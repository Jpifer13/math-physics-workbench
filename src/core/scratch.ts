/**
 * The scratchpad's notebook: lines of mathematics, read top to bottom, each
 * worked out as far as it can be.
 *
 *   g = 9.81            defines g
 *   F = m g             defines F once m has a value (order does not matter)
 *   \frac{F}{2} =       asks for a number
 *   x^2 + 1 = 10        one unknown, so it is solved
 *   f(x) = x^2          defines a function
 *   m \ddot{x} = -k x   a differential equation: becomes a simulation
 *   x(0) = 1            a starting value for that simulation
 */
import { derivative as symDerivative, parse as mathParse, simplify, type MathNode as MjNode } from 'mathjs';
import { symbolToLatex } from './expr';
import {
  MathReadError, calledFunctions, derivName, freeSymbols, mapNode, parseLatex, splitDerivName, toMathText, walk,
  type MathNode, type ParsedLine,
} from './latexMath';
import { derivative, findRoots, integrate } from './numeric';
import type { OdeModel, Param, StateVar } from './ode';
import { fmtNumLatex } from './units';

export interface LineResult {
  kind: 'value' | 'defined' | 'function' | 'solved' | 'check' | 'symbolic' | 'equation' | 'initial' | 'waiting' | 'error';
  /** The answer, typeset, to show beside the line — e.g. "= 12.5". */
  tex?: string;
  /** A short note or, for 'waiting' and 'error', what is wrong and what to do. */
  message?: string;
  value?: number;
}

export interface Notebook {
  lines: LineResult[];
  /** A simulation built from the differential equations on the page, if there are any and they are complete. */
  model: OdeModel | null;
  /** Why there is no model, or what was assumed in building it. */
  modelNotes: string[];
}

interface FnDef { param: string; body: MathNode }
type Fn = (x: number) => number;

/** Thrown when a number is wanted and a variable has none. */
class Unknown extends Error {
  constructor(readonly names: string[]) { super(names.join(', ')); }
}

const BUILT_IN: Record<string, number> = { pi: Math.PI, e: Math.E, Infinity };

function factorial(x: number): number {
  if (!Number.isInteger(x) || x < 0) return NaN;
  if (x > 170) return Infinity;
  let f = 1;
  for (let i = 2; i <= x; i++) f *= i;
  return f;
}

const CALL: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, sec: (x) => 1 / Math.cos(x), csc: (x) => 1 / Math.sin(x), cot: (x) => 1 / Math.tan(x),
  asin: Math.asin, acos: Math.acos, atan: Math.atan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
  exp: Math.exp, sqrt: Math.sqrt, abs: Math.abs, log10: Math.log10,
  log: (x, base) => (base === undefined ? Math.log(x) : Math.log(x) / Math.log(base)),
  nthRoot: (x, n) => (x < 0 && Number.isInteger(n) && n % 2 !== 0 ? -Math.pow(-x, 1 / n) : Math.pow(x, 1 / n)),
};

/** An integral whose limits may be infinite, mapped onto a finite interval. */
function integral(f: Fn, lo: number, hi: number): number {
  if (lo > hi) return -integral(f, hi, lo);
  if (Number.isFinite(lo) && Number.isFinite(hi)) return integrate(f, lo, hi);
  // Midpoint rule, which never samples the ends where the mapping blows up.
  const n = 20000;
  let s = 0;
  if (!Number.isFinite(lo) && !Number.isFinite(hi)) {
    for (let i = 0; i < n; i++) {
      const u = -1 + ((i + 0.5) * 2) / n;
      const w = 1 - u * u;
      const v = f(u / w) * ((1 + u * u) / (w * w));
      if (Number.isFinite(v)) s += v;
    }
    return (s * 2) / n;
  }
  const sign = Number.isFinite(lo) ? 1 : -1;
  const a = Number.isFinite(lo) ? lo : hi;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const v = f(a + (sign * u) / (1 - u)) / ((1 - u) * (1 - u));
    if (Number.isFinite(v)) s += v;
  }
  return s / n;
}

interface Scope {
  value(name: string): number | undefined;
  fn(name: string): Fn | undefined;
}

/** Work a tree out to a number. */
function evalNode(n: MathNode, scope: Scope, local: Record<string, number> = {}): number {
  const go = (x: MathNode): number => evalNode(x, scope, local);
  switch (n.k) {
    case 'num': return parseFloat(n.v);
    case 'sym': {
      if (n.name in local) return local[n.name];
      const v = scope.value(n.name);
      if (v !== undefined) return v;
      if (n.name in BUILT_IN) return BUILT_IN[n.name];
      throw new Unknown([n.name]);
    }
    case 'neg': return -go(n.a);
    case 'fact': return factorial(go(n.a));
    case 'bin': {
      const a = go(n.a);
      const b = go(n.b);
      return n.op === '+' ? a + b : n.op === '-' ? a - b : n.op === '*' ? a * b : n.op === '/' ? a / b : Math.pow(a, b);
    }
    case 'call': {
      const user = scope.fn(n.fn);
      if (user) return user(go(n.args[0]));
      const f = CALL[n.fn];
      if (!f) throw new MathReadError(`“${n.fn}” is not a function this scratchpad knows.`);
      return f(...n.args.map(go));
    }
    case 'big': {
      const lo = go(n.lo);
      const hi = go(n.hi);
      const f: Fn = (x) => evalNode(n.body, scope, { ...local, [n.bound]: x });
      if (n.op === 'integral') return integral(f, lo, hi);
      const what = n.op === 'sum' ? 'sum' : 'product';
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new MathReadError(`Infinite ${what}s are not supported — give the ${what} an end.`);
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) throw new MathReadError(`A ${what} runs between whole numbers — this one runs from ${lo} to ${hi}.`);
      if (hi - lo > 2e6) throw new MathReadError(`That ${what} has too many terms to work out.`);
      let acc = n.op === 'sum' ? 0 : 1;
      for (let i = lo; i <= hi; i++) acc = n.op === 'sum' ? acc + f(i) : acc * f(i);
      return acc;
    }
    case 'diff': {
      const at = evalNode({ k: 'sym', name: n.bound }, scope, local);
      // Exact where the derivative can be taken symbolically; otherwise by finite differences.
      const exact = symbolicDerivative(n, scope);
      if (exact) {
        try {
          return evalNode(exact, scope, local);
        } catch {
          /* fall through */
        }
      }
      return derivative((x) => evalNode(n.body, scope, { ...local, [n.bound]: x }), at);
    }
  }
}

/** Replace calls to the notebook's own functions by their definitions. */
function inline(n: MathNode, fns: ReadonlyMap<string, FnDef>, depth = 0): MathNode {
  if (depth > 20) throw new MathReadError('A function is defined in terms of itself.');
  return mapNode(n, (x) => {
    if (x.k !== 'call') return undefined;
    const def = fns.get(x.fn);
    if (!def) return undefined;
    const arg = inline(x.args[0], fns, depth + 1);
    return inline(mapNode(def.body, (y) => (y.k === 'sym' && y.name === def.param ? arg : undefined)), fns, depth + 1);
  });
}

// --- between this module's trees and mathjs's, for symbolic work ---------------------------------------------------

const MJ_FN = new Set([...Object.keys(CALL)]);

/** Convert a mathjs tree back, accepting only what this module could have written. */
function fromMathjs(node: MjNode): MathNode {
  const n = node as unknown as { type: string; value?: unknown; name?: string; op?: string; fn?: unknown; args?: MjNode[]; content?: MjNode };
  switch (n.type) {
    case 'ConstantNode':
      if (typeof n.value !== 'number') break;
      return n.value < 0 ? { k: 'neg', a: { k: 'num', v: String(-n.value) } } : { k: 'num', v: String(n.value) };
    case 'SymbolNode': return { k: 'sym', name: n.name! };
    case 'ParenthesisNode': return fromMathjs(n.content!);
    case 'OperatorNode': {
      const args = n.args!.map(fromMathjs);
      if (args.length === 1 && n.op === '-') return { k: 'neg', a: args[0] };
      if (args.length === 1 && n.op === '+') return args[0];
      if (args.length === 1 && n.op === '!') return { k: 'fact', a: args[0] };
      if (n.op === '+' || n.op === '-' || n.op === '*' || n.op === '/' || n.op === '^') {
        const op = n.op;
        return args.slice(1).reduce<MathNode>((a, b) => ({ k: 'bin', op, a, b }), args[0]);
      }
      break;
    }
    case 'FunctionNode': {
      const name = (n.fn as { name?: string })?.name;
      if (name && MJ_FN.has(name)) return { k: 'call', fn: name, args: n.args!.map(fromMathjs) };
      break;
    }
    default: break;
  }
  throw new MathReadError('This could not be simplified.');
}

/** d(body)/d(bound) as a tree, or null where it cannot be done symbolically. */
function symbolicDerivative(n: Extract<MathNode, { k: 'diff' }>, scope: Scope): MathNode | null {
  try {
    let hasOther = false;
    walk(n.body, (x) => { if (x.k === 'big' || x.k === 'diff' || (x.k === 'call' && (scope.fn(x.fn) || !MJ_FN.has(x.fn)))) hasOther = true; });
    if (hasOther) return null;
    return fromMathjs(symDerivative(mathParse(toMathText(n.body)), n.bound));
  } catch {
    return null;
  }
}

const ACCENT_TEX: Record<string, string> = { bar: 'bar', hat: 'hat', tilde: 'tilde' };

/** How a variable's name is typeset: x_dot is ẋ, omega_0 is ω₀. */
export function nameTex(name: string): string {
  const { base, order } = splitDerivName(name);
  if (order === 1) return `\\dot{${nameTex(base)}}`;
  if (order === 2) return `\\ddot{${nameTex(base)}}`;
  if (order > 2) return `${nameTex(base)}^{(${order})}`;
  const accent = /^(.+)_(bar|hat|tilde)$/.exec(name);
  if (accent) return `\\${ACCENT_TEX[accent[2]]}{${nameTex(accent[1])}}`;
  return symbolToLatex(name);
}

const TEX_FN: Record<string, string> = {
  sin: '\\sin', cos: '\\cos', tan: '\\tan', sec: '\\sec', csc: '\\csc', cot: '\\cot', asin: '\\arcsin', acos: '\\arccos', atan: '\\arctan',
  sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh', log: '\\ln', log10: '\\log_{10}', exp: '\\exp',
};

const texPrec = (n: MathNode): number => (n.k === 'bin' ? (n.op === '+' || n.op === '-' ? 1 : n.op === '^' ? 4 : 2) : n.k === 'neg' ? 1 : 9);

/** Typeset a tree. */
export function toTex(n: MathNode): string {
  const wrap = (x: MathNode, min: number) => (texPrec(x) < min ? `\\left(${toTex(x)}\\right)` : toTex(x));
  switch (n.k) {
    case 'num': return fmtNumLatex(parseFloat(n.v), 8);
    case 'sym': return n.name === 'pi' ? '\\pi' : n.name === 'Infinity' ? '\\infty' : nameTex(n.name);
    case 'neg': return `-${wrap(n.a, 2)}`;
    case 'fact': return `${wrap(n.a, 9)}!`;
    case 'call':
      if (n.fn === 'sqrt') return `\\sqrt{${toTex(n.args[0])}}`;
      if (n.fn === 'nthRoot') return `\\sqrt[${toTex(n.args[1])}]{${toTex(n.args[0])}}`;
      if (n.fn === 'abs') return `\\left|${toTex(n.args[0])}\\right|`;
      if (n.fn === 'log' && n.args.length === 2) return `\\log_{${toTex(n.args[1])}}\\left(${toTex(n.args[0])}\\right)`;
      return `${TEX_FN[n.fn] ?? nameTex(n.fn)}\\left(${n.args.map(toTex).join(', ')}\\right)`;
    case 'bin':
      if (n.op === '/') return `\\frac{${toTex(n.a)}}{${toTex(n.b)}}`;
      if (n.op === '^') return `${wrap(n.a, 5)}^{${toTex(n.b)}}`;
      if (n.op === '*') {
        const a = wrap(n.a, 2);
        const b = wrap(n.b, 2);
        // A number has to be kept apart from a number that follows it; otherwise juxtaposition reads best.
        return /^[0-9.]/.test(b) || n.b.k === 'neg' ? `${a} \\cdot ${b}` : `${a}\\,${b}`;
      }
      return `${toTex(n.a)} ${n.op} ${wrap(n.b, n.op === '-' ? 2 : 1)}`;
    case 'big': {
      const body = toTex(n.body);
      if (n.op === 'integral') return `\\int_{${toTex(n.lo)}}^{${toTex(n.hi)}} ${body}\\,d${nameTex(n.bound)}`;
      return `\\${n.op === 'sum' ? 'sum' : 'prod'}_{${nameTex(n.bound)}=${toTex(n.lo)}}^{${toTex(n.hi)}} ${body}`;
    }
    case 'diff': return `\\frac{d}{d${nameTex(n.bound)}}\\left(${toTex(n.body)}\\right)`;
  }
}

/** Simplify a tree that still has unknowns in it, taking any derivatives. Null where that cannot be done. */
function symbolic(n: MathNode, scope: Scope): MathNode | null {
  try {
    let stuck = false;
    const taken = mapNode(n, function take(x): MathNode | undefined {
      if (x.k === 'big') { stuck = true; return x; }
      if (x.k !== 'diff') return undefined;
      const inner: MathNode = { ...x, body: mapNode(x.body, take) };
      const d = symbolicDerivative(inner as Extract<MathNode, { k: 'diff' }>, scope);
      if (!d) stuck = true;
      return d ?? x;
    });
    if (stuck) return null;
    return fromMathjs(simplify(mathParse(toMathText(taken))));
  } catch {
    return null;
  }
}

const list = (names: string[]): string => {
  const shown = names.map((n) => nameTextPlain(n));
  return shown.length <= 1 ? shown.join('') : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
};

/** A variable's name in running text. */
function nameTextPlain(name: string): string {
  const { base, order } = splitDerivName(name);
  if (order === 1) return `d${base}/dt`;
  if (order > 1) return `d${order}${base}/dt${order}`;
  return name;
}

const numTex = (v: number): string => (Number.isNaN(v) ? '\\text{undefined}' : fmtNumLatex(Math.abs(v) < 1e-300 ? 0 : v, 8));

/** Roots of f, searched near the origin first and then more widely. */
function solve(f: Fn, costly: boolean): number[] {
  const safe: Fn = (x) => {
    try {
      const v = f(x);
      return Number.isFinite(v) ? v : NaN;
    } catch {
      return NaN;
    }
  };
  // A straight line has one root, known exactly.
  const f0 = safe(0);
  const f1 = safe(1);
  const f2 = safe(2);
  const fm = safe(-3.5);
  const slope = f1 - f0;
  const scale = Math.max(1, Math.abs(f0), Math.abs(f1), Math.abs(f2), Math.abs(fm));
  if ([f0, f1, f2, fm].every(Number.isFinite) && Math.abs(f2 - f0 - 2 * slope) < 1e-10 * scale && Math.abs(fm - f0 + 3.5 * slope) < 1e-10 * scale) {
    return slope === 0 ? [] : [tidy(-f0 / slope)];
  }
  const found: number[] = [];
  const spans: [number, number, number][] = costly ? [[-10, 10, 400]] : [[-10, 10, 4000], [-1000, 1000, 20000]];
  for (const [a, b, samples] of spans) {
    // Shifted slightly so that a root sitting exactly on a sample is still bracketed.
    for (const r of findRoots(safe, a - 1e-3 * Math.E, b + 1e-3 * Math.PI, samples)) {
      const x = tidy(polish(safe, r));
      if (!found.some((y) => Math.abs(x - y) <= 1e-7 * Math.max(1, Math.abs(x)))) found.push(x);
    }
  }
  return found.sort((a, b) => a - b);
}

/** A few secant steps to sharpen a root found by bisection. */
function polish(f: Fn, x: number): number {
  let a = x;
  let b = x + 1e-6 * Math.max(1, Math.abs(x));
  let fa = f(a);
  let fb = f(b);
  for (let i = 0; i < 8 && Number.isFinite(fa) && Number.isFinite(fb) && fa !== fb; i++) {
    const c = b - (fb * (b - a)) / (fb - fa);
    if (!Number.isFinite(c) || Math.abs(c - x) > 1e-3 * Math.max(1, Math.abs(x))) break;
    a = b; fa = fb; b = c; fb = f(c);
    if (fb === 0) return c;
  }
  return Number.isFinite(fb) && Math.abs(fb) <= Math.abs(f(x)) ? b : x;
}

/** Remove the last-digit noise from a computed root, so 1.9999999999 reads as 2. */
const tidy = (x: number): number => {
  const r = parseFloat(x.toPrecision(11));
  return Object.is(r, -0) ? 0 : r;
};

interface Pass {
  lines: LineResult[];
  values: Map<string, number>;
  /** Which line gave each variable its value. */
  definedBy: Map<string, number>;
  fns: Map<string, FnDef>;
  odes: { lhs: MathNode; rhs: MathNode }[];
  inits: Map<string, number>;
  /** Names that lines needed a value for and did not find. */
  missing: Set<string>;
}

/** Letters whose capital and small forms look alike in handwriting, so a recogniser may give either. */
const LOOKALIKE = /^[cCkKoOpPsSuUvVwWxXzZ]/;
const otherCase = (name: string): string => (name[0] === name[0].toUpperCase() ? name[0].toLowerCase() : name[0].toUpperCase()) + name.slice(1);

function runPass(sources: string[], prior: Pass | null, same: ReadonlyMap<string, string> = new Map()): Pass {
  const pass: Pass = { lines: [], values: new Map(), definedBy: new Map(), fns: new Map(), odes: [], inits: new Map(), missing: new Set() };
  // Functions keep their definitions from the previous pass, so one may be used above where it is defined.
  const fnNames = new Set(prior ? prior.fns.keys() : []);

  sources.forEach((src, index) => {
    // A value from elsewhere on the page counts; one this very line produced last time round does not.
    const lookup = (name: string): number | undefined => {
      if (pass.values.has(name)) return pass.values.get(name);
      if (prior && prior.values.has(name) && prior.definedBy.get(name) !== index) return prior.values.get(name);
      return undefined;
    };
    const fnDef = (name: string): FnDef | undefined => pass.fns.get(name) ?? prior?.fns.get(name);
    const scope: Scope = {
      value: lookup,
      fn: (name) => {
        const def = fnDef(name);
        return def ? (x) => evalNode(def.body, scope, { [def.param]: x }) : undefined;
      },
    };
    const known = (name: string) => lookup(name) !== undefined;
    const define = (name: string, value: number) => { pass.values.set(name, value); pass.definedBy.set(name, index); };

    let merged = false;
    const work = (): LineResult => {
      if (!src.trim()) return { kind: 'waiting', message: 'Nothing is written here.' };
      const line: ParsedLine = parseLatex(src, { functions: fnNames });
      // Where x and X were taken to be one letter, read them as one.
      if (same.size) {
        const merge = (n: MathNode): MathNode => mapNode(n, (x) => {
          if (x.k !== 'sym') return undefined;
          const d = splitDerivName(x.name);
          const to = same.get(d.base);
          if (!to) return undefined;
          merged = true;
          return { k: 'sym', name: derivName(to, d.order) };
        });
        line.lhs = merge(line.lhs);
        if (line.rhs) line.rhs = merge(line.rhs);
        if (line.name && same.has(line.name) && line.kind === 'initial') line.name = same.get(line.name);
      }

      if (line.kind === 'function') {
        pass.fns.set(line.name!, { param: line.param!, body: line.rhs! });
        fnNames.add(line.name!);
        return { kind: 'function', message: `Defines the function ${line.name}.` };
      }

      const sides = line.rhs ? [line.lhs, line.rhs] : [line.lhs];
      for (const side of sides) {
        for (const f of calledFunctions(side)) if (!fnDef(f)) throw new MathReadError(`“${f}” is not a function this scratchpad knows.`);
      }
      const free = new Set<string>();
      sides.forEach((s) => freeSymbols(s).forEach((x) => free.add(x)));
      // Functions bring their own unknowns with them.
      sides.forEach((s) => calledFunctions(s).forEach((f) => { const d = fnDef(f)!; freeSymbols(d.body, new Set([d.param])).forEach((x) => free.add(x)); }));

      if (line.kind === 'initial') {
        const needs = [...freeSymbols(line.rhs!)].filter((x) => !known(x));
        if (needs.length) return { kind: 'waiting', message: `Needs a value for ${list(needs)}.` };
        pass.inits.set(line.name!, evalNode(line.rhs!, scope));
        return { kind: 'initial', message: `Starting value of ${nameTextPlain(line.name!)}.` };
      }

      if (line.kind === 'equation' && [...free].some((x) => splitDerivName(x).order > 0)) {
        pass.odes.push({ lhs: line.lhs, rhs: line.rhs! });
        return { kind: 'equation', message: 'Differential equation — it can be run as a simulation.' };
      }

      const unknown = [...free].filter((x) => !known(x));
      unknown.forEach((x) => pass.missing.add(x));

      if (line.kind === 'expr') {
        if (!unknown.length) {
          const value = evalNode(line.lhs, scope);
          return { kind: 'value', value, tex: `= ${numTex(value)}`, message: Number.isNaN(value) ? 'This has no real value.' : undefined };
        }
        const s = symbolic(line.lhs, scope);
        const hint = `Give ${list(unknown)} a value to get a number.`;
        if (!s) return { kind: 'waiting', message: `Needs a value for ${list(unknown)}.` };
        return { kind: 'symbolic', tex: `= ${toTex(s)}`, message: hint };
      }

      const { lhs } = line;
      const rhs = line.rhs!;
      const rhsFree = freeSymbols(rhs);

      // "x = …" with everything on the right known gives x its value.
      if (lhs.k === 'sym' && !rhsFree.has(lhs.name) && unknown.every((x) => x === lhs.name) && !(lhs.name in BUILT_IN)) {
        const value = evalNode(rhs, scope);
        define(lhs.name, value);
        const computed = line.wantsValue || rhs.k !== 'num';
        return { kind: 'defined', value, tex: computed ? `= ${numTex(value)}` : undefined, message: Number.isNaN(value) ? 'This has no real value.' : undefined };
      }

      if (!unknown.length) {
        const a = evalNode(lhs, scope);
        const b = evalNode(rhs, scope);
        const holds = Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
        return holds
          ? { kind: 'check', tex: '\\checkmark', message: 'Both sides are equal.' }
          : { kind: 'check', tex: `${numTex(a)} \\neq ${numTex(b)}`, message: `The two sides are not equal: the left is ${a.toPrecision(6)} and the right is ${b.toPrecision(6)}.` };
      }

      if (unknown.length === 1) {
        const u = unknown[0];
        let costly = false;
        sides.forEach((s) => walk(s, (x) => { if (x.k === 'big') costly = true; }));
        const roots = solve((x) => evalNode(lhs, scope, { [u]: x }) - evalNode(rhs, scope, { [u]: x }), costly);
        if (!roots.length) return { kind: 'waiting', message: `No solution for ${nameTextPlain(u)} was found between −1000 and 1000.` };
        if (roots.length === 1) define(u, roots[0]);
        const shown = roots.slice(0, 6).map((r) => `${nameTex(u)} = ${numTex(r)}`).join('\\ \\text{or}\\ ');
        return {
          kind: 'solved', value: roots.length === 1 ? roots[0] : undefined, tex: shown,
          message: roots.length > 6 ? `${roots.length} solutions were found; the first six are shown.` : roots.length > 1 ? `${roots.length} solutions, so ${nameTextPlain(u)} is not given a single value.` : undefined,
        };
      }

      if (lhs.k === 'sym' && !rhsFree.has(lhs.name)) {
        const needs = unknown.filter((x) => x !== lhs.name);
        return { kind: 'waiting', message: `Needs a value for ${list(needs)}.` };
      }
      return { kind: 'waiting', message: `There are ${unknown.length} unknowns here (${list(unknown)}), so this cannot be solved on its own. Give all but one of them a value.` };
    };

    try {
      const result = work();
      if (merged) {
        const pairs = [...same].map(([from, to]) => `${from} and ${to}`).join(', ');
        result.message = `${result.message ? `${result.message} ` : ''}Took ${pairs} to be the same letter.`;
      }
      pass.lines.push(result);
    } catch (err) {
      if (err instanceof Unknown) pass.lines.push({ kind: 'waiting', message: `Needs a value for ${list(err.names)}.` });
      else if (err instanceof MathReadError) pass.lines.push({ kind: 'error', message: err.message });
      else pass.lines.push({ kind: 'error', message: 'This line could not be worked out.' });
    }
  });
  return pass;
}

const sameValues = (a: Map<string, number>, b: Map<string, number>): boolean =>
  a.size === b.size && [...a].every(([k, v]) => b.has(k) && (Object.is(b.get(k), v) || b.get(k) === v));

/** Work out every line of a page. Each entry of `sources` is one line of LaTeX. */
export function evaluateNotebook(sources: string[]): Notebook {
  // Later lines can supply values that earlier ones need, so go round until nothing changes.
  const settle = (same?: ReadonlyMap<string, string>): Pass => {
    let p = runPass(sources, null, same);
    for (let i = 0; i < 6; i++) {
      const next = runPass(sources, p, same);
      const settled = sameValues(next.values, p.values) && next.fns.size === p.fns.size;
      p = next;
      if (settled) break;
    }
    return p;
  };
  let pass = settle();
  // Handwritten x and X are easily confused. Where one has a value and the other is wanted but has none, they are one letter.
  const same = new Map<string, string>();
  for (const name of pass.missing) {
    const twin = otherCase(name);
    if (LOOKALIKE.test(name) && !pass.values.has(name) && pass.values.has(twin)) same.set(name, twin);
  }
  if (same.size) pass = settle(same);
  const built = pass.odes.length ? buildModel(pass) : { model: null, notes: [] };
  return { lines: pass.lines, model: built.model, modelNotes: built.notes };
}

const IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Turn the page's differential equations into a simulation. */
function buildModel(pass: Pass): { model: OdeModel | null; notes: string[] } {
  const notes: string[] = [];
  const no = (problem: string) => ({ model: null, notes: [problem] });
  const scope: Scope = { value: (n) => pass.values.get(n), fn: () => undefined };

  // Each equation is solved for its highest derivative.
  const rates = new Map<string, { order: number; expr: MathNode }>();
  for (const eq of pass.odes) {
    let lhs: MathNode;
    let rhs: MathNode;
    try {
      lhs = inline(eq.lhs, pass.fns);
      rhs = inline(eq.rhs, pass.fns);
    } catch (err) {
      return no(err instanceof Error ? err.message : 'A function could not be used.');
    }
    let unusable = false;
    [lhs, rhs].forEach((s) => walk(s, (x) => { if (x.k === 'big' || x.k === 'diff' || x.k === 'fact') unusable = true; }));
    if (unusable) return no('A differential equation cannot contain a sum, an integral, a factorial or d/dx of an expression.');

    const derivs = [...new Set([...freeSymbols(lhs), ...freeSymbols(rhs)])].filter((x) => splitDerivName(x).order > 0);
    const free = (name: string) => !rates.has(splitDerivName(name).base);
    const top = (name: string) => !derivs.some((d) => splitDerivName(d).base === splitDerivName(name).base && splitDerivName(d).order > splitDerivName(name).order);
    const target = lhs.k === 'sym' && derivs.includes(lhs.name) && top(lhs.name) && free(lhs.name)
      ? lhs.name
      : derivs.filter((d) => top(d) && free(d)).sort((a, b) => splitDerivName(b).order - splitDerivName(a).order)[0];
    if (!target) return no('Two equations give the rate of change of the same variable.');
    const { base, order } = splitDerivName(target);
    if (base === 't' || base in BUILT_IN) return no(`“${base}” cannot be a variable of a simulation: t is time, and e and pi are constants.`);

    let expr: MathNode;
    if (lhs.k === 'sym' && lhs.name === target && !freeSymbols(rhs).has(target)) {
      expr = rhs;
    } else {
      // The equation is linear in its highest derivative D: F(D) = F(0) + D (F(1) − F(0)) = 0.
      const F: MathNode = { k: 'bin', op: '-', a: lhs, b: rhs };
      const at = (v: string): MathNode => mapNode(F, (x) => (x.k === 'sym' && x.name === target ? { k: 'num', v } : undefined));
      const others = [...freeSymbols(F)].filter((x) => x !== target);
      let linear = false;
      for (let attempt = 0; attempt < 4 && !linear; attempt++) {
        const local: Record<string, number> = {};
        others.forEach((x, i) => { local[x] = 0.6 + 0.37 * ((i * 7 + attempt * 3) % 5) + 0.11 * attempt; });
        try {
          const [a, b, c] = ['0', '1', '2.5'].map((v) => evalNode(at(v), scope, local));
          if (![a, b, c].every(Number.isFinite)) continue;
          if (Math.abs(c - a - 2.5 * (b - a)) > 1e-9 * Math.max(1, Math.abs(a), Math.abs(b), Math.abs(c))) return no(`An equation is not linear in ${nameTextPlain(target)}, so it cannot be rearranged automatically. Write it as ${nameTextPlain(target)} = ….`);
          if (Math.abs(b - a) < 1e-12) continue;
          linear = true;
        } catch {
          continue;
        }
      }
      if (!linear) return no(`An equation could not be rearranged to give ${nameTextPlain(target)}. Write it as ${nameTextPlain(target)} = ….`);
      const raw: MathNode = { k: 'bin', op: '/', a: { k: 'neg', a: at('0') }, b: { k: 'bin', op: '-', a: at('1'), b: at('0') } };
      try {
        expr = fromMathjs(simplify(mathParse(toMathText(raw))));
      } catch {
        expr = raw;
      }
    }
    rates.set(base, { order, expr });
  }

  const states: StateVar[] = [];
  const stateNames = new Set<string>();
  for (const [base, { order }] of rates) for (let k = 0; k < order; k++) stateNames.add(derivName(base, k));

  const params = new Map<string, Param>();
  for (const [base, { order, expr }] of rates) {
    for (const name of freeSymbols(expr)) {
      if (stateNames.has(name) || name === 't') continue;
      const d = splitDerivName(name);
      if (d.order > 0) {
        return no(rates.has(d.base)
          ? `An equation uses ${nameTextPlain(name)}, which is as high a derivative as its own equation defines. Rearrange so each equation gives one highest derivative in terms of lower ones.`
          : `There is no equation for how ${d.base} changes. Add one, or give ${nameTextPlain(name)} a value.`);
      }
      if (!IDENT.test(name)) return no(`“${name}” cannot be used as a name in a simulation.`);
      if (params.has(name)) continue;
      let value = pass.values.get(name);
      if (value === undefined || !Number.isFinite(value)) {
        notes.push(`${name} has no value on the page, so it starts at 1.`);
        value = 1;
      }
      const span = value === 0 ? 1 : Math.abs(value) * 2;
      params.set(name, { name, value, min: value > 0 ? 0 : -span, max: value < 0 ? 0 : span });
    }
    for (let k = 0; k < order; k++) {
      const name = derivName(base, k);
      const given = pass.inits.get(name);
      const init = given ?? (k === 0 ? 1 : 0);
      if (given === undefined) notes.push(`${nameTextPlain(name)} has no starting value, so it starts at ${init}. Write ${base}${"'".repeat(k)}(0) = … to set it.`);
      states.push({ name, init: String(init), deriv: k === order - 1 ? toMathText(expr) : derivName(base, k + 1) });
    }
  }
  if (!states.length) return no('There is nothing to simulate.');

  const bases = [...rates.keys()];
  const model: OdeModel = {
    id: 'custom',
    name: 'From the scratchpad',
    summary: '',
    states,
    params: [...params.values()],
    derived: [],
    tEnd: 20,
    dt: 0.01,
    method: 'rk45',
    tol: 1e-8,
    timeSeries: bases,
    phase: [states[0].name, states[1]?.name ?? states[0].name],
    notes: '',
  };
  return { model, notes };
}
