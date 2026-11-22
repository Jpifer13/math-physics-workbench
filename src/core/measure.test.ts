import { describe, expect, it } from 'vitest';
import { measure, scan, toCsv } from './measure';
import { sampleIndex, simulate, type OdeModel } from './ode';

const sho: OdeModel = {
  id: 'sho', name: 'SHO', summary: '',
  states: [
    { name: 'x', init: 'x0', deriv: 'v' },
    { name: 'v', init: '0', deriv: '(-k*x - b*v + F0*cos(wd*t))/m' },
  ],
  params: [
    { name: 'k', value: 4, min: 0, max: 10 },
    { name: 'm', value: 1, min: 0, max: 10 },
    { name: 'b', value: 0, min: 0, max: 10 },
    { name: 'F0', value: 0, min: 0, max: 10 },
    { name: 'wd', value: 1, min: 0, max: 10 },
    { name: 'x0', value: 1, min: 0, max: 10 },
  ],
  derived: [{ name: 'E', expr: '0.5*m*v^2 + 0.5*k*x^2' }],
  tEnd: 20, dt: 0.002, timeSeries: ['x'], phase: ['x', 'v'],
};

describe('solvers', () => {
  it('adaptive RK45 meets its tolerance with far fewer steps than RK4', () => {
    const exact = Math.cos(2 * 20);
    const rk45 = simulate({ ...sho, method: 'rk45', tol: 1e-9 });
    const rk4 = simulate({ ...sho, method: 'rk4' });
    expect(rk45.error).toBeUndefined();
    expect(Math.abs(rk45.series.x.at(-1)! - exact)).toBeLessThan(1e-6);
    expect(rk45.t.at(-1)!).toBeCloseTo(20, 9);
    expect(rk45.stats!.steps).toBeLessThan(rk4.stats!.steps);
    expect(rk45.stats!.evals).toBeGreaterThan(0);
  });
  it('orders the methods by accuracy: Euler ≪ RK4', () => {
    const exact = Math.cos(40);
    const err = (method: 'euler' | 'rk4') => Math.abs(simulate({ ...sho, method }).series.x.at(-1)! - exact);
    expect(err('rk4')).toBeLessThan(1e-8);
    expect(err('euler')).toBeGreaterThan(1e-3);
  });
  it('rejects clashing or invalid names', () => {
    expect(simulate({ ...sho, derived: [{ name: 'x', expr: '1' }] }).error).toMatch(/more than once/);
    expect(simulate({ ...sho, params: [...sho.params, { name: 't', value: 1, min: 0, max: 1 }] }).error).toMatch(/reserved/);
  });
  it('finds samples by time on uneven grids', () => {
    expect(sampleIndex([0, 0.1, 0.5, 2], 0.6)).toBe(2);
    expect(sampleIndex([0, 0.1, 0.5, 2], 99)).toBe(3);
    expect(sampleIndex([], 1)).toBe(0);
  });
});

describe('measurements', () => {
  const run = simulate({ ...sho, method: 'rk45' });
  const m = (id: Parameters<typeof measure>[2]) => measure(run.t, run.series.x, id);
  it('measures an undamped oscillation', () => {
    expect(m('period')).toBeCloseTo(Math.PI, 4);
    expect(m('amplitude')).toBeCloseTo(1, 3);
    expect(m('max')).toBeCloseTo(1, 6);
    expect(m('min')).toBeCloseTo(-1, 3);
    expect(m('rms')).toBeCloseTo(Math.SQRT1_2, 2);
    expect(m('duration')).toBeCloseTo(20, 9);
    expect(measure(run.t, run.series.E, 'mean')).toBeCloseTo(2, 6);
  });
});

describe('parameter scans', () => {
  it('finds resonance of a driven, damped oscillator at ω ≈ √(k/m)', () => {
    const model = { ...sho, tEnd: 80, dt: 0.01, params: sho.params.map((p) => (p.name === 'b' ? { ...p, value: 0.4 } : p.name === 'F0' ? { ...p, value: 1 } : p.name === 'x0' ? { ...p, value: 0 } : p)) };
    const r = scan(model, { param: 'wd', from: 1, to: 3, points: 21, observable: 'x', measure: 'amplitude' });
    const peak = r.x[r.y.indexOf(Math.max(...r.y))];
    expect(peak).toBeCloseTo(2, 1);
    // Steady-state amplitude at resonance is F0 / (b ω0) = 1 / (0.4 × 2).
    expect(Math.max(...r.y)).toBeCloseTo(1.25, 1);
    expect(r.failed).toBe(0);
  });
  it('writes CSV with full precision and blank gaps', () => {
    expect(toCsv([{ name: 't (s)', values: [0, 0.1] }, { name: 'x, raw', values: [1 / 3, NaN] }])).toBe('t (s),"x, raw"\n0,0.3333333333333333\n0.1,\n');
  });
});
