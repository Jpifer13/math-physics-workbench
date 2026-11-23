import { describe, expect, it } from 'vitest';
import { hasCalculus, symbolsOf, toLatex, toText } from './expr';
import { evaluate, inputPorts, sweep, type CalculusData, type GEdge, type GNode } from './graph';
import { dimName } from './units';

const quantity = (id: string, value: number, unit = '', symbol = id): GNode => ({ id, kind: 'quantity', data: { label: id, symbol, value, unit } });
const calc = (data: Omit<CalculusData, 'label'>): GNode => ({ id: 'c', kind: 'calculus', data: { label: 'Block', ...data } });
const wire = (source: string, port: string): GEdge => ({ source, target: 'c', port });

/** A calculus block with the given inputs wired to quantities; returns its result. */
function run(data: Omit<CalculusData, 'label'>, inputs: Record<string, [number, string?]>) {
  const nodes = [calc(data), ...Object.entries(inputs).map(([port, [value, unit]]) => quantity(`in_${port}`, value, unit ?? '', port === 'from' || port === 'to' || port === 'at' ? `${port}_0` : port))];
  const edges = Object.keys(inputs).map((port) => wire(`in_${port}`, port));
  return evaluate({ nodes, edges }).get('c')!;
}

describe('calculus blocks', () => {
  it('have their own ports, then one for each other name in the expression', () => {
    expect(inputPorts(calc({ op: 'integral', expr: 'k * x', variable: 'x' }))).toEqual(['from', 'to', 'k']);
    expect(inputPorts(calc({ op: 'sum', expr: '1 / n^2', variable: 'n' }))).toEqual(['from', 'to']);
    expect(inputPorts(calc({ op: 'derivative', expr: 'a * x^2', variable: 'x' }))).toEqual(['at', 'a']);
    expect(inputPorts(calc({ op: 'limit', expr: 'sin(x) / x', variable: 'x' }))).toEqual(['at']);
  });

  it('integrate', () => {
    expect(run({ op: 'integral', expr: 'x^2', variable: 'x' }, { from: [0], to: [1] }).q!.v).toBeCloseTo(1 / 3, 9);
    expect(run({ op: 'integral', expr: 'sin(x)', variable: 'x' }, { from: [0], to: [Math.PI] }).q!.v).toBeCloseTo(2, 7);
    // Limits the other way round change the sign.
    expect(run({ op: 'integral', expr: 'x', variable: 'x' }, { from: [2], to: [0] }).q!.v).toBeCloseTo(-2, 9);
  });

  it('carry units: a force integrated over a distance is an energy', () => {
    const r = run({ op: 'integral', expr: 'k * x', variable: 'x' }, { from: [0, 'm'], to: [0.1, 'm'], k: [200, 'N/m'] });
    expect(r.error).toBeUndefined();
    expect(r.q!.v).toBeCloseTo(1, 9);
    expect(dimName(r.q!.d)).toBe('energy');
    // A speed differentiated against time is an acceleration.
    const a = run({ op: 'derivative', expr: 'v0 * t / T', variable: 't' }, { at: [2, 's'], v0: [10, 'm/s'], T: [1, 's'] });
    expect(a.q!.v).toBeCloseTo(10, 6);
    expect(dimName(a.q!.d)).toBe('acceleration');
  });

  it('refuse limits that do not match, and integrands with no value', () => {
    expect(run({ op: 'integral', expr: 'x', variable: 'x' }, { from: [0, 'm'], to: [1, 's'] }).error).toMatch(/same units/);
    expect(run({ op: 'integral', expr: '1 / x', variable: 'x' }, { from: [-1], to: [1] }).error).toMatch(/no finite value at x = 0/);
    // Units are still checked inside the expression.
    expect(run({ op: 'integral', expr: 'x + k', variable: 'x' }, { from: [0, 'm'], to: [1, 'm'], k: [1, 's'] }).error).toBeTruthy();
  });

  it('sum and multiply over whole numbers', () => {
    expect(run({ op: 'sum', expr: 'n', variable: 'n' }, { from: [1], to: [100] }).q!.v).toBe(5050);
    expect(run({ op: 'sum', expr: '1 / n^2', variable: 'n' }, { from: [1], to: [10000] }).q!.v).toBeCloseTo(Math.PI ** 2 / 6, 3);
    expect(run({ op: 'product', expr: 'n', variable: 'n' }, { from: [1], to: [5] }).q!.v).toBe(120);
    expect(run({ op: 'sum', expr: 'n', variable: 'n' }, { from: [1], to: [2.5] }).error).toMatch(/whole number/);
    expect(run({ op: 'sum', expr: 'n', variable: 'n' }, { from: [5], to: [1] }).error).toMatch(/ends before it starts/);
    expect(run({ op: 'sum', expr: 'n', variable: 'n' }, { from: [1, 'm'], to: [3] }).error).toMatch(/without units/);
    expect(run({ op: 'sum', expr: 'n', variable: 'n' }, { from: [1], to: [1e7] }).error).toMatch(/more than/);
  });

  it('differentiate', () => {
    expect(run({ op: 'derivative', expr: 'x^3', variable: 'x' }, { at: [2] }).q!.v).toBeCloseTo(12, 7);
    expect(run({ op: 'derivative', expr: 'sin(x)', variable: 'x' }, { at: [0] }).q!.v).toBeCloseTo(1, 9);
    // A point that is tiny in SI units still gets a sensible step.
    expect(run({ op: 'derivative', expr: 'x^2', variable: 'x' }, { at: [1e-9] }).q!.v).toBeCloseTo(2e-9, 15);
  });

  it('find limits, including where the expression has no value', () => {
    expect(run({ op: 'limit', expr: 'sin(x) / x', variable: 'x' }, { at: [0] }).q!.v).toBe(1);
    expect(run({ op: 'limit', expr: '(1 - cos(x)) / x^2', variable: 'x' }, { at: [0] }).q!.v).toBeCloseTo(0.5, 6);
    expect(run({ op: 'limit', expr: '(x^2 - 1) / (x - 1)', variable: 'x' }, { at: [1] }).q!.v).toBeCloseTo(2, 6);
    // Where the expression is continuous the limit is its value, exactly.
    expect(run({ op: 'limit', expr: 'x^2 + 1', variable: 'x' }, { at: [3] }).q!.v).toBe(10);
    // Defined on one side only.
    expect(run({ op: 'limit', expr: 'sqrt(x)', variable: 'x' }, { at: [0] }).q!.v).toBe(0);
  });

  it('say so when there is no limit', () => {
    expect(run({ op: 'limit', expr: '1 / x', variable: 'x' }, { at: [0] }).error).toMatch(/does not settle/);
    expect(run({ op: 'limit', expr: 'abs(x) / x', variable: 'x' }, { at: [0] }).error).toMatch(/-1 from below and 1 from above/);
    expect(run({ op: 'limit', expr: 'sin(1 / x)', variable: 'x' }, { at: [0] }).error).toMatch(/does not settle/);
  });

  it('explain what is missing', () => {
    expect(run({ op: 'integral', expr: 'x', variable: 'x' }, { from: [0] }).error).toMatch(/"to" is not connected/);
    expect(run({ op: 'integral', expr: '', variable: 'x' }, { from: [0], to: [1] }).error).toMatch(/Type the expression/);
    expect(run({ op: 'integral', expr: 'x', variable: '' }, { from: [0], to: [1] }).error).toMatch(/Name the variable/);
    expect(run({ op: 'integral', expr: 'x * to', variable: 'x' }, { from: [0], to: [1] }).error).toMatch(/own inputs/);
  });

  it('are written as mathematics', () => {
    const integral = run({ op: 'integral', expr: 'k * x', variable: 'x' }, { from: [0, 'm'], to: [0.1, 'm'], k: [200, 'N/m'] }).ex!;
    expect(toLatex(integral)).toBe('\\int_{\\mathrm{from}_{0}}^{\\mathrm{to}_{0}} k\\,x\\,\\mathrm{d}x');
    expect(toText(integral)).toBe('integral(k * x, x, from_0, to_0)');
    expect(hasCalculus(integral)).toBe(true);
    // The block's own variable is not one of the flow's symbols.
    expect(symbolsOf(integral).map((s) => s.name)).toEqual(['k', 'from_0', 'to_0']);
    expect(toLatex(run({ op: 'sum', expr: 'n + 1', variable: 'n' }, { from: [1], to: [3] }).ex!)).toBe('\\sum_{n=\\mathrm{from}_{0}}^{\\mathrm{to}_{0}} \\left(n + 1\\right)');
    expect(toLatex(run({ op: 'limit', expr: 'sin(x) / x', variable: 'x' }, { at: [0] }).ex!)).toBe('\\lim_{x\\to \\mathrm{at}_{0}} \\frac{\\sin\\left(x\\right)}{x}');
    expect(toLatex(run({ op: 'derivative', expr: 'x^3', variable: 'x' }, { at: [2] }).ex!)).toContain('\\frac{\\mathrm{d}}{\\mathrm{d}x}');
  });

  it('can be swept like any other block', () => {
    const nodes = [calc({ op: 'integral', expr: 'x', variable: 'x' }), quantity('a', 0), quantity('b', 1)];
    const edges = [wire('a', 'from'), wire('b', 'to')];
    expect(sweep({ nodes, edges }, 'c', 'b', [0, 1, 2]).y.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0, 0.5, 2]);
  });
});
