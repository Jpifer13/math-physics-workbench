import { describe, expect, it } from 'vitest';
import type { OdeModel, UncertainInput } from './ode';
import {
  histogram, inputProblem, inputValue, latinHypercube, makeDesign, overridesOf, probit, quantile, quantileBands,
  resample, runSample, seededRandom, sobolIndices, spread, totalRuns,
} from './sensitivity';

const uniform = (param: string, a: number, b: number): UncertainInput => ({ param, dist: 'uniform', a, b });

/** Measure a plain function over a design, in place of running a model. */
const evaluate = (inputs: UncertainInput[], n: number, f: (x: number[]) => number, seed = 7) => {
  const design = makeDesign(inputs, n, seed);
  return { design, values: design.points.map(f) };
};

describe('sampling', () => {
  it('draws the same design for the same seed and a different one otherwise', () => {
    const inputs = [uniform('a', 0, 1), uniform('b', 2, 3)];
    expect(makeDesign(inputs, 32, 5).points).toEqual(makeDesign(inputs, 32, 5).points);
    expect(makeDesign(inputs, 32, 6).points).not.toEqual(makeDesign(inputs, 32, 5).points);
  });

  it('puts exactly one Latin hypercube point in each slice of every axis', () => {
    const n = 50;
    const points = latinHypercube(n, 3, seededRandom(1));
    for (let k = 0; k < 3; k++) {
      const slices = points.map((p) => Math.floor(p[k] * n)).sort((a, b) => a - b);
      expect(slices).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });

  it('inverts the normal distribution', () => {
    expect(probit(0.5)).toBeCloseTo(0, 9);
    expect(probit(0.975)).toBeCloseTo(1.959963985, 7);
    expect(probit(0.001)).toBeCloseTo(-3.090232306, 7);
    expect(inputValue({ param: 'm', dist: 'normal', a: 10, b: 2 }, 0.8413447461)).toBeCloseTo(12, 6);
    expect(inputValue(uniform('m', 4, 8), 0.25)).toBe(5);
  });

  it('reproduces the requested mean and spread of each input', () => {
    const design = makeDesign([{ param: 'm', dist: 'normal', a: 10, b: 2 }, uniform('k', 0, 6)], 2000, 3);
    const m = spread(design.points.slice(0, 4000).map((p) => p[0]));
    const k = spread(design.points.slice(0, 4000).map((p) => p[1]));
    expect(m.mean).toBeCloseTo(10, 1);
    expect(m.sd).toBeCloseTo(2, 1);
    expect(k.mean).toBeCloseTo(3, 1);
    expect(k.sd).toBeCloseTo(6 / Math.sqrt(12), 1);
  });

  it('lays the design out in blocks and names the parameters', () => {
    const design = makeDesign([uniform('a', 0, 1), uniform('b', 0, 1), uniform('c', 0, 1)], 16, 1);
    expect(design.points).toHaveLength(totalRuns(16, 3));
    expect(totalRuns(16, 3)).toBe(16 * 5);
    // Block 2 + i is sample A with input i taken from sample B.
    const [a, b, ab1] = [design.points[3], design.points[16 + 3], design.points[3 * 16 + 3]];
    expect(ab1).toEqual([a[0], b[1], a[2]]);
    expect(Object.keys(overridesOf(design)[0])).toEqual(['a', 'b', 'c']);
    // One input needs no extra blocks.
    expect(makeDesign([uniform('a', 0, 1)], 16, 1).points).toHaveLength(32);
    expect(totalRuns(16, 1)).toBe(32);
  });

  it('explains an input that cannot be sampled', () => {
    expect(inputProblem(uniform('a', 1, 2))).toBe('');
    expect(inputProblem(uniform('a', 2, 2))).toMatch(/greater than/);
    expect(inputProblem({ param: 'a', dist: 'normal', a: 1, b: 0 })).toMatch(/standard deviation/);
    expect(inputProblem({ param: 'a', dist: 'normal', a: NaN, b: 1 })).toMatch(/needed/);
  });
});

describe('Sobol indices', () => {
  it('matches the exact indices of the Ishigami function', () => {
    // The standard benchmark: strongly nonlinear, with an x1–x3 interaction and no first-order effect of x3.
    const inputs = ['x1', 'x2', 'x3'].map((p) => uniform(p, -Math.PI, Math.PI));
    const { values, design } = evaluate(inputs, 4096, ([x1, x2, x3]) => Math.sin(x1) + 7 * Math.sin(x2) ** 2 + 0.1 * x3 ** 4 * Math.sin(x1));
    const r = sobolIndices(values, design.n, 3)!;
    const exactFirst = [0.3139, 0.4424, 0];
    const exactTotal = [0.5576, 0.4424, 0.2437];
    r.indices.forEach((s, i) => {
      expect(Math.abs(s.first - exactFirst[i])).toBeLessThan(0.04);
      expect(Math.abs(s.total - exactTotal[i])).toBeLessThan(0.04);
      // The interval is honest: it contains the exact value (with a little slack for the 5% it should miss).
      expect(exactFirst[i]).toBeGreaterThan(s.firstLo - 0.03);
      expect(exactFirst[i]).toBeLessThan(s.firstHi + 0.03);
      expect(s.totalHi - s.totalLo).toBeLessThan(0.15);
    });
    expect(r.variance).toBeCloseTo(13.845, 0);
  });

  it('gives first-order equal to total, summing to one, for an additive function', () => {
    const { values, design } = evaluate([uniform('a', 0, 1), uniform('b', 0, 1)], 2048, ([a, b]) => 5 + a + 2 * b);
    const r = sobolIndices(values, design.n, 2)!;
    expect(r.indices[0].first).toBeCloseTo(0.2, 1);
    expect(r.indices[1].first).toBeCloseTo(0.8, 1);
    expect(r.indices[0].total).toBeCloseTo(0.2, 1);
    expect(r.indices[1].total).toBeCloseTo(0.8, 1);
  });

  it('sees a pure interaction that one-at-a-time variation would miss', () => {
    // f = a·b about zero: neither input does anything alone, together they do everything.
    const { values, design } = evaluate([uniform('a', -1, 1), uniform('b', -1, 1)], 2048, ([a, b]) => a * b);
    const r = sobolIndices(values, design.n, 2)!;
    for (const s of r.indices) {
      expect(Math.abs(s.first)).toBeLessThan(0.06);
      expect(s.total).toBeGreaterThan(0.9);
    }
  });

  it('ignores an input the measurement does not depend on', () => {
    const { values, design } = evaluate([uniform('a', 0, 1), uniform('unused', 0, 1)], 1024, ([a]) => a * a);
    const r = sobolIndices(values, design.n, 2)!;
    expect(r.indices[1].total).toBeCloseTo(0, 6);
    expect(r.indices[0].total).toBeCloseTo(1, 1);
  });

  it('drops rows with failed runs and reports how many were used', () => {
    const { values, design } = evaluate([uniform('a', 0, 1), uniform('b', 0, 1)], 512, ([a, b]) => a + 2 * b);
    values[5] = NaN; // sample A, row 5
    values[2 * 512 + 9] = NaN; // A with input 1 from B, row 9
    const r = sobolIndices(values, design.n, 2)!;
    expect(r.rows).toBe(510);
    expect(r.indices[1].first).toBeCloseTo(0.8, 1);
  });

  it('declines when there is nothing to apportion', () => {
    const flat = evaluate([uniform('a', 0, 1), uniform('b', 0, 1)], 64, () => 3);
    expect(sobolIndices(flat.values, 64, 2)).toBeNull();
    const one = evaluate([uniform('a', 0, 1)], 64, ([a]) => a);
    expect(sobolIndices(one.values, 64, 1)).toBeNull();
    const broken = evaluate([uniform('a', 0, 1), uniform('b', 0, 1)], 64, () => NaN);
    expect(sobolIndices(broken.values, 64, 2)).toBeNull();
  });
});

describe('summaries', () => {
  it('summarises a sample and counts failed runs', () => {
    const s = spread([1, 2, 3, 4, 5, NaN]);
    expect(s.count).toBe(5);
    expect(s.failed).toBe(1);
    expect(s.mean).toBe(3);
    expect(s.median).toBe(3);
    expect(s.sd).toBeCloseTo(Math.sqrt(2.5), 12);
    expect([s.min, s.max]).toEqual([1, 5]);
    expect(quantile([0, 10], 0.25)).toBe(2.5);
  });

  it('reads asymmetric intervals off a skewed sample', () => {
    const random = seededRandom(2);
    const s = spread(Array.from({ length: 20000 }, () => Math.exp(probit(random()))));
    // Log-normal: median 1, and the 68% interval is e^-1 … e^1, far from symmetric.
    expect(s.median).toBeCloseTo(1, 1);
    expect(s.lo68).toBeCloseTo(Math.exp(-0.9945), 1);
    expect(s.hi68).toBeCloseTo(Math.exp(0.9945), 1);
    expect(s.hi68 - s.median).toBeGreaterThan(2 * (s.median - s.lo68));
  });

  it('bins a histogram without losing values', () => {
    const h = histogram([0, 0.1, 0.5, 0.9, 1, NaN], 2);
    expect(h.edges).toEqual([0, 0.5, 1]);
    expect(h.counts).toEqual([2, 3]);
    const same = histogram([4, 4, 4]);
    expect(same.counts.reduce((a, b) => a + b, 0)).toBe(3);
    expect(histogram([]).counts).toEqual([]);
  });

  it('resamples onto an even grid and leaves times the run did not reach empty', () => {
    expect(resample([0, 1, 4], [0, 10, 40], 4, 4)).toEqual([0, 10, 20, 30, 40]);
    const short = resample([0, 1, 2], [0, 1, 2], 4, 4);
    expect(short.slice(0, 3)).toEqual([0, 1, 2]);
    expect(short.slice(3).every(Number.isNaN)).toBe(true);
    // A jump (two samples at the same time, as an event leaves) does not divide by zero.
    expect(resample([0, 1, 1, 2], [0, 1, 5, 6], 2, 2)).toEqual([0, 1, 6]);
  });

  it('takes quantiles across an ensemble, leaving out times most runs did not reach', () => {
    const traces = [[0, 1, NaN], [0, 2, NaN], [0, 3, 9], [0, 4, NaN]];
    const [lo, mid, hi] = quantileBands(traces, [0, 0.5, 1]);
    expect(lo.slice(0, 2)).toEqual([0, 1]);
    expect(mid[1]).toBe(2.5);
    expect(hi[1]).toBe(4);
    expect(Number.isNaN(mid[2])).toBe(true);
  });
});

describe('on a model', () => {
  const decay: OdeModel = {
    id: 'decay', name: 'Decay', summary: '',
    states: [{ name: 'x', init: 'x0', deriv: '-k * x' }],
    params: [{ name: 'x0', value: 1, min: 0, max: 2 }, { name: 'k', value: 1, min: 0, max: 2 }],
    derived: [], tEnd: 1, dt: 0.01, method: 'rk4', timeSeries: ['x'], phase: ['x', 'x'],
  };

  it('propagates input uncertainty to the exact answer for x0·exp(−k·t)', () => {
    // x(1) = x0·e^(−k) with x0 ~ N(1, 0.1) and k ~ N(1, 0.1): mean e^(−1+0.005), variance known in closed form.
    const inputs: UncertainInput[] = [{ param: 'x0', dist: 'normal', a: 1, b: 0.1 }, { param: 'k', dist: 'normal', a: 1, b: 0.1 }];
    const design = makeDesign(inputs, 512, 11);
    const samples = overridesOf(design).map((o, i) => runSample(decay, o, 'x', 'final', i < design.n ? { points: 20, span: 1 } : undefined));
    const values = samples.map((s) => s.value);
    const s = spread(values.slice(0, 2 * design.n));
    const mean = Math.exp(-1 + 0.005);
    const variance = (1 + 0.01) * Math.exp(-2 + 0.02) - mean * mean;
    expect(s.mean).toBeCloseTo(mean, 2);
    expect(s.sd).toBeCloseTo(Math.sqrt(variance), 2);

    // To first order the two inputs contribute equally (same relative uncertainty, same sensitivity at t = 1).
    const sobol = sobolIndices(values, design.n, 2)!;
    expect(sobol.indices[0].first).toBeCloseTo(0.5, 1);
    expect(sobol.indices[1].first).toBeCloseTo(0.5, 1);

    // Traces come only where asked, on the even grid, and their final value is the measurement.
    expect(samples[0].trace).toHaveLength(21);
    expect(samples[0].trace!.at(-1)).toBeCloseTo(samples[0].value, 9);
    expect(samples[design.n].trace).toBeUndefined();
    const [median] = quantileBands(samples.slice(0, design.n).map((x) => x.trace!), [0.5]);
    expect(median[0]).toBeCloseTo(1, 2);
    expect(median[20]).toBeCloseTo(Math.exp(-1), 2);
  });

  it('reports a failed run as no measurement rather than throwing', () => {
    const r = runSample({ ...decay, states: [{ name: 'x', init: 'x0', deriv: 'nope * x' }] }, {}, 'x', 'final', { points: 10, span: 1 });
    expect(Number.isNaN(r.value)).toBe(true);
    expect(r.trace).toBeUndefined();
  });
});
