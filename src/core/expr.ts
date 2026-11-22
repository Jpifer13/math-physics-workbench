/**
 * A tiny symbolic expression tree. The graph engine builds one of these
 * alongside each numeric result so a flow can be shown as a typeset equation.
 */

export type Ex =
  | { t: 'sym'; latex: string; val?: string }
  | { t: 'num'; v: number }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Ex; b: Ex }
  | { t: 'neg'; a: Ex }
  | { t: 'fn'; name: string; args: Ex[] };

export const sym = (latex: string, val?: string): Ex => ({ t: 'sym', latex, val });
export const num = (v: number): Ex => ({ t: 'num', v });
export const bin = (op: '+' | '-' | '*' | '/' | '^', a: Ex, b: Ex): Ex => ({ t: 'bin', op, a, b });
export const fn = (name: string, ...args: Ex[]): Ex => ({ t: 'fn', name, args });
export const neg = (a: Ex): Ex => ({ t: 'neg', a });

const GREEK = new Set([
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa',
  'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega',
  'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Phi', 'Psi', 'Omega', 'hbar',
]);

/** Turn a plain identifier like `v_0`, `theta` or `lambda_max` into LaTeX. */
export function symbolToLatex(s: string): string {
  const name = s.trim();
  if (!name) return '?';
  const [head, ...rest] = name.split('_');
  const piece = (p: string) => (GREEK.has(p) ? `\\${p}` : p.length > 1 && /^[A-Za-z]+$/.test(p) ? `\\mathrm{${p}}` : p);
  const m = /^([A-Za-z]+?)(\d+)$/.exec(head);
  if (!rest.length && m) return `${piece(m[1])}_{${m[2]}}`;
  const base = piece(head);
  if (!rest.length) return base;
  return `${base}_{${rest.map((r) => (GREEK.has(r) ? `\\${r}` : r.length > 1 ? `\\mathrm{${r}}` : r)).join(',')}}`;
}

const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 };
const precOf = (e: Ex): number => (e.t === 'bin' ? PREC[e.op] : e.t === 'neg' ? 3 : 9);

const FN_LATEX: Record<string, string> = {
  sin: '\\sin', cos: '\\cos', tan: '\\tan', asin: '\\arcsin', acos: '\\arccos', atan: '\\arctan',
  sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh', ln: '\\ln', log: '\\ln', log10: '\\log_{10}',
  min: '\\min', max: '\\max', atan2: '\\operatorname{atan2}',
};

function fmtNumber(v: number): string {
  if (!Number.isFinite(v)) return '\\infty';
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) {
    const [m, e] = v.toExponential(3).split('e');
    const mant = String(parseFloat(m));
    return mant === '1' ? `10^{${parseInt(e, 10)}}` : `${mant}\\times 10^{${parseInt(e, 10)}}`;
  }
  return String(parseFloat(v.toPrecision(6)));
}

export interface LatexOpts {
  /** Replace symbols by their numeric values (with units). */
  substitute?: boolean;
}

export function toLatex(e: Ex, opts: LatexOpts = {}): string {
  const wrap = (x: Ex, minPrec: number) => {
    const s = toLatex(x, opts);
    return precOf(x) < minPrec ? `\\left(${s}\\right)` : s;
  };
  switch (e.t) {
    case 'sym':
      return opts.substitute && e.val !== undefined ? `\\left(${e.val}\\right)` : e.latex;
    case 'num':
      return fmtNumber(e.v);
    case 'neg':
      return `-${wrap(e.a, 3)}`;
    case 'fn': {
      if (e.name === 'sqrt') return `\\sqrt{${toLatex(e.args[0], opts)}}`;
      if (e.name === 'cbrt') return `\\sqrt[3]{${toLatex(e.args[0], opts)}}`;
      if (e.name === 'abs') return `\\left|${toLatex(e.args[0], opts)}\\right|`;
      if (e.name === 'exp') return `e^{${toLatex(e.args[0], opts)}}`;
      const name = FN_LATEX[e.name] ?? `\\operatorname{${e.name}}`;
      return `${name}\\left(${e.args.map((a) => toLatex(a, opts)).join(',\\,')}\\right)`;
    }
    case 'bin': {
      const { op, a, b } = e;
      if (op === '/') return `\\frac{${toLatex(a, opts)}}{${toLatex(b, opts)}}`;
      if (op === '^') {
        // Function calls and anything non-atomic get parentheses before the exponent.
        const baseAtomic = (a.t === 'sym' && !(opts.substitute && a.val !== undefined)) || (a.t === 'num' && a.v >= 0 && Number.isInteger(a.v));
        const base = baseAtomic || (a.t === 'sym') ? toLatex(a, opts) : `\\left(${toLatex(a, opts)}\\right)`;
        return `${base}^{${toLatex(b, opts)}}`;
      }
      if (op === '+') return `${wrap(a, 1)} + ${wrap(b, 1)}`;
      if (op === '-') return `${wrap(a, 1)} - ${wrap(b, 2)}`;
      // Multiplication: juxtapose symbols, use a dot when a number is on the right.
      const left = wrap(a, 2);
      const right = wrap(b, 2);
      const rightStartsNumeric = b.t === 'num' || (b.t === 'bin' && b.op === '^' && b.a.t === 'num') || (b.t === 'bin' && b.op === '*' && startsNumeric(b));
      return rightStartsNumeric ? `${left} \\cdot ${right}` : `${left}\\,${right}`;
    }
  }
}

function startsNumeric(e: Ex): boolean {
  if (e.t === 'num') return true;
  if (e.t === 'bin' && (e.op === '*' || e.op === '^')) return startsNumeric(e.a);
  return false;
}
