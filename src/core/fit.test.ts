import { describe, expect, it } from 'vitest';
import { fitModel, interpolate, invert, nelderMead, parseTable } from './fit';
import { simulate, type OdeModel } from './ode';

const model: OdeModel = {
  id: 'damped', name: 'Damped oscillator', summary: '',
  states: [
    { name: 'x', init: '1', deriv: 'v' },
    { name: 'v', init: '0', deriv: '-k*x - b*v' },
  ],
  params: [
    { name: 'k', value: 3, min: 0, max: 10 },
    { name: 'b', value: 0.5, min: 0, max: 2 },
  ],
  derived: [], tEnd: 15, dt: 0.01, method: 'rk45', tol: 1e-8, timeSeries: ['x'], phase: ['x', 'v'],
};

describe('data import', () => {
  it('parses headers, delimiters, comments and decimal commas', () => {
    const a = parseTable('# run 7\ntime (s), x (m)\n0, 1.0\n0.1, 0.98\n0.2, 0.93\nbad,row\n');
    expect(a.map((c) => c.name)).toEqual(['time (s)', 'x (m)']);
    expect(a[1].values).toEqual([1, 0.98, 0.93]);
    expect(parseTable('0 1\n1 2\n2 3')[0].name).toBe('column 1');
    expect(parseTable('t;x\n0;1,5\n1;2,5\n2;3,5')[1].values).toEqual([1.5, 2.5, 3.5]);
    expect(() => parseTable('just text')).toThrow();
  });
  it('interpolates, and refuses to extrapolate', () => {
    expect(interpolate([0, 1, 3], [0, 10, 30], 2)).toBe(20);
    expect(interpolate([0, 1, 3], [0, 10, 30], 3)).toBe(30);
    expect(interpolate([0, 1, 3], [0, 10, 30], 4)).toBeNaN();
  });
});

describe('optimiser', () => {
  it('minimises the Rosenbrock function', () => {
    const r = nelderMead(([x, y]) => (1 - x) ** 2 + 100 * (y - x * x) ** 2, [-1.2, 1], [0.5, 0.5], 2000, 1e-14);
    expect(r.x[0]).toBeCloseTo(1, 3);
    expect(r.x[1]).toBeCloseTo(1, 3);
  });
});

describe('model fitting', () => {
  it('recovers the parameters that generated noisy data', () => {
    const truth = simulate(model, { k: 4.3, b: 0.22 });
    // Deterministic pseudo-noise, ~1% of the amplitude.
    const t: number[] = [], y: number[] = [];
    for (let i = 0; i < truth.t.length; i += 8) {
      t.push(truth.t[i]);
      y.push(truth.series.x[i] + 0.01 * Math.sin(i * 12.9898) * Math.cos(i * 78.233));
    }
    const fit = fitModel({ model, params: ['k', 'b'], observable: 'x', data: { t, y } });
    expect(fit.values.k).toBeCloseTo(4.3, 1);
    expect(fit.values.b).toBeCloseTo(0.22, 1);
    expect(fit.after.rms).toBeLessThan(0.02);
    expect(fit.after.rms).toBeLessThan(fit.before.rms / 10);
    expect(fit.after.r2).toBeGreaterThan(0.99);
  });
  const noisy = (k: number, b: number) => {
    const truth = simulate(model, { k, b });
    const t: number[] = [], y: number[] = [];
    for (let i = 0; i < truth.t.length; i += 8) {
      t.push(truth.t[i]);
      y.push(truth.series.x[i] + 0.01 * Math.sin(i * 12.9898) * Math.cos(i * 78.233));
    }
    return { t, y };
  };
  it('reports uncertainties that bracket the truth, and correlations', () => {
    const fit = fitModel({ model, params: ['k', 'b'], observable: 'x', data: noisy(4.3, 0.22) });
    expect(fit.errors.k).toBeGreaterThan(0);
    expect(fit.errors.k).toBeLessThan(0.05);
    expect(Math.abs(fit.values.k - 4.3)).toBeLessThan(5 * fit.errors.k);
    expect(Math.abs(fit.values.b - 0.22)).toBeLessThan(5 * fit.errors.b);
    expect(fit.correlation[0][0]).toBeCloseTo(1);
    expect(Math.abs(fit.correlation[0][1])).toBeLessThan(0.9);
  });
  it('flags parameters the data cannot separate', () => {
    // Only the product k = a * c enters the dynamics, so a and c are perfectly anticorrelated.
    const degenerate = { ...model, states: [model.states[0], { ...model.states[1], deriv: '-a*c*x - b*v' }], params: [{ name: 'a', value: 2, min: 0, max: 10 }, { name: 'c', value: 1.5, min: 0, max: 10 }, model.params[1]] };
    const fit = fitModel({ model: degenerate, params: ['a', 'c'], observable: 'x', data: noisy(4.3, 0.5) });
    const r = fit.correlation[0][1];
    expect(Number.isNaN(r) || r < -0.99).toBe(true);
    expect(fit.values.a * fit.values.c).toBeCloseTo(4.3, 1);
  });
  it('escapes the local minima of oscillating data by surveying the range first', () => {
    // Far from the truth the model slips whole cycles out of phase with the data.
    const far = { ...model, tEnd: 30, params: [{ ...model.params[0], value: 7.5 }, { ...model.params[1], value: 0.05 }] };
    const truth = simulate(far, { k: 4.3, b: 0.05 });
    const data = { t: truth.t.filter((_, i) => i % 6 === 0), y: truth.series.x.filter((_, i) => i % 6 === 0) };
    const local = fitModel({ model: far, params: ['k'], observable: 'x', data, survey: false });
    const global = fitModel({ model: far, params: ['k'], observable: 'x', data });
    expect(Math.abs(local.values.k - 4.3)).toBeGreaterThan(0.5);
    expect(global.values.k).toBeCloseTo(4.3, 3);
    expect(global.after.rms).toBeLessThan(1e-3);
  });
  it('respects bounds when asked to', () => {
    const tight = { ...model, params: [{ ...model.params[0], min: 2, max: 3.5 }, model.params[1]] };
    const fit = fitModel({ model: tight, params: ['k', 'b'], observable: 'x', data: noisy(4.3, 0.22), bounded: true });
    expect(fit.values.k).toBeLessThanOrEqual(3.5);
    expect(fit.values.k).toBeGreaterThan(3.3);
  });
  it('inverts small matrices and detects singular ones', () => {
    expect(invert([[2, 0], [0, 4]])).toEqual([[0.5, 0], [0, 0.25]]);
    expect(invert([[1, 2], [2, 4]])).toBeNull();
  });
  it('explains why a fit cannot run', () => {
    expect(() => fitModel({ model, params: [], observable: 'x', data: { t: [0, 1, 2], y: [1, 0, 1] } })).toThrow(/at least one/);
    expect(() => fitModel({ model, params: ['k'], observable: 'nope', data: { t: [0, 1, 2], y: [1, 0, 1] } })).toThrow(/no values/);
  });
});
