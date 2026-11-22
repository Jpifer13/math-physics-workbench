import { describe, expect, it } from 'vitest';
import { symbolsOf, toLatex, toText } from './expr';
import { evaluate, linspace, sweep, type Graph } from './graph';
import { findExtrema, findRoots, integrate } from './numeric';
import { simulate, type OdeModel } from './ode';
import { baseUnitString, dim, dimName, fmtNum, formatQuantity, fromUnit, siUnitFor, toUnit } from './units';

const emc2: Graph = {
  nodes: [
    { id: 'm', kind: 'quantity', data: { label: 'Mass', symbol: 'm', value: 1, unit: 'kg' } },
    { id: 'c', kind: 'constant', data: { constId: 'c' } },
    { id: 'sq', kind: 'op', data: { op: 'square' } },
    { id: 'mul', kind: 'op', data: { op: 'mul' } },
    { id: 'E', kind: 'output', data: { label: 'Energy', symbol: 'E', unit: '' } },
  ],
  edges: [
    { source: 'c', target: 'sq', port: 'x' },
    { source: 'm', target: 'mul', port: 'a' },
    { source: 'sq', target: 'mul', port: 'b' },
    { source: 'mul', target: 'E', port: 'in' },
  ],
};

describe('units', () => {
  it('converts between units', () => {
    expect(toUnit(fromUnit(36, 'km/h'), 'm/s')).toBeCloseTo(10);
    expect(toUnit(fromUnit(1, 'eV'), 'J')).toBeCloseTo(1.602176634e-19, 30);
    expect(() => toUnit(fromUnit(1, 'kg'), 'm')).toThrow();
  });
  it('names dimensions and units', () => {
    expect(siUnitFor(dim(1, 2, -2))).toBe('J');
    expect(dimName(dim(1, 1, -2))).toBe('force');
    expect(baseUnitString(dim(-1, 3, -2))).toBe('m³/(kg·s²)');
    expect(baseUnitString(dim(0, 0, -1))).toBe('s⁻¹');
    expect(baseUnitString(dim(0, 0.5))).toBe('m¹ᐟ²');
  });
  it('formats numbers', () => {
    expect(fmtNum(8.987551787e16)).toBe('8.9876×10¹⁶');
    expect(fmtNum(0.5)).toBe('0.5');
    expect(fmtNum(-1234.5)).toBe('−1234.5');
  });
});

describe('graph engine', () => {
  it('evaluates E = mc² with units and LaTeX', () => {
    const r = evaluate(emc2).get('E')!;
    expect(r.error).toBeUndefined();
    expect(r.q!.v).toBeCloseTo(8.987551787e16, -8);
    expect(formatQuantity(r.q!).unit).toBe('J');
    expect(toLatex(r.ex!)).toBe('m\\,c^{2}');
    expect(toText(r.ex!)).toBe('m * c^2');
    expect(symbolsOf(r.ex!).map((s) => [s.name, s.si, s.unit])).toEqual([['m', 1, 'kg'], ['c', 299792458, 'm/s']]);
  });
  it('reports dimension mismatches', () => {
    const g: Graph = {
      nodes: [
        { id: 'a', kind: 'quantity', data: { label: 'a', symbol: 'a', value: 1, unit: 'kg' } },
        { id: 'b', kind: 'quantity', data: { label: 'b', symbol: 'b', value: 1, unit: 'm' } },
        { id: 'add', kind: 'op', data: { op: 'add' } },
        { id: 'o', kind: 'output', data: { label: 'o', symbol: 'o', unit: '' } },
      ],
      edges: [
        { source: 'a', target: 'add', port: 'a' },
        { source: 'b', target: 'add', port: 'b' },
        { source: 'add', target: 'o', port: 'in' },
      ],
    };
    const r = evaluate(g);
    expect(r.get('add')!.error).toMatch(/Cannot add mass and length/);
    expect(r.get('o')!.upstream).toBe(true);
  });
  it('flags unconnected inputs and loops', () => {
    const g: Graph = {
      nodes: [
        { id: 'x', kind: 'op', data: { op: 'square' } },
        { id: 'y', kind: 'op', data: { op: 'sqrt' } },
        { id: 'z', kind: 'op', data: { op: 'sin' } },
      ],
      edges: [
        { source: 'x', target: 'y', port: 'x' },
        { source: 'y', target: 'x', port: 'x' },
      ],
    };
    const r = evaluate(g);
    expect(r.get('z')!.error).toMatch(/not connected/);
    expect(r.get('x')!.error).toBeDefined();
  });
  it('evaluates formula nodes with unit checking', () => {
    const g: Graph = {
      nodes: [
        { id: 'v', kind: 'quantity', data: { label: 'Speed', symbol: 'v_0', value: 20, unit: 'm/s' } },
        { id: 'th', kind: 'quantity', data: { label: 'Angle', symbol: 'theta', value: 45, unit: 'deg' } },
        { id: 'g', kind: 'constant', data: { constId: 'g' } },
        { id: 'f', kind: 'formula', data: { label: 'Range', expr: 'v^2 * sin(2*theta) / g' } },
      ],
      edges: [
        { source: 'v', target: 'f', port: 'v' },
        { source: 'th', target: 'f', port: 'theta' },
        { source: 'g', target: 'f', port: 'g' },
      ],
    };
    const r = evaluate(g).get('f')!;
    expect(r.q!.v).toBeCloseTo(400 / 9.80665, 6);
    expect(siUnitFor(r.q!.d)).toBe('m');
    expect(toLatex(r.ex!)).toBe('\\frac{v_{0}^{2}\\,\\sin\\left(2\\,\\theta\\right)}{g}');
    expect(toText(r.ex!)).toBe('v_0^2 * sin(2 * theta) / g');
  });
  it('sweeps an input', () => {
    const s = sweep(emc2, 'E', 'm', linspace(0, 2, 3));
    expect(s.y[0]).toBe(0);
    expect(s.y[2] / s.y[1]).toBeCloseTo(2);
  });
});

describe('numeric', () => {
  it('integrates, finds roots and extrema', () => {
    expect(integrate(Math.sin, 0, Math.PI)).toBeCloseTo(2, 8);
    const roots = findRoots((x) => x * x - 2, -3, 3);
    expect(roots.map((r) => +r.toFixed(6))).toEqual([-1.414214, 1.414214]);
    expect(findRoots(Math.tan, 1, 2)).toEqual([]);
    const ex = findExtrema((x) => (x - 1) ** 2, -3, 3);
    expect(ex[0].x).toBeCloseTo(1, 4);
    expect(ex[0].kind).toBe('min');
  });
});

describe('ode', () => {
  const sho: OdeModel = {
    id: 'sho', name: 'SHO', summary: '',
    states: [
      { name: 'x', init: 'x0', deriv: 'v' },
      { name: 'v', init: '0', deriv: '-k/m*x' },
    ],
    params: [
      { name: 'k', value: 4, min: 0, max: 10 },
      { name: 'm', value: 1, min: 0, max: 10 },
      { name: 'x0', value: 1, min: 0, max: 10 },
    ],
    derived: [{ name: 'E', expr: '0.5*m*v^2 + 0.5*k*x^2' }],
    tEnd: Math.PI, dt: 0.001, timeSeries: ['x'], phase: ['x', 'v'],
  };
  it('integrates a harmonic oscillator accurately', () => {
    const r = simulate(sho);
    expect(r.error).toBeUndefined();
    // Period is π for ω = 2, so x returns to x0.
    expect(r.series.x.at(-1)!).toBeCloseTo(1, 6);
    expect(r.series.E.at(-1)!).toBeCloseTo(2, 8);
  });
  it('honours stop conditions and reports bad expressions', () => {
    expect(simulate({ ...sho, stopWhen: 'x < 0' }).t.at(-1)!).toBeCloseTo(Math.PI / 4, 2);
    expect(simulate({ ...sho, states: [{ name: 'x', init: '1', deriv: 'nope(' }] }).error).toBeDefined();
  });
});
