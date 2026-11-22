/**
 * Dimensional analysis of a simulation's equations.
 *
 * Units on parameters and variables are optional. Where they are given, every
 * equation is checked: a rate must have the units of its variable per unit
 * time, both sides of a sum or comparison must match, and functions such as
 * sin or exp need dimensionless arguments. A quantity with no unit is treated
 * as unknown and never causes a complaint, so the checking is as strict as the
 * model is annotated.
 */
import { parse, type MathNode } from 'mathjs';
import type { OdeModel } from './ode';
import { DIMLESS, dim, dimDiv, dimEq, dimMul, dimName, dimPow, getUnit, isDimless, siUnitFor, type Dim } from './units';

export interface ParsedUnit {
  d: Dim;
  /** Multiply a value in this unit by `factor` to get SI. */
  factor: number;
}

const SUPERS: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' };
const ALIASES: Record<string, string> = { '°': 'deg', 'μ': 'µ', ohm: 'Ω', sec: 's' };

/** Parse a unit written the way people write them: `m/s²`, `kg·m^2`, `J/(mol·K)`, `1/s`, `N m`. Null if not understood. */
export function parseUnit(text: string): ParsedUnit | null {
  let src = text.trim();
  if (!src) return null;
  // Unicode superscripts become ^n.
  src = src.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (m) => `^${[...m].map((c) => SUPERS[c]).join('')}`);
  let pos = 0;
  const peek = () => src[pos];
  const skip = () => { while (src[pos] === ' ') pos++; };

  const atom = (): ParsedUnit | null => {
    skip();
    if (peek() === '(') {
      pos++;
      const inner = product();
      skip();
      if (!inner || peek() !== ')') return null;
      pos++;
      return inner;
    }
    const m = /^[A-Za-zµμΩ°Å%☉]+|^1(?![0-9.])/.exec(src.slice(pos));
    if (!m) return null;
    pos += m[0].length;
    if (m[0] === '1') return { d: DIMLESS, factor: 1 };
    const u = getUnit(ALIASES[m[0]] ?? m[0].replace('μ', 'µ'));
    return u ? { d: u.d, factor: u.f } : null;
  };
  const power = (): ParsedUnit | null => {
    const base = atom();
    if (!base) return null;
    skip();
    if (peek() !== '^') return base;
    pos++;
    const m = /^\(?(-?\d+(?:\.\d+)?(?:\/\d+)?)\)?/.exec(src.slice(pos));
    if (!m) return null;
    pos += m[0].length;
    const [n, den] = m[1].split('/').map(Number);
    const p = den ? n / den : n;
    return { d: dimPow(base.d, p), factor: Math.pow(base.factor, p) };
  };
  function product(): ParsedUnit | null {
    let acc = power();
    if (!acc) return null;
    for (;;) {
      skip();
      const c = peek();
      if (c === undefined || c === ')') return acc;
      const divide = c === '/';
      if (c === '/' || c === '·' || c === '*' || c === '.') pos++;
      const next = power();
      if (!next) return null;
      // As people write them, everything after a slash is in the denominator until the group closes: J/kg·K is J/(kg·K).
      acc = divide
        ? { d: dimDiv(acc.d, next.d), factor: acc.factor / next.factor }
        : { d: dimMul(acc.d, next.d), factor: acc.factor * next.factor };
      if (divide) {
        for (;;) {
          skip();
          const k = peek();
          if (k !== '·' && k !== '*' && k !== '.' && !(k !== undefined && /[A-Za-zµμΩ°(]/.test(k))) break;
          if (k === '·' || k === '*' || k === '.') pos++;
          const more = power();
          if (!more) return null;
          acc = { d: dimDiv(acc.d, more.d), factor: acc.factor / more.factor };
        }
      }
    }
  }
  const out = product();
  skip();
  return out && pos === src.length ? out : null;
}

export interface UnitIssue {
  /** Which part of the model: `rate:x`, `init:x`, `observable:E`, `event:1`, `stop`, `param:k`, `state:x`. */
  where: string;
  message: string;
}

export interface UnitReport {
  issues: UnitIssue[];
  /** Units worked out for observables that were not given one. */
  inferred: Record<string, string>;
  /** How many equations had enough information to be checked. */
  checked: number;
  /** True when no quantity in the model has a unit, so there is nothing to check. */
  empty: boolean;
}

/** A dimension, or null when it cannot be known (an unannotated quantity is involved). */
type D = Dim | null;

class Mismatch extends Error {}

const describe = (d: Dim) => (isDimless(d) ? 'a plain number' : `${dimName(d)} (${siUnitFor(d)})`);
const NEED_DIMLESS = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'exp', 'log', 'ln', 'log10', 'log2']);
const SAME_AS_ARG = new Set(['abs', 'floor', 'ceil', 'round', 'sign', 'min', 'max', 'mod']);
const TIME = dim(0, 0, 1);

/** Dimension of an expression, given the dimensions of the names in it. Throws Mismatch on an inconsistency. */
function dimensionOf(expr: string, lookup: (name: string) => D | undefined): D {
  const same = (a: D, b: D, what: string): D => {
    if (a && b && !dimEq(a, b)) throw new Mismatch(`${what} ${describe(a)} and ${describe(b)}`);
    return a ?? b;
  };
  /** A literal zero is compatible with anything (x > 0, y - 0); other literals are plain numbers. */
  const isZero = (n: any): boolean => (n.type === 'ConstantNode' && n.value === 0) || (n.type === 'ParenthesisNode' && isZero(n.content));
  const numeric = (n: any): number | null => {
    if (n.type === 'ConstantNode' && typeof n.value === 'number') return n.value;
    if (n.type === 'ParenthesisNode') return numeric(n.content);
    if (n.type === 'OperatorNode' && n.args.length === 1 && n.op === '-') { const v = numeric(n.args[0]); return v === null ? null : -v; }
    if (n.type === 'OperatorNode' && n.args.length === 2 && n.op === '/') { const a = numeric(n.args[0]), b = numeric(n.args[1]); return a === null || b === null ? null : a / b; }
    return null;
  };
  const walk = (node: MathNode): D => {
    const n = node as any;
    switch (n.type) {
      case 'ConstantNode':
        return DIMLESS;
      case 'SymbolNode': {
        const d = lookup(n.name);
        if (d !== undefined) return d;
        return n.name === 'pi' || n.name === 'e' ? DIMLESS : null;
      }
      case 'ParenthesisNode':
        return walk(n.content);
      case 'ConditionalNode':
        walk(n.condition);
        return same(walk(n.trueExpr), walk(n.falseExpr), 'the two branches of a conditional are');
      case 'OperatorNode': {
        if (n.args.length === 1) return n.op === 'not' ? (walk(n.args[0]), DIMLESS) : walk(n.args[0]);
        const [l, r] = n.args;
        switch (n.op) {
          case '+':
          case '-': {
            if (isZero(l)) return walk(r);
            if (isZero(r)) return walk(l);
            return same(walk(l), walk(r), n.op === '+' ? 'it adds' : 'it subtracts');
          }
          case '<': case '>': case '<=': case '>=': case '==': case '!=':
            if (!isZero(l) && !isZero(r)) same(walk(l), walk(r), 'it compares');
            else { walk(l); walk(r); }
            return DIMLESS;
          case 'and': case 'or':
            walk(l); walk(r);
            return DIMLESS;
          case '*': { const a = walk(l), b = walk(r); return a && b ? dimMul(a, b) : null; }
          case '/': { const a = walk(l), b = walk(r); return a && b ? dimDiv(a, b) : null; }
          case '%': case 'mod':
            return same(walk(l), walk(r), 'it takes a remainder of');
          case '^': {
            const base = walk(l);
            const ex = walk(r);
            if (ex && !isDimless(ex)) throw new Mismatch(`an exponent is ${describe(ex)}; exponents must be plain numbers`);
            if (!base || isDimless(base)) return base;
            const p = numeric(r);
            if (p === null) throw new Mismatch(`${describe(base)} is raised to a power that is not a fixed number`);
            return dimPow(base, p);
          }
          default:
            return null;
        }
      }
      case 'FunctionNode': {
        const name: string = n.fn?.name ?? '';
        const args: D[] = n.args.map(walk);
        if (NEED_DIMLESS.has(name)) {
          const bad = args.find((a) => a && !isDimless(a));
          if (bad) throw new Mismatch(`${name}() is given ${describe(bad)}; its argument must be a plain number`);
          return DIMLESS;
        }
        if (name === 'sqrt') return args[0] ? dimPow(args[0], 0.5) : null;
        if (name === 'cbrt') return args[0] ? dimPow(args[0], 1 / 3) : null;
        if (name === 'atan2') { same(args[0], args[1], 'atan2() is given'); return DIMLESS; }
        if (name === 'pow') {
          const p = numeric(n.args[1]);
          if (!args[0] || isDimless(args[0])) return args[0];
          if (p === null) throw new Mismatch(`${describe(args[0])} is raised to a power that is not a fixed number`);
          return dimPow(args[0], p);
        }
        if (SAME_AS_ARG.has(name)) return args.reduce<D>((acc, a) => same(acc, a, `${name}() mixes`), null);
        return null;
      }
      default:
        return null;
    }
  };
  return walk(parse(expr));
}

/** Check every equation of a model for dimensional consistency. Time is in seconds. */
export function checkUnits(model: OdeModel): UnitReport {
  const issues: UnitIssue[] = [];
  const dims = new Map<string, D>([['t', TIME]]);
  const inferred: Record<string, string> = {};
  let annotated = 0;
  let checked = 0;

  const declare = (kind: 'param' | 'state' | 'observable', name: string, unit: string | undefined): D => {
    if (!unit?.trim()) return null;
    const u = parseUnit(unit);
    if (!u) {
      issues.push({ where: `${kind}:${name}`, message: `The unit "${unit}" of ${name} is not recognised, so equations involving it are not checked` });
      return null;
    }
    annotated++;
    // Equations work on the raw numbers, so a non-SI unit silently scales the result.
    if (!isDimless(u.d) && Math.abs(u.factor - 1) > 1e-12) {
      issues.push({ where: `${kind}:${name}`, message: `${name} is in ${unit}, which is not an SI unit. Equations use the numbers as typed, so either enter it in ${siUnitFor(u.d)} or convert it in the equations` });
    }
    return u.d;
  };
  for (const p of model.params) dims.set(p.name, declare('param', p.name, p.unit));
  for (const s of model.states) dims.set(s.name, declare('state', s.name, s.unit));
  const lookup = (n: string) => dims.get(n);

  const evaluate = (where: string, subject: string, expr: string): D | undefined => {
    if (!expr.trim()) return undefined;
    try {
      return dimensionOf(expr, lookup);
    } catch (err) {
      if (err instanceof Mismatch) issues.push({ where, message: `In ${subject}, ${err.message}` });
      // A syntax error is reported by the solver; it is not a units problem.
      return undefined;
    }
  };
  /** A bare number is a value typed in the quantity's own unit, so there is nothing to check. */
  const isLiteral = (expr: string) => /^\s*[-+]?\s*(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(expr);
  const expectDim = (where: string, subject: string, expr: string, want: D, wantText: string) => {
    if (isLiteral(expr)) return;
    const got = evaluate(where, subject, expr);
    if (got === undefined || !got || !want) return;
    checked++;
    if (!dimEq(got, want)) issues.push({ where, message: `${subject[0].toUpperCase()}${subject.slice(1)} works out as ${describe(got)}, but ${wantText} needs ${describe(want)}` });
  };

  // Observables first, in order: rates may refer to them.
  for (const d of model.derived) {
    const declared = declare('observable', d.name, d.unit);
    const got = evaluate(`observable:${d.name}`, `the expression for ${d.name}`, d.expr);
    if (declared && got) {
      checked++;
      if (!dimEq(got, declared)) issues.push({ where: `observable:${d.name}`, message: `${d.name} is labelled ${d.unit}, but its expression works out as ${describe(got)}` });
    } else if (!declared && got && !d.unit?.trim()) {
      inferred[d.name] = siUnitFor(got);
    }
    dims.set(d.name, declared ?? got ?? null);
  }

  for (const s of model.states) {
    const sd = dims.get(s.name) ?? null;
    expectDim(`init:${s.name}`, `the initial value of ${s.name}`, s.init, sd, s.name);
    expectDim(`rate:${s.name}`, `the rate of change of ${s.name}`, s.deriv, sd ? dimDiv(sd, TIME) : null, `d${s.name}/dt`);
  }
  (model.events ?? []).forEach((e, i) => {
    if (!e.when.trim()) return;
    evaluate(`event:${i + 1}`, `the condition of event ${i + 1}`, e.when);
    for (const a of e.then.split(/[;\n]/).map((x) => x.trim()).filter(Boolean)) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)\s*(.+)$/.exec(a);
      if (m && dims.has(m[1])) expectDim(`event:${i + 1}`, `the reset of ${m[1]} in event ${i + 1}`, m[2], dims.get(m[1]) ?? null, m[1]);
    }
  });
  if (model.stopWhen) evaluate('stop', 'the stop condition', model.stopWhen);

  return { issues, inferred, checked, empty: annotated === 0 };
}
