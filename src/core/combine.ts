/**
 * Two readings of one handwritten line, made into one.
 *
 * The model shipped with the app looks at a picture of the line. It understands
 * layout (fractions, roots, exponents, limits) and Greek letters, and writes
 * LaTeX; it is poor at digits. A text recogniser working from the pen strokes
 * is the other way round: good at digits and plain symbols, knows nothing of
 * layout, and writes plain text. So the model's reading gives the structure,
 * and where the two disagree about a single symbol, the one that is better at
 * that kind of symbol is believed.
 */
import { parseLatex } from './latexMath';

type Kind = 'digit' | 'letter' | 'greek' | 'fn' | 'op' | 'other';
interface Sym { kind: Kind; v: string; start: number; end: number }

const GREEK_NAMES = [
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi',
  'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega', 'pi',
  'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega',
  'varepsilon', 'vartheta', 'varphi', 'varrho', 'varsigma',
];
const GREEK = new Set(GREEK_NAMES);
const GREEK_CHARS: Record<string, string> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ζ: 'zeta', η: 'eta', θ: 'theta', ι: 'iota', κ: 'kappa',
  λ: 'lambda', μ: 'mu', µ: 'mu', ν: 'nu', ξ: 'xi', ρ: 'rho', σ: 'sigma', τ: 'tau', υ: 'upsilon', φ: 'phi', χ: 'chi',
  ψ: 'psi', ω: 'omega', π: 'pi', Γ: 'Gamma', Δ: 'Delta', Θ: 'Theta', Λ: 'Lambda', Ξ: 'Xi', Π: 'Pi', Σ: 'Sigma',
  Φ: 'Phi', Ψ: 'Psi', Ω: 'Omega', ϑ: 'theta', ϕ: 'phi',
};
const FUNCTION_NAMES = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'exp', 'ln', 'log', 'lg', 'lim', 'max', 'min']);
/** Commands that arrange what follows them and are not themselves a written symbol. */
const STRUCTURAL = new Set(['frac', 'dfrac', 'tfrac', 'sqrt', 'left', 'right', 'mathrm', 'text', 'operatorname', 'limits', 'displaystyle', 'mathbf', 'mathit']);
const COMMAND_CHARS: Record<string, string> = {
  int: '∫', sum: 'Σ', prod: 'Π', infty: '∞', times: '×', cdot: '·', div: '÷', to: '→', rightarrow: '→', rarr: '→', pm: '±', partial: '∂',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', ne: '≠', approx: '≈',
};
const SUPERSCRIPTS: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-', 'ⁿ': 'n', 'ˣ': 'x' };
const SAME_OP: Record<string, string> = { '−': '-', '–': '-', '—': '-', '*': '·', '∗': '·', '⋅': '·', '∑': 'Σ', '∏': 'Π' };

/** The written symbols of a LaTeX reading, in order, each with its place in the text. */
function latexSymbols(src: string): Sym[] {
  const out: Sym[] = [];
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (/\s/.test(c) || '{}^_&$'.includes(c)) { i++; continue; }
    if (c === '\\') {
      const m = /^\\([A-Za-z]+)/.exec(src.slice(i));
      if (!m) { i += 2; continue; }
      const name = m[1];
      const end = i + m[0].length;
      if (GREEK.has(name)) out.push({ kind: 'greek', v: name.replace(/^var/, ''), start: i, end });
      // A function name is written letter by letter, and that is how the other reading will have it.
      else if (FUNCTION_NAMES.has(name)) for (const ch of name) out.push({ kind: 'fn', v: ch, start: i, end });
      else if (!STRUCTURAL.has(name)) out.push({ kind: 'other', v: COMMAND_CHARS[name] ?? `\\${name}`, start: i, end });
      i = end;
      continue;
    }
    const kind: Kind = /[0-9]/.test(c) ? 'digit' : /[A-Za-z]/.test(c) ? 'letter' : 'op';
    out.push({ kind, v: c, start: i, end: i + 1 });
    i++;
  }
  return out;
}

/** The written symbols of a plain-text reading. Marks that only say how symbols are laid out are left out. */
function textSymbols(text: string, skipSlash: boolean): Sym[] {
  const out: Sym[] = [];
  let i = 0;
  for (const raw of text) {
    const at = i;
    i += raw.length;
    if (/\s/.test(raw) || raw === '^' || raw === '_' || raw === '√' || (raw === '/' && skipSlash)) continue;
    const c = SUPERSCRIPTS[raw] ?? SAME_OP[raw] ?? raw;
    const kind: Kind = /[0-9]/.test(c) ? 'digit' : /[A-Za-z]/.test(c) ? 'letter' : GREEK_CHARS[c] ? 'greek' : 'op';
    out.push({ kind, v: GREEK_CHARS[c] ?? c, start: at, end: i });
  }
  return out;
}

const same = (a: Sym, b: Sym): boolean => {
  const letterish = (s: Sym) => s.kind === 'letter' || s.kind === 'fn';
  if (letterish(a) && letterish(b)) return a.v.toLowerCase() === b.v.toLowerCase();
  if (a.kind === 'greek' || b.kind === 'greek') return a.kind === b.kind && a.v === b.v;
  return a.v === b.v;
};

type Step = { m: number; a: number } | { m: number; a: null } | { m: null; a: number };

/** Line the two sequences up with as few changes as possible. */
function align(model: Sym[], apple: Sym[]): Step[] {
  const n = model.length, k = apple.length;
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: k + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= k; j++) {
      d[i][j] = Math.min(d[i - 1][j - 1] + (same(model[i - 1], apple[j - 1]) ? 0 : 1), d[i - 1][j] + 1, d[i][j - 1] + 1);
    }
  }
  const steps: Step[] = [];
  for (let i = n, j = k; i > 0 || j > 0;) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (same(model[i - 1], apple[j - 1]) ? 0 : 1)) { steps.push({ m: --i, a: --j }); }
    else if (i > 0 && d[i][j] === d[i - 1][j] + 1) steps.push({ m: --i, a: null });
    else steps.push({ m: null, a: --j });
  }
  return steps.reverse();
}

/** Plain text from a text recogniser, as LaTeX the scratchpad can read. */
export function textToLatex(text: string): string {
  let s = text.replace(/\s+/g, ' ').trim();
  // A stray underscore between a number and a letter is the recogniser's, not the writer's.
  s = s.replace(/(\d)_(?=[A-Za-z])/g, '$1');
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿˣ]+/g, (run) => `^{${[...run].map((c) => SUPERSCRIPTS[c]).join('')}}`);
  s = s.replace(/√\s*(\([^()]*\)|\d+(?:\.\d+)?|[A-Za-z])/g, (_, inner: string) => `\\sqrt{${inner.replace(/^\((.*)\)$/, '$1')}}`);
  s = s.replace(/(^|[^\w.)}])(\d+)\s*\/\s*(\d+)(?![\w.({])/g, '$1\\frac{$2}{$3}');
  s = [...s].map((c) => (GREEK_CHARS[c] ? `\\${GREEK_CHARS[c]} ` : c === '∞' ? '\\infty ' : c === '×' ? '\\times ' : c === '÷' ? '\\div ' : SAME_OP[c] === '-' ? '-' : c === '·' || c === '⋅' ? '\\cdot ' : c)).join('');
  return s.replace(/\s+/g, ' ').trim();
}

const reads = (latex: string): boolean => {
  try { parseLatex(latex); return true; } catch { return false; }
};
const squash = (s: string) => s.replace(/\s+/g, '');

export interface Combined {
  /** The reading to use. */
  latex: string;
  /** A second opinion that differs, for the writer to choose if the first is wrong. */
  other?: string;
}

/** The names (letters and Greek letters) used in lines of LaTeX: what is already on the page. */
export function namesIn(lines: string[]): Set<string> {
  const names = new Set<string>();
  for (const line of lines) for (const s of latexSymbols(line)) if (s.kind === 'letter' || s.kind === 'greek') names.add(s.v);
  return names;
}

/**
 * Combine the model's LaTeX reading of a line with a text recogniser's.
 * `known` holds the names already used elsewhere on the page: a letter the
 * page already uses is not readily given up for a digit.
 */
export function combineReadings(model: string, text: string, known: ReadonlySet<string> = new Set()): Combined {
  const fromText = textToLatex(text);
  if (!text.trim()) return { latex: model };
  if (!model.trim()) return { latex: fromText };

  const m = latexSymbols(model);
  const a = textSymbols(text, /\\[dt]?frac(?![A-Za-z])/.test(model));
  const steps = align(m, a);
  const pairs = steps.filter((s): s is { m: number; a: number } => s.m !== null && s.a !== null);
  const matches = pairs.filter((p) => same(m[p.m], a[p.a])).length;
  const isKnown = (s: Sym) => known.has(s.v) || known.has(s.v.toLowerCase());
  const isName = (s: Sym) => s.kind === 'letter' || s.kind === 'greek';
  const lastM = m.length - 1;

  /** What the model's symbol should be changed to, if the text reading is to be believed here. */
  const change = (ms: Sym, as: Sym, mi: number): string | null => {
    if (as.kind === 'digit' && ms.kind === 'digit') return as.v;
    if (as.kind === 'digit' && isName(ms) && !isKnown(ms)) return as.v;
    if (as.v === '=' && isName(ms) && !isKnown(ms) && mi === lastM && !model.includes('=')) return '=';
    return null;
  };
  /** A disagreement of a kind the two readings are known to have, whichever is right. */
  const expected = (ms: Sym, as: Sym, mi: number) => change(ms, as, mi) !== null || (isName(ms) && as.kind === 'letter');

  const differing = pairs.filter((p) => !same(m[p.m], a[p.a]));
  const sameShape = pairs.length === steps.length && differing.every((p) => expected(m[p.m], a[p.a], p.m));
  const mostlyAgree = matches >= 0.6 * Math.max(m.length, a.length);

  let merged = model;
  if (sameShape || mostlyAgree) {
    const edits = differing
      .map((p) => ({ sym: m[p.m], to: change(m[p.m], a[p.a], p.m) }))
      .filter((e): e is { sym: Sym; to: string } => e.to !== null)
      .sort((x, y) => y.sym.start - x.sym.start);
    for (const e of edits) merged = `${merged.slice(0, e.sym.start)}${e.to}${/[A-Za-z]/.test(merged[e.sym.end] ?? '') && e.sym.kind === 'greek' ? ' ' : ''}${merged.slice(e.sym.end)}`;
    // The model tends to drop an "=" written at the end of a line, which is what asks for the answer.
    const tail = steps[steps.length - 1];
    if (tail && tail.m === null && a[tail.a].v === '=' && !merged.includes('=')) merged = `${merged} =`;
  }

  // If the result cannot be read as mathematics and the text reading can, the text reading it is.
  const latex = !reads(merged) && reads(fromText) ? fromText : merged;
  const other = [model, fromText].find((c) => squash(c) !== squash(latex) && reads(c));
  return other ? { latex, other } : { latex };
}
