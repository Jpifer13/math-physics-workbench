import { describe, expect, it } from 'vitest';
import { fitModel, interpolate, invert, nelderMead, parseTable, profileFit, residuals, runsTest } from './fit';
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
    const fit = fitModel({ model, params: ['k', 'b'], targets: [{ observable: 'x', ...{ t, y } }] });
    expect(fit.values.k).toBeCloseTo(4.3, 1);
    expect(fit.values.b).toBeCloseTo(0.22, 1);
    expect(fit.targets[0].after.rms).toBeLessThan(0.02);
    expect(fit.targets[0].after.rms).toBeLessThan(fit.targets[0].before.rms / 10);
    expect(fit.targets[0].after.r2).toBeGreaterThan(0.99);
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
    const fit = fitModel({ model, params: ['k', 'b'], targets: [{ observable: 'x', ...noisy(4.3, 0.22) }] });
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
    const fit = fitModel({ model: degenerate, params: ['a', 'c'], targets: [{ observable: 'x', ...noisy(4.3, 0.5) }] });
    const r = fit.correlation[0][1];
    expect(Number.isNaN(r) || r < -0.99).toBe(true);
    expect(fit.values.a * fit.values.c).toBeCloseTo(4.3, 1);
  });
  it('escapes the local minima of oscillating data by surveying the range first', () => {
    // Far from the truth the model slips whole cycles out of phase with the data.
    const far = { ...model, tEnd: 30, params: [{ ...model.params[0], value: 7.5 }, { ...model.params[1], value: 0.05 }] };
    const truth = simulate(far, { k: 4.3, b: 0.05 });
    const data = { t: truth.t.filter((_, i) => i % 6 === 0), y: truth.series.x.filter((_, i) => i % 6 === 0) };
    const local = fitModel({ model: far, params: ['k'], targets: [{ observable: 'x', ...data }], survey: false });
    const global = fitModel({ model: far, params: ['k'], targets: [{ observable: 'x', ...data }] });
    expect(Math.abs(local.values.k - 4.3)).toBeGreaterThan(0.5);
    expect(global.values.k).toBeCloseTo(4.3, 3);
    expect(global.targets[0].after.rms).toBeLessThan(1e-3);
  });
  it('respects bounds when asked to', () => {
    const tight = { ...model, params: [{ ...model.params[0], min: 2, max: 3.5 }, model.params[1]] };
    const fit = fitModel({ model: tight, params: ['k', 'b'], targets: [{ observable: 'x', ...noisy(4.3, 0.22) }], bounded: true });
    expect(fit.values.k).toBeLessThanOrEqual(3.5);
    expect(fit.values.k).toBeGreaterThan(3.3);
  });
  it('fits several observables together and uses error bars', () => {
    // Position alone barely constrains the damping over a short record; velocity data add to it.
    const truth = simulate(model, { k: 4.3, b: 0.22 });
    const pick = (arr: number[]) => arr.filter((_, i) => i % 8 === 0);
    const noise = (i: number, s: number) => s * Math.sin(i * 12.9898) * Math.cos(i * 78.233);
    const t = pick(truth.t);
    const x = pick(truth.series.x).map((v, i) => v + noise(i, 0.01));
    const v = pick(truth.series.v).map((val, i) => val + noise(i + 7, 0.05));
    const both = fitModel({
      model, params: ['k', 'b'],
      targets: [{ observable: 'x', t, y: x, sigma: t.map(() => 0.007) }, { observable: 'v', t, y: v, sigma: t.map(() => 0.035) }],
    });
    expect(both.values.k).toBeCloseTo(4.3, 1);
    expect(both.values.b).toBeCloseTo(0.22, 1);
    expect(both.targets.map((r) => r.observable)).toEqual(['x', 'v']);
    expect(both.targets[1].after.rms).toBeLessThan(both.targets[1].before.rms / 5);
    // Honest error bars give a reduced chi-squared near one, and absolute uncertainties.
    expect(both.reducedChi2!).toBeGreaterThan(0.3);
    expect(both.reducedChi2!).toBeLessThan(3);
    expect(Math.abs(both.values.k - 4.3)).toBeLessThan(5 * both.errors.k);
    // Without error bars there is no chi-squared to report.
    expect(fitModel({ model, params: ['k'], targets: [{ observable: 'x', t, y: x }] }).reducedChi2).toBeUndefined();
  });
  it('profiles agree with the linear uncertainty when the problem is well behaved', () => {
    const data = noisy(4.3, 0.22);
    const request = { model, params: ['k', 'b'], targets: [{ observable: 'x', ...data }] };
    const fit = fitModel(request);
    const profiles = profileFit({ ...request, values: fit.values, errors: fit.errors }, 13);
    expect(profiles.map((p) => p.param)).toEqual(['k', 'b']);
    for (const p of profiles) {
      const [lo, hi] = p.interval;
      expect(lo, p.param).not.toBeNull();
      expect(hi, p.param).not.toBeNull();
      // The misfit is lowest at the fitted value and the interval brackets it.
      expect(Math.min(...p.delta)).toBeLessThan(0.05);
      expect(lo!).toBeLessThan(fit.values[p.param]);
      expect(hi!).toBeGreaterThan(fit.values[p.param]);
      const half = (hi! - lo!) / 2;
      expect(half / fit.errors[p.param], p.param).toBeGreaterThan(0.6);
      expect(half / fit.errors[p.param], p.param).toBeLessThan(1.6);
      expect(p.secondMinimum).toBe(false);
    }
  });
  it('profiles a single parameter without re-fitting anything', () => {
    const data = noisy(4.3, 0.22);
    const request = { model: { ...model, params: [model.params[0], { ...model.params[1], value: 0.22 }] }, params: ['k'], targets: [{ observable: 'x', ...data }] };
    const fit = fitModel(request);
    const [p] = profileFit({ ...request, values: fit.values, errors: fit.errors }, 11);
    expect(p.interval[0]!).toBeLessThan(fit.values.k);
    expect(p.interval[1]!).toBeGreaterThan(fit.values.k);
  });
  it('detects structure in residuals that a wrong model leaves behind', () => {
    // Genuinely random-looking noise (a seeded generator), since the test is about randomness of signs.
    let seed = 12345;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const truth = simulate(model, { k: 4.3, b: 0.22 });
    const t = truth.t.filter((_, i) => i % 4 === 0);
    const y = truth.series.x.filter((_, i) => i % 4 === 0).map((v) => v + 0.02 * (rand() - 0.5));
    const data = { t, y };
    expect(Math.abs(runsTest(residuals(truth, 'x', data).residuals))).toBeLessThan(3);
    expect(runsTest(residuals(simulate(model, { k: 4.3, b: 0.6 }), 'x', data).residuals)).toBeLessThan(-5);
    expect(runsTest([1, -1, 1])).toBeNaN();
  });
  it('inverts small matrices and detects singular ones', () => {
    expect(invert([[2, 0], [0, 4]])).toEqual([[0.5, 0], [0, 0.25]]);
    expect(invert([[1, 2], [2, 4]])).toBeNull();
  });
  it('explains why a fit cannot run', () => {
    expect(() => fitModel({ model, params: [], targets: [{ observable: 'x', t: [0, 1, 2], y: [1, 0, 1] }] })).toThrow(/at least one/);
    expect(() => fitModel({ model, params: ['k'], targets: [{ observable: 'nope', t: [0, 1, 2], y: [1, 0, 1] }] })).toThrow(/no values/);
  });
});
