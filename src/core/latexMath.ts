/**
 * Reading mathematics written in LaTeX — what a handwriting recogniser
 * produces — into a small syntax tree, and writing that tree back out as an
 * expression the rest of the engine understands.
 *
 * Only the tree is ever turned into expression text, from a fixed set of node
 * kinds and function names. Recognised text is never copied through, so
 * nothing a recogniser (or a shared file) says can smuggle code into a model.
 */

export type MathNode =
  | { k: 'num'; v: string }
  | { k: 'sym'; name: string }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: MathNode; b: MathNode }
  | { k: 'neg'; a: MathNode }
  | { k: 'fact'; a: MathNode }
  | { k: 'call'; fn: string; args: MathNode[] }
  /** A definite integral, sum or product over a bound variable. */
  | { k: 'big'; op: 'integral' | 'sum' | 'product'; body: MathNode; bound: string; lo: MathNode; hi: MathNode }
  /** d/d(bound) of body. */
  | { k: 'diff'; body: MathNode; bound: string };

export interface ParsedLine {
  /**
   * 'expr': something to work out. 'equation': left = right.
   * 'function': f(x) = …. 'initial': a starting value such as x(0) = 1.
   */
  kind: 'expr' | 'equation' | 'function' | 'initial';
  lhs: MathNode;
  rhs?: MathNode;
  /** The line ends in "=", asking for its value. */
  wantsValue: boolean;
  /** For 'function': its name and argument. For 'initial': the variable. */
  name?: string;
  param?: string;
}

/** A problem with what was written, phrased for the person who wrote it. */
export class MathReadError extends Error {}

const fail = (message: string): never => {
  throw new MathReadError(message);
};

/** The name a time derivative goes by: x_dot, x_ddot, then x_d3, x_d4, … */
export const derivName = (base: string, order: number): string =>
  order <= 0 ? base : order === 1 ? `${base}_dot` : order === 2 ? `${base}_ddot` : `${base}_d${order}`;

/** The reverse of `derivName`; order 0 for an ordinary name. */
export function splitDerivName(name: string): { base: string; order: number } {
  const m = /^(.+)_(dot|ddot|d(\d+))$/.exec(name);
  if (!m) return { base: name, order: 0 };
  return { base: m[1], order: m[2] === 'dot' ? 1 : m[2] === 'ddot' ? 2 : parseInt(m[3], 10) };
}

const GREEK = new Set([
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi',
  'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega',
  'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega', 'hbar', 'ell',
]);
const GREEK_VARIANT: Record<string, string> = { varepsilon: 'epsilon', vartheta: 'theta', varphi: 'phi', varrho: 'rho', varsigma: 'sigma' };

/** Functions of one argument, by the name they are written with. */
const FUNCTIONS: Record<string, string> = {
  sin: 'sin', cos: 'cos', tan: 'tan', sec: 'sec', csc: 'csc', cot: 'cot',
  arcsin: 'asin', arccos: 'acos', arctan: 'atan', asin: 'asin', acos: 'acos', atan: 'atan',
  sinh: 'sinh', cosh: 'cosh', tanh: 'tanh',
  exp: 'exp', ln: 'log', log: 'log10', lg: 'log10', sqrt: 'sqrt', abs: 'abs',
};
const INVERSE: Record<string, string> = { sin: 'asin', cos: 'acos', tan: 'atan', sinh: 'asinh', cosh: 'acosh', tanh: 'atanh' };

/** Commands that only affect spacing or size, and say nothing mathematical. */
const IGNORED = new Set([
  'left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'displaystyle', 'textstyle',
  'quad', 'qquad', 'limits', 'nolimits', 'mathstrut', 'strut', 'hfill', 'thinspace', 'enspace', 'space', 'nonumber',
]);
/** Wrappers whose contents read as ordinary mathematics. */
const TRANSPARENT = new Set(['mathbf', 'boldsymbol', 'bm', 'mathit', 'mathnormal', 'mathsf', 'vec', 'overrightarrow', 'mathcal', 'mathbb']);
/** Accents that make a different variable: \bar{x} is not x. */
const ACCENT: Record<string, string> = { bar: 'bar', overline: 'bar', hat: 'hat', widehat: 'hat', tilde: 'tilde', widetilde: 'tilde' };
const DOTS: Record<string, number> = { dot: 1, ddot: 2, dddot: 3, ddddot: 4 };

type Tok =
  | { t: 'num'; v: string }
  | { t: 'let'; v: string }
  | { t: 'cmd'; v: string }
  | { t: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c) || c === '$' || c === '&' || c === '~') { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(\d+(\.\d+)?|\.\d+)/.exec(src.slice(i))!;
      out.push({ t: 'num', v: m[0] });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z]/.test(c)) { out.push({ t: 'let', v: c }); i++; continue; }
    if (c === '\\') {
      const m = /^\\([A-Za-z]+)/.exec(src.slice(i));
      if (m) {
        i += m[0].length;
        if (IGNORED.has(m[1])) {
          // "\left." and "\right." are invisible delimiters.
          if ((m[1] === 'left' || m[1] === 'right') && src[i] === '.') i++;
          continue;
        }
        out.push({ t: 'cmd', v: m[1] });
        continue;
      }
      const next = src[i + 1] ?? '';
      i += 2;
      if (next === '{') out.push({ t: 'op', v: '(' });
      else if (next === '}') out.push({ t: 'op', v: ')' });
      else if (next === '|') out.push({ t: 'op', v: '|' });
      else if (next === '\\') fail('Write one line of mathematics at a time.');
      // "\," "\;" "\!" "\ " and the like are spacing.
      continue;
    }
    if (c === '.') { i++; continue; } // a full stop ending a sentence of mathematics
    out.push({ t: 'op', v: c });
    i++;
  }
  return out;
}

interface Options {
  /** Names already defined as functions, so that f(2) is a call rather than f times 2. */
  functions?: ReadonlySet<string>;
}

class Parser {
  private i = 0;
  /** How many absolute-value bars are open, so a bar is read as closing one. */
  private bars = 0;
  /** Inside an integral, where "dx" ends the integrand. */
  private integrals = 0;

  constructor(private readonly toks: Tok[], private readonly fns: ReadonlySet<string>) {}

  private peek(o = 0): Tok | undefined { return this.toks[this.i + o]; }
  private isOp(v: string, o = 0): boolean { const t = this.peek(o); return !!t && t.t === 'op' && t.v === v; }
  private isCmd(v: string, o = 0): boolean { const t = this.peek(o); return !!t && t.t === 'cmd' && t.v === v; }
  private isLet(v: string, o = 0): boolean { const t = this.peek(o); return !!t && t.t === 'let' && t.v === v; }
  private eat(v: string): boolean { if (this.isOp(v)) { this.i++; return true; } return false; }
  private expect(v: string, what: string): void { if (!this.eat(v)) fail(what); }
  atEnd(): boolean { return this.i >= this.toks.length; }

  /** Tokens inside the next {...} group, without consuming them. */
  private groupAt(start: number): { inner: Tok[]; end: number } | null {
    const open = this.toks[start];
    if (!open || open.t !== 'op' || open.v !== '{') return null;
    let depth = 0;
    for (let j = start; j < this.toks.length; j++) {
      const t = this.toks[j];
      if (t.t === 'op' && t.v === '{') depth++;
      else if (t.t === 'op' && t.v === '}' && --depth === 0) return { inner: this.toks.slice(start + 1, j), end: j + 1 };
    }
    return fail('A “{” is never closed.');
  }

  private sub(inner: Tok[]): Parser {
    const p = new Parser(inner, this.fns);
    p.integrals = this.integrals;
    return p;
  }

  /** An argument: a {group}, or the single thing that follows (as in x^2 or \frac12). */
  private arg(): MathNode {
    const g = this.groupAt(this.i);
    if (g) {
      this.i = g.end;
      const p = this.sub(g.inner);
      if (p.atEnd()) fail('There is an empty “{}” — something is missing inside it.');
      const node = p.expr();
      if (!p.atEnd()) fail('Part of a “{…}” group could not be read.');
      return node;
    }
    const t = this.peek();
    if (!t) return fail('The expression ends where something more was expected.');
    if (t.t === 'num' && t.v.length > 1 && !t.v.includes('.')) {
      // \frac12 means one over two: an unbraced argument is a single digit.
      this.toks[this.i] = { t: 'num', v: t.v.slice(1) };
      return { k: 'num', v: t.v[0] };
    }
    if (t.t === 'op' && t.v === '-') { this.i++; return { k: 'neg', a: this.arg() }; }
    return this.atom();
  }

  /** The letters and digits of a subscript or a \mathrm{…} name, joined into one word. */
  private word(inner: Tok[]): string {
    let s = '';
    for (const t of inner) {
      if (t.t === 'let' || t.t === 'num') s += t.v;
      else if (t.t === 'cmd' && (GREEK.has(t.v) || GREEK_VARIANT[t.v])) s += GREEK_VARIANT[t.v] ?? t.v;
      else if (t.t === 'cmd' && (t.v === 'mathrm' || t.v === 'text' || t.v === 'mathit' || t.v === 'max' || t.v === 'min')) s += t.v === 'max' || t.v === 'min' ? t.v : '';
      else if (t.t === 'op' && (t.v === '{' || t.v === '}' || t.v === ',')) continue;
      else fail('A subscript can only contain letters and numbers.');
    }
    return s.replace(/[^A-Za-z0-9]/g, '');
  }

  /** The inside of a braced group, or the next single token, as a word. */
  private wordArg(): string {
    const g = this.groupAt(this.i);
    if (g) { this.i = g.end; return this.word(g.inner); }
    const t = this.peek();
    if (!t) return fail('A subscript is missing.');
    this.i++;
    return this.word([t]);
  }

  /** A variable name starting at the current token, with any subscript: x, x_0, \omega_{max}. */
  private symbolName(): string | null {
    const t = this.peek();
    if (!t) return null;
    let base: string;
    if (t.t === 'let') base = t.v;
    else if (t.t === 'cmd' && (GREEK.has(t.v) || GREEK_VARIANT[t.v])) base = GREEK_VARIANT[t.v] ?? t.v;
    else return null;
    this.i++;
    if (this.eat('_')) {
      const sub = this.wordArg();
      if (!sub) fail('A subscript is empty.');
      base = `${base}_${sub}`;
    }
    return base;
  }

  /** Recognise d/dt forms inside a fraction: dx/dt, d²x/dt², and the operator d/dt. */
  private leibniz(num: Tok[], den: Tok[]): MathNode | null {
    const isD = (t?: Tok) => !!t && t.t === 'let' && t.v === 'd';
    if (!isD(num[0]) || !isD(den[0])) return null;
    const power = (toks: Tok[], at: number): { order: number; next: number } => {
      const caret = toks[at];
      if (!caret || caret.t !== 'op' || caret.v !== '^') return { order: 1, next: at };
      const a = toks[at + 1];
      if (a?.t === 'num') return { order: parseInt(a.v, 10), next: at + 2 };
      if (a?.t === 'op' && a.v === '{' && toks[at + 2]?.t === 'num' && toks[at + 3]?.t === 'op') return { order: parseInt((toks[at + 2] as { v: string }).v, 10), next: at + 4 };
      return { order: NaN, next: at };
    };
    const top = power(num, 1);
    const below = this.sub(den.slice(1));
    const bound = below.symbolName();
    if (!bound) return null;
    const bottom = power(den, 1 + below.i);
    if (1 + below.i !== den.length && bottom.next !== den.length) return null;
    if (!Number.isFinite(top.order) || top.order !== bottom.order) return null;
    const rest = num.slice(top.next);
    if (!rest.length) {
      // The operator form, applied to whatever comes next.
      let body = this.unary();
      for (let n = 0; n < top.order; n++) body = { k: 'diff', body, bound };
      return body;
    }
    const of = this.sub(rest);
    const name = of.symbolName();
    if (!name || !of.atEnd()) return null;
    if (bound !== 't') return fail(`Derivatives of a variable are taken with respect to time, t — this one uses ${bound}.`);
    return { k: 'sym', name: derivName(name, top.order) };
  }

  private frac(): MathNode {
    const a = this.groupAt(this.i);
    const b = a && this.groupAt(a.end);
    if (a && b) {
      const saved = this.i;
      this.i = b.end;
      const d = this.leibniz(a.inner, b.inner);
      if (d) return d;
      this.i = saved;
    }
    const num = this.arg();
    const den = this.arg();
    return { k: 'bin', op: '/', a: num, b: den };
  }

  /** What a named function is applied to: (…) exactly, or the run of factors that follows, as in sin 2x. */
  private fnArgument(): MathNode {
    if (this.isOp('(') || this.isOp('[')) return this.atom();
    let node = this.unary();
    while (this.startsFactor() && !this.startsFunction()) node = { k: 'bin', op: '*', a: node, b: this.power() };
    return node;
  }

  private letterRun(): string {
    let s = '';
    for (let o = 0; this.peek(o)?.t === 'let'; o++) s += (this.peek(o) as { v: string }).v;
    return s;
  }

  /** A function name spelt out in plain letters (s-i-n), as recognisers sometimes give it. */
  private spelledFunction(): string | null {
    const run = this.letterRun();
    for (const name of ['arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'sqrt', 'sin', 'cos', 'tan', 'exp', 'log', 'ln']) {
      if (run.startsWith(name)) return name;
    }
    return null;
  }

  private startsFunction(): boolean {
    const t = this.peek();
    if (!t) return false;
    if (t.t === 'cmd') return t.v in FUNCTIONS || t.v === 'operatorname' || t.v === 'int' || t.v === 'sum' || t.v === 'prod';
    return t.t === 'let' && this.spelledFunction() !== null;
  }

  private applyFunction(written: string): MathNode {
    let fn = FUNCTIONS[written];
    let base: MathNode | null = null;
    let exponent: MathNode | null = null;
    if (this.eat('_')) {
      if (written !== 'log') fail(`“${written}” cannot take a subscript.`);
      base = this.arg();
    }
    if (this.eat('^')) {
      const e = this.arg();
      const isMinusOne = e.k === 'neg' && e.a.k === 'num' && e.a.v === '1';
      if (isMinusOne && INVERSE[fn]) fn = INVERSE[fn];
      else exponent = e;
    }
    const x = this.fnArgument();
    let node: MathNode = base ? { k: 'call', fn: 'log', args: [x, base] } : { k: 'call', fn, args: [x] };
    if (exponent) node = { k: 'bin', op: '^', a: node, b: exponent };
    return node;
  }

  private limits(what: string, rawLower = false): { lo: MathNode | null; hi: MathNode | null; loTokens: Tok[] | null } {
    let lo: MathNode | null = null;
    let hi: MathNode | null = null;
    let loTokens: Tok[] | null = null;
    for (let n = 0; n < 2; n++) {
      if (this.isOp('_')) {
        this.i++;
        const g = this.groupAt(this.i);
        loTokens = g ? g.inner : [this.peek() ?? fail(`The ${what} is missing its lower limit.`)];
        // A sum's lower limit reads "n = 1", which is not an expression; its caller reads it.
        if (rawLower) this.i = g ? g.end : this.i + 1;
        else lo = this.arg();
      } else if (this.isOp('^')) {
        this.i++;
        hi = this.arg();
      }
    }
    return { lo, hi, loTokens };
  }

  private integral(): MathNode {
    const { lo, hi } = this.limits('integral');
    if (!lo || !hi) return fail('Only integrals with both limits can be worked out — write the limits on the integral sign.');
    this.integrals++;
    const body = this.atDifferential() ? { k: 'num' as const, v: '1' } : this.expr();
    const ended = this.atDifferential();
    this.integrals--;
    if (!ended) return fail('The integral needs to end with what it integrates over, such as dx.');
    this.i++;
    const bound = this.symbolName()!;
    return { k: 'big', op: 'integral', body, bound, lo, hi };
  }

  /** "d" followed by a variable, which ends an integrand. */
  private atDifferential(): boolean {
    if (!this.integrals || !this.isLet('d')) return false;
    const n = this.peek(1);
    return !!n && (n.t === 'let' || (n.t === 'cmd' && (GREEK.has(n.v) || !!GREEK_VARIANT[n.v])));
  }

  private series(op: 'sum' | 'product'): MathNode {
    const what = op === 'sum' ? 'sum' : 'product';
    const save = this.i;
    const { hi, loTokens } = this.limits(what, true);
    if (!hi || !loTokens) return fail(`Write the ${what} with a start below it (such as n = 1) and an end above it.`);
    // The lower limit reads "n = 1": the counter and where it starts.
    const eq = loTokens.findIndex((t) => t.t === 'op' && t.v === '=');
    if (eq < 1) { this.i = save; return fail(`The ${what} needs a counter and a start below it, such as n = 1.`); }
    const head = this.sub(loTokens.slice(0, eq));
    const bound = head.symbolName();
    if (!bound || !head.atEnd()) return fail(`The counter of the ${what} should be a single letter.`);
    const from = this.sub(loTokens.slice(eq + 1));
    const lo = from.expr();
    if (!from.atEnd()) fail(`The start of the ${what} could not be read.`);
    return { k: 'big', op, body: this.term(), bound, lo, hi };
  }

  private atom(): MathNode {
    const t = this.peek();
    if (!t) return fail('The expression ends where something more was expected.');
    if (t.t === 'num') { this.i++; return { k: 'num', v: t.v }; }

    if (t.t === 'op') {
      if (t.v === '(' || t.v === '[') {
        this.i++;
        const saved = this.bars;
        this.bars = 0;
        const node = this.expr();
        this.bars = saved;
        if (!this.eat(')') && !this.eat(']')) fail('A bracket is opened but never closed.');
        return node;
      }
      if (t.v === '{') return this.arg();
      if (t.v === '|') {
        this.i++;
        this.bars++;
        const node = this.expr();
        this.bars--;
        this.expect('|', 'An absolute-value bar is opened but never closed.');
        return { k: 'call', fn: 'abs', args: [node] };
      }
      return fail(t.v === ')' || t.v === ']' || t.v === '}' ? 'There is a closing bracket with nothing open.' : `“${t.v}” appears where a number or variable was expected.`);
    }

    if (t.t === 'let') {
      const spelled = this.spelledFunction();
      if (spelled) { this.i += spelled.length; return this.applyFunction(spelled); }
      const name = this.symbolName()!;
      return this.afterSymbol(name);
    }

    // Commands.
    this.i++;
    const c = t.v;
    if (GREEK.has(c) || GREEK_VARIANT[c]) {
      this.i--;
      const name = this.symbolName()!;
      return name === 'pi' ? { k: 'sym', name: 'pi' } : this.afterSymbol(name);
    }
    if (c === 'pi') return { k: 'sym', name: 'pi' };
    if (c === 'infty') return { k: 'sym', name: 'Infinity' };
    if (c === 'frac' || c === 'dfrac' || c === 'tfrac') return this.frac();
    if (c === 'sqrt') {
      if (this.eat('[')) {
        const p = this.expr();
        this.expect(']', 'The index of a root is opened with “[” but never closed.');
        return { k: 'call', fn: 'nthRoot', args: [this.arg(), p] };
      }
      return { k: 'call', fn: 'sqrt', args: [this.arg()] };
    }
    if (c in FUNCTIONS) return this.applyFunction(c);
    if (c === 'operatorname' || c === 'mathrm' || c === 'text' || c === 'textrm') {
      const name = this.wordArg();
      if (name in FUNCTIONS) return this.applyFunction(name);
      if (!name) return fail('There is an empty name.');
      if (name === 'e' || name === 'pi') return { k: 'sym', name };
      return this.afterSymbol(this.eat('_') ? `${name}_${this.wordArg()}` : name);
    }
    if (TRANSPARENT.has(c)) return this.arg();
    if (c in ACCENT || c in DOTS) {
      const g = this.groupAt(this.i);
      const inner = this.sub(g ? g.inner : [this.peek() ?? fail('An accent has nothing under it.')]);
      this.i = g ? g.end : this.i + 1;
      const base = inner.symbolName();
      if (!base || !inner.atEnd()) return fail('A dot or bar can only go over a single variable.');
      let name = c in DOTS ? derivName(base, DOTS[c]) : `${base}_${ACCENT[c]}`;
      // A subscript written after the accent belongs to the variable: \dot{x}_1 is the rate of x_1.
      if (this.eat('_')) {
        const sub = this.wordArg();
        name = c in DOTS ? derivName(`${base}_${sub}`, DOTS[c]) : `${base}_${sub}_${ACCENT[c]}`;
      }
      return { k: 'sym', name };
    }
    if (c === 'int') return this.integral();
    if (c === 'sum') return this.series('sum');
    if (c === 'prod') return this.series('product');
    if (c === 'lvert' || c === 'vert') {
      this.bars++;
      const node = this.expr();
      this.bars--;
      if (!(this.isCmd('rvert') || this.isCmd('vert') || this.isOp('|'))) fail('An absolute-value bar is opened but never closed.');
      this.i++;
      return { k: 'call', fn: 'abs', args: [node] };
    }
    if (c === 'iint' || c === 'iiint' || c === 'oint') return fail('Multiple and contour integrals are not supported.');
    if (c === 'lim') return fail('Limits are not supported.');
    if (c === 'partial' || c === 'nabla') return fail('Partial derivatives are not supported.');
    return fail(`“\\${c}” is not something this scratchpad understands yet.`);
  }

  /** A variable may be followed by primes (x′ is its rate of change) or, for a known function, by its argument. */
  private afterSymbol(name: string, calls = true): MathNode {
    let order = 0;
    while (this.isOp("'") || this.isCmd('prime')) { this.i++; order++; }
    if (order) return { k: 'sym', name: derivName(name, order) };
    if (calls && this.fns.has(name) && this.isOp('(')) {
      this.i++;
      const args: MathNode[] = [this.expr()];
      while (this.eat(',')) args.push(this.expr());
      this.expect(')', 'A bracket is opened but never closed.');
      return { k: 'call', fn: name, args };
    }
    return { k: 'sym', name };
  }

  private power(): MathNode {
    let node = this.atom();
    for (;;) {
      if (this.isOp('^')) {
        this.i++;
        if (this.isCmd('circ')) { this.i++; node = { k: 'bin', op: '*', a: node, b: { k: 'bin', op: '/', a: { k: 'sym', name: 'pi' }, b: { k: 'num', v: '180' } } }; continue; }
        const g = this.groupAt(this.i);
        if (g && g.inner.length === 1 && g.inner[0].t === 'cmd' && g.inner[0].v === 'circ') {
          this.i = g.end;
          node = { k: 'bin', op: '*', a: node, b: { k: 'bin', op: '/', a: { k: 'sym', name: 'pi' }, b: { k: 'num', v: '180' } } };
          continue;
        }
        if (g && g.inner.every((x) => (x.t === 'cmd' && x.v === 'prime') || (x.t === 'op' && x.v === "'")) && g.inner.length && node.k === 'sym') {
          this.i = g.end;
          node = { k: 'sym', name: derivName(node.name, g.inner.length) };
          continue;
        }
        // Powers group to the right: x^y^z is x^(y^z).
        node = { k: 'bin', op: '^', a: node, b: this.arg() };
      } else if (this.isOp('!')) {
        this.i++;
        node = { k: 'fact', a: node };
      } else return node;
    }
  }

  private unary(): MathNode {
    if (this.eat('-')) return { k: 'neg', a: this.unary() };
    if (this.eat('+')) return this.unary();
    return this.power();
  }

  /** Whether the next token can begin a factor — which is what makes "2x" a product. */
  private startsFactor(): boolean {
    const t = this.peek();
    if (!t) return false;
    if (this.atDifferential()) return false;
    if (t.t === 'num' || t.t === 'let') return true;
    if (t.t === 'op') return t.v === '(' || t.v === '[' || t.v === '{' || (t.v === '|' && this.bars === 0);
    return !['cdot', 'times', 'div', 'rvert', 'approx', 'ast', 'le', 'ge', 'leq', 'geq', 'neq', 'ne', 'pm', 'mp', 'circ', 'prime', 'to', 'rightarrow'].includes(t.v);
  }

  private term(): MathNode {
    let node = this.unary();
    for (;;) {
      if (this.isOp('*') || this.isCmd('cdot') || this.isCmd('times') || this.isCmd('ast')) {
        this.i++;
        node = { k: 'bin', op: '*', a: node, b: this.unary() };
      } else if (this.isOp('/') || this.isCmd('div')) {
        this.i++;
        node = { k: 'bin', op: '/', a: node, b: this.unary() };
      } else if (this.startsFactor()) {
        node = { k: 'bin', op: '*', a: node, b: this.power() };
      } else return node;
    }
  }

  expr(): MathNode {
    let node = this.term();
    for (;;) {
      if (this.eat('+')) node = { k: 'bin', op: '+', a: node, b: this.term() };
      else if (this.eat('-')) node = { k: 'bin', op: '-', a: node, b: this.term() };
      else return node;
    }
  }

  /** A whole line: an expression, optionally "= expression", optionally a trailing "=". */
  line(): ParsedLine {
    // f(x) = …  and  x(0) = …
    const start = this.i;
    const head = this.headForm();
    if (head) return head;
    this.i = start;

    const lhs = this.expr();
    if (this.atEnd()) return { kind: 'expr', lhs, wantsValue: false };
    if (this.isCmd('approx')) this.i++;
    else if (!this.eat('=')) return this.unexpected();
    if (this.atEnd()) return { kind: 'expr', lhs, wantsValue: true };
    const rhs = this.expr();
    let wantsValue = false;
    if (this.eat('=')) wantsValue = true;
    if (!this.atEnd()) {
      if (wantsValue) return fail('Only one “=” can be followed by an expression on a line.');
      return this.unexpected();
    }
    return { kind: 'equation', lhs, rhs, wantsValue };
  }

  private headForm(): ParsedLine | null {
    const first = this.peek();
    if (!first || (first.t !== 'let' && first.t !== 'cmd')) return null;
    let name: string | null = null;
    try {
      // Read the name alone: "f(x) = …" defines f even when f is already a known function.
      const node = first.t === 'cmd' && (first.v in DOTS) ? this.atom() : first.t === 'let' && this.spelledFunction() ? null : (() => { const n = this.symbolName(); return n ? this.afterSymbol(n, false) : null; })();
      if (node && node.k === 'sym') name = node.name;
    } catch {
      return null;
    }
    if (!name || !this.eat('(')) return null;
    const inner = this.peek();
    if (inner?.t === 'num' && this.isOp(')', 1) && this.isOp('=', 2)) {
      this.i += 3;
      if (this.atEnd() || this.fns.has(name)) return null;
      const at = inner.v;
      if (Number(at) !== 0) return fail(`A starting value is given at time 0 — write ${name}(0), not ${name}(${at}).`);
      const rhs = this.expr();
      if (!this.atEnd()) return this.unexpected();
      return { kind: 'initial', lhs: { k: 'sym', name }, rhs, wantsValue: false, name };
    }
    const param = this.symbolName();
    if (!param || !this.eat(')') || !this.eat('=') || this.atEnd()) return null;
    if (splitDerivName(name).order) return null;
    const rhs = this.expr();
    if (!this.atEnd()) return this.unexpected();
    return { kind: 'function', lhs: { k: 'sym', name }, rhs, wantsValue: false, name, param };
  }

  private unexpected(): never {
    const t = this.peek()!;
    const shown = t.t === 'cmd' ? `\\${t.v}` : t.v;
    if (shown === '<' || shown === '>' || ['\\le', '\\ge', '\\leq', '\\geq', '\\neq', '\\ne'].includes(shown)) return fail('Inequalities are not supported — write an equation with “=”.');
    if (shown === '\\pm' || shown === '\\mp') return fail('“±” is not supported — write the two cases on separate lines.');
    return fail(`“${shown}” appears where it does not make sense.`);
  }
}

/** Read one line of LaTeX mathematics. Throws `MathReadError` with a plain-language reason. */
export function parseLatex(src: string, options: Options = {}): ParsedLine {
  // An upright d (\mathrm{d}x) is the same differential as an italic one.
  const toks = tokenize(src.replace(/\\(mathrm|text|operatorname)\s*\{\s*d\s*\}/g, ' d '));
  if (!toks.length) return fail('Nothing is written here.');
  return new Parser(toks, options.functions ?? new Set()).line();
}

const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 } as const;
const prec = (n: MathNode): number => (n.k === 'bin' ? PREC[n.op] : n.k === 'neg' ? 3 : 9);

/**
 * Write a tree as expression text for the engine. Sums, integrals and d/dx
 * have no such form; resolve them first (see `core/scratch.ts`).
 */
export function toMathText(n: MathNode): string {
  const wrap = (x: MathNode, min: number, strict = false) => {
    const s = toMathText(x);
    const p = prec(x);
    return p < min || (strict && p === min) ? `(${s})` : s;
  };
  switch (n.k) {
    case 'num': return n.v;
    case 'sym': return n.name;
    case 'neg': return `-${wrap(n.a, 3)}`;
    case 'fact': return `${wrap(n.a, 9)}!`;
    case 'call': return `${n.fn}(${n.args.map(toMathText).join(', ')})`;
    case 'bin':
      if (n.op === '^') return `${wrap(n.a, 4, true)}^${wrap(n.b, 4)}`;
      if (n.op === '-' || n.op === '/') return `${wrap(n.a, PREC[n.op])} ${n.op} ${wrap(n.b, PREC[n.op], true)}`;
      return `${wrap(n.a, PREC[n.op])} ${n.op} ${wrap(n.b, PREC[n.op])}`;
    case 'big':
    case 'diff':
      throw new MathReadError('This expression needs working out before it can be used.');
  }
}

/** Visit every node of a tree. */
export function walk(n: MathNode, visit: (n: MathNode) => void): void {
  visit(n);
  switch (n.k) {
    case 'neg': case 'fact': walk(n.a, visit); break;
    case 'bin': walk(n.a, visit); walk(n.b, visit); break;
    case 'call': n.args.forEach((a) => walk(a, visit)); break;
    case 'big': walk(n.body, visit); walk(n.lo, visit); walk(n.hi, visit); break;
    case 'diff': walk(n.body, visit); break;
    default: break;
  }
}

/** Rebuild a tree, replacing nodes for which `f` returns something. */
export function mapNode(n: MathNode, f: (n: MathNode) => MathNode | undefined): MathNode {
  const r = f(n);
  if (r) return r;
  switch (n.k) {
    case 'neg': return { k: 'neg', a: mapNode(n.a, f) };
    case 'fact': return { k: 'fact', a: mapNode(n.a, f) };
    case 'bin': return { k: 'bin', op: n.op, a: mapNode(n.a, f), b: mapNode(n.b, f) };
    case 'call': return { k: 'call', fn: n.fn, args: n.args.map((a) => mapNode(a, f)) };
    case 'big': return { ...n, body: mapNode(n.body, f), lo: mapNode(n.lo, f), hi: mapNode(n.hi, f) };
    case 'diff': return { ...n, body: mapNode(n.body, f) };
    default: return n;
  }
}

const BUILT_IN = new Set(['pi', 'e', 'Infinity']);

/** The variables a tree refers to, leaving out constants and the counters of sums and integrals. */
export function freeSymbols(n: MathNode, bound: ReadonlySet<string> = new Set()): Set<string> {
  const out = new Set<string>();
  const go = (x: MathNode, b: ReadonlySet<string>) => {
    switch (x.k) {
      case 'sym': if (!b.has(x.name) && !BUILT_IN.has(x.name)) out.add(x.name); break;
      case 'neg': case 'fact': go(x.a, b); break;
      case 'bin': go(x.a, b); go(x.b, b); break;
      case 'call': x.args.forEach((a) => go(a, b)); break;
      case 'big': go(x.lo, b); go(x.hi, b); go(x.body, new Set([...b, x.bound])); break;
      case 'diff': go(x.body, b); out.add(x.bound); break;
      default: break;
    }
  };
  go(n, bound);
  return out;
}

/** Functions a tree calls that are not built in — the ones a notebook must have defined. */
export function calledFunctions(n: MathNode): Set<string> {
  const builtin = new Set([...Object.values(FUNCTIONS), ...Object.values(INVERSE), 'nthRoot', 'log']);
  const out = new Set<string>();
  walk(n, (x) => { if (x.k === 'call' && !builtin.has(x.fn)) out.add(x.fn); });
  return out;
}
