import { describe, expect, it } from 'vitest';
import { MathReadError, parseLatex, toMathText } from './latexMath';
import { simulate } from './ode';
import { evaluateNotebook } from './scratch';

const text = (latex: string) => toMathText(parseLatex(latex).lhs);

describe('reading LaTeX', () => {
  it('reads arithmetic, fractions, roots and powers', () => {
    expect(text('1 + 2 \\times 3')).toBe('1 + 2 * 3');
    expect(text('\\frac{a+b}{2c}')).toBe('(a + b) / (2 * c)');
    expect(text('\\frac12')).toBe('1 / 2');
    expect(text('\\sqrt{x^2 + y^2}')).toBe('sqrt(x^2 + y^2)');
    expect(text('\\sqrt[3]{8}')).toBe('nthRoot(8, 3)');
    expect(text('-x^2')).toBe('-x^2');
    expect(text('(a-b)-(c-d)')).toBe('a - b - (c - d)');
    expect(text('e^{-t/\\tau}')).toBe('e^(-t / tau)');
    expect(text('2^{3^2}')).toBe('2^3^2');
    expect(text('\\left(x+1\\right)^{2}')).toBe('(x + 1)^2');
  });

  it('treats adjacent things as a product', () => {
    expect(text('2x')).toBe('2 * x');
    expect(text('m c^2')).toBe('m * c^2');
    expect(text('2(x+1)(x-1)')).toBe('2 * (x + 1) * (x - 1)');
    expect(text('3\\pi r^2')).toBe('3 * pi * r^2');
  });

  it('reads names with subscripts, Greek letters and accents', () => {
    expect(text('v_0 + \\omega_{0} t')).toBe('v_0 + omega_0 * t');
    expect(text('v_{max}')).toBe('v_max');
    expect(text('\\bar{x}')).toBe('x_bar');
    expect(text('\\varphi')).toBe('phi');
  });

  it('reads functions the way they are written by hand', () => {
    expect(text('\\sin 2x')).toBe('sin(2 * x)');
    expect(text('\\sin x \\cos x')).toBe('sin(x) * cos(x)');
    expect(text('\\sin(x) y')).toBe('sin(x) * y');
    expect(text('\\sin^2 \\theta')).toBe('sin(theta)^2');
    expect(text('\\sin^{-1} x')).toBe('asin(x)');
    expect(text('\\ln x + \\log x + \\log_2 8')).toBe('log(x) + log10(x) + log(8, 2)');
    expect(text('sin x')).toBe('sin(x)');
    expect(text('|x - 1|')).toBe('abs(x - 1)');
    expect(text('30^\\circ')).toBe('30 * pi / 180');
  });

  it('reads time derivatives in every common notation', () => {
    expect(text('\\dot{x} + \\ddot{x}')).toBe('x_dot + x_ddot');
    expect(text("y' + y''")).toBe('y_dot + y_ddot');
    expect(text('\\frac{dx}{dt}')).toBe('x_dot');
    expect(text('\\frac{d^2\\theta}{dt^2}')).toBe('theta_ddot');
    expect(text('\\dot{x}_1')).toBe('x_1_dot');
  });

  it('recognises the kinds of line', () => {
    expect(parseLatex('3 + 4 =')).toMatchObject({ kind: 'expr', wantsValue: true });
    expect(parseLatex('x = 3')).toMatchObject({ kind: 'equation' });
    expect(parseLatex('f(x) = x^2')).toMatchObject({ kind: 'function', name: 'f', param: 'x' });
    expect(parseLatex('x(0) = 1')).toMatchObject({ kind: 'initial', name: 'x' });
    expect(parseLatex('\\dot{x}(0) = 2')).toMatchObject({ kind: 'initial', name: 'x_dot' });
  });

  it('explains what it cannot read', () => {
    for (const bad of ['', '2 +', '(x + 1', '\\frac{1}{', 'x < 3', '\\int x dx', '\\lim x', 'x_{a+b}', '1 = 2 = 3']) {
      expect(() => parseLatex(bad), bad).toThrow(MathReadError);
    }
  });

  it('never passes written text through to an expression', () => {
    // Anything that is not a recognised construct is refused rather than copied.
    for (const bad of ['\\evil{x}', 'x; y', 'a "b"', '`x`', 'x \\\\ y']) {
      expect(() => toMathText(parseLatex(bad).lhs), bad).toThrow(MathReadError);
    }
    expect(text('\\operatorname{foo}')).toBe('foo');
  });
});

describe('the notebook', () => {
  const run = (...lines: string[]) => evaluateNotebook(lines);
  const value = (...lines: string[]) => run(...lines).lines.at(-1)!;

  it('works out arithmetic', () => {
    expect(value('3 + 4 \\times 2 =').value).toBe(11);
    expect(value('\\frac{1}{2} + \\frac{1}{3}').value).toBeCloseTo(5 / 6, 12);
    expect(value('\\sqrt{16} + 5! - \\sqrt[3]{-8}').value).toBe(126);
    expect(value('\\sin \\frac{\\pi}{2} + e^0').value).toBeCloseTo(2, 12);
    expect(value('3 + 4 =').tex).toBe('= 7');
  });

  it('uses variables defined anywhere on the page', () => {
    expect(value('m = 2', 'g = 9.81', 'F = m g', '\\frac{F}{2} =').value).toBeCloseTo(9.81, 12);
    // Order does not matter: the formula can come first.
    const nb = run('F = m a', 'm = 2', 'a = 3', 'F =');
    expect(nb.lines[0]).toMatchObject({ kind: 'defined', value: 6, tex: '= 6' });
    expect(nb.lines[3].value).toBe(6);
  });

  it('says what is missing', () => {
    expect(value('F = m a')).toMatchObject({ kind: 'waiting', message: 'Needs a value for m and a.' });
    expect(value('x + y = 3').kind).toBe('waiting');
  });

  it('solves an equation with one unknown', () => {
    expect(value('2x + 3 = 11')).toMatchObject({ kind: 'solved', value: 4 });
    const quad = value('x^2 - 5x + 6 = 0');
    expect(quad.tex).toBe('x = 2\\ \\text{or}\\ x = 3');
    expect(value('x^2 = -1').kind).toBe('waiting');
    expect(value('\\cos x = x').value).toBeCloseTo(0.7390851332, 9);
    expect(value('k = 4', 'm = 1', '\\omega^2 m = k', '\\omega').kind).toBe('symbolic'); // two roots, so ω stays unknown
    // A single root becomes a value later lines can use.
    expect(value('3t = 12', 't^2 =').value).toBe(16);
  });

  it('checks an equation with nothing unknown', () => {
    expect(value('2 + 2 = 4').tex).toBe('\\checkmark');
    expect(value('2 + 2 = 5').message).toMatch(/not equal/);
  });

  it('takes look-alike capital and small letters to be the same when only one has a value', () => {
    const nb = run('X = 4', '3x + 1 =');
    expect(nb.lines[1].value).toBe(13);
    expect(nb.lines[1].message).toMatch(/x and X to be the same letter/);
    // Both given values: they are different quantities and stay so.
    expect(value('V = 10', 'v = 2', 'V v =').value).toBe(20);
    // Letters that do not look alike are never merged.
    expect(value('A = 4', '3a + 1 =').kind).toBe('symbolic');
  });

  it('defines and uses functions', () => {
    expect(value('f(x) = x^2 + 1', 'f(3) =').value).toBe(10);
    expect(run('f(2) + 1 =', 'f(x) = 3x').lines[0].value).toBe(7); // used above its definition
  });

  it('works out sums, products and definite integrals', () => {
    expect(value('\\sum_{n=1}^{100} n').value).toBe(5050);
    expect(value('\\prod_{k=1}^{5} k').value).toBe(120);
    expect(value('\\int_0^1 x^2 \\, dx').value).toBeCloseTo(1 / 3, 9);
    expect(value('\\int_{0}^{\\pi} \\sin x \\, dx').value).toBeCloseTo(2, 9);
    expect(value('\\int_{-\\infty}^{\\infty} e^{-x^2} dx').value).toBeCloseTo(Math.sqrt(Math.PI), 5);
    expect(value('a = 2', '\\int_0^a 3x^2 + 1 \\mathrm{d}x').value).toBeCloseTo(10, 9);
    expect(value('\\sum_{n=1}^{\\infty} \\frac{1}{n^2}').kind).toBe('error');
  });

  it('differentiates, symbolically where there is no value', () => {
    expect(value('\\frac{d}{dx} x^3').tex).toBe('= 3\\,x^{2}');
    expect(value('x = 2', '\\frac{d}{dx} x^3 =').value).toBeCloseTo(12, 9);
    expect(value('2x + 3x').tex).toBe('= 5\\,x');
  });

  it('reports mistakes in plain language', () => {
    expect(value('2 +')).toMatchObject({ kind: 'error' });
    expect(value('2 +').message).not.toMatch(/Error|undefined|token/i);
    expect(value('\\sqrt{-4}').message).toBe('This has no real value.');
  });
});

describe('turning written equations into a simulation', () => {
  it('builds a harmonic oscillator that integrates correctly', () => {
    const nb = evaluateNotebook(['m = 2', 'k = 8', 'm \\ddot{x} = -k x', 'x(0) = 1', '\\dot{x}(0) = 0']);
    expect(nb.lines[2].kind).toBe('equation');
    const model = nb.model!;
    expect(model.states).toEqual([
      { name: 'x', init: '1', deriv: 'x_dot' },
      { name: 'x_dot', init: '0', deriv: expect.any(String) },
    ]);
    expect(model.params.map((p) => [p.name, p.value])).toEqual([['k', 8], ['m', 2]]);
    expect(nb.modelNotes).toEqual([]);
    const run = simulate({ ...model, tEnd: 3 });
    expect(run.error).toBeUndefined();
    // ω = √(k/m) = 2, so x(t) = cos 2t.
    expect(run.series.x.at(-1)!).toBeCloseTo(Math.cos(6), 5);
  });

  it('keeps an equation already solved for its derivative as written', () => {
    const nb = evaluateNotebook(['\\frac{dN}{dt} = -\\lambda N', 'N(0) = 100', '\\lambda = 0.5']);
    expect(nb.model!.states).toEqual([{ name: 'N', init: '100', deriv: '-lambda * N' }]);
    const run = simulate({ ...nb.model!, tEnd: 2 });
    expect(run.series.N.at(-1)!).toBeCloseTo(100 * Math.exp(-1), 4);
  });

  it('handles coupled equations and says what it assumed', () => {
    const nb = evaluateNotebook(["x' = \\alpha x - \\beta x y", "y' = \\delta x y - \\gamma y"]);
    expect(nb.model!.states.map((s) => s.name)).toEqual(['x', 'y']);
    expect(nb.model!.params.map((p) => p.name).sort()).toEqual(['alpha', 'beta', 'delta', 'gamma']);
    expect(nb.modelNotes.some((n) => n.includes('alpha has no value'))).toBe(true);
    expect(simulate(nb.model!).error).toBeUndefined();
  });

  it('inlines functions defined on the page', () => {
    const nb = evaluateNotebook(['V(x) = x^3', '\\ddot{x} = -V(x)']);
    expect(nb.model!.states[1].deriv).toBe('-x^3');
  });

  it('explains why a set of equations cannot be simulated', () => {
    expect(evaluateNotebook(['\\dot{x} = y']).model).not.toBeNull(); // y is simply a parameter
    const missing = evaluateNotebook(['\\dot{x} = \\dot{y}']);
    expect(missing.model).toBeNull();
    expect(missing.modelNotes[0]).toMatch(/no equation for how y changes/);
    const nonlinear = evaluateNotebook(['\\dot{x}^2 = x']);
    expect(nonlinear.model).toBeNull();
    expect(nonlinear.modelNotes[0]).toMatch(/not linear/);
  });

  it('writes model expressions only from its own syntax tree', () => {
    const nb = evaluateNotebook(['\\dot{x} = -\\operatorname{foo} x']);
    for (const s of nb.model!.states) expect(s.deriv).toMatch(/^[A-Za-z0-9_+\-*/^(). ,]*$/);
  });
});
