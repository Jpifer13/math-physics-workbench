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

describe('stiff solver and events', () => {
  const stiff: OdeModel = {
    id: 'stiff', name: 'stiff', summary: '',
    // Relaxes to cos(t) on a timescale of 1/lambda: stiff once lambda is large.
    states: [{ name: 'y', init: '0', deriv: '-lambda * (y - cos(t))' }],
    params: [{ name: 'lambda', value: 1e5, min: 1, max: 1e6 }],
    derived: [], tEnd: 4, dt: 0.01, timeSeries: ['y'], phase: ['y', 'y'],
  };
  it('Rosenbrock23 handles a stiff problem that defeats the explicit methods', () => {
    const ros = simulate({ ...stiff, method: 'ros23', tol: 1e-6 });
    expect(ros.error).toBeUndefined();
    expect(ros.series.y.at(-1)!).toBeCloseTo(Math.cos(4), 4);
    // Explicit RK4 at this step is far outside its stability region; RK45 needs vastly more steps.
    expect(simulate({ ...stiff, method: 'rk4' }).error).toMatch(/diverged/);
    const rk45 = simulate({ ...stiff, method: 'rk45', tol: 1e-6 });
    expect(ros.stats!.steps).toBeLessThan(rk45.stats!.steps / 20);
  });
  it('Rosenbrock23 is accurate on a non-stiff oscillator too', () => {
    const r = simulate({ ...sho, method: 'ros23', tol: 1e-8 });
    expect(r.error).toBeUndefined();
    expect(r.series.x.at(-1)!).toBeCloseTo(Math.cos(40), 3);
  });
  it('locates the stop condition inside a step', () => {
    const fall: OdeModel = {
      id: 'fall', name: 'fall', summary: '',
      states: [{ name: 'y', init: '0', deriv: 'vy' }, { name: 'vy', init: '10', deriv: '-g' }],
      params: [{ name: 'g', value: 9.81, min: 1, max: 20 }],
      derived: [], tEnd: 10, dt: 0.05, stopWhen: 'y < 0', timeSeries: ['y'], phase: ['y', 'vy'],
    };
    const exact = 20 / 9.81;
    for (const method of ['rk4', 'rk45', 'ros23', 'euler'] as const) {
      const r = simulate({ ...fall, method });
      // Euler's own truncation error moves the trajectory; the others land on the true landing time.
      expect(Math.abs(r.t.at(-1)! - exact), method).toBeLessThan(method === 'euler' ? 0.06 : 1e-5);
      expect(Math.abs(r.series.y.at(-1)!), method).toBeLessThan(1e-6);
    }
  });
});

describe('discrete events', () => {
  const ball: OdeModel = {
    id: 'ball', name: 'ball', summary: '',
    states: [{ name: 'y', init: 'h0', deriv: 'vy' }, { name: 'vy', init: '0', deriv: '-g' }],
    params: [{ name: 'g', value: 9.81, min: 1, max: 20 }, { name: 'h0', value: 1, min: 0, max: 5 }, { name: 'e', value: 1, min: 0, max: 1 }],
    derived: [{ name: 'E', expr: '0.5 * vy^2 + g * y' }],
    tEnd: 5, dt: 0.01, timeSeries: ['y'], phase: ['y', 'vy'],
    events: [{ when: 'y < 0', then: 'vy = -e * vy' }],
  };
  const fallTime = Math.sqrt(2 / 9.81);

  it('bounces elastically: energy conserved, bounce times exact', () => {
    for (const method of ['rk4', 'rk45', 'ros23'] as const) {
      const r = simulate({ ...ball, method, tol: 1e-9 });
      expect(r.error, method).toBeUndefined();
      expect(r.eventTimes!.length, method).toBe(Math.floor((5 + fallTime) / (2 * fallTime)));
      r.eventTimes!.forEach((t, i) => expect(t, `${method} bounce ${i}`).toBeCloseTo(fallTime * (2 * i + 1), 5));
      expect(Math.min(...r.series.y), method).toBeGreaterThan(-1e-9);
      expect(Math.max(...r.series.E) - Math.min(...r.series.E), method).toBeLessThan(1e-5);
      expect(r.t.at(-1)!, method).toBeCloseTo(5, 9);
    }
  });
  it('loses energy by e² per bounce', () => {
    const r = simulate({ ...ball, params: ball.params.map((p) => (p.name === 'e' ? { ...p, value: 0.8 } : p)), tEnd: 2 });
    // Just after the first and second bounces.
    const at = (k: number) => r.series.E[r.t.lastIndexOf(r.eventTimes![k])];
    expect(at(0) / 9.81).toBeCloseTo(0.64, 5);
    expect(at(1) / at(0)).toBeCloseTo(0.64, 5);
  });
  it('applies simultaneous assignments from the pre-event state, and keeps stop conditions working', () => {
    const swap = simulate({
      id: 's', name: 's', summary: '', params: [], derived: [], tEnd: 3, dt: 0.01, timeSeries: ['a'], phase: ['a', 'b'],
      states: [{ name: 'a', init: '1', deriv: '0' }, { name: 'b', init: '2', deriv: '0' }, { name: 'c', init: '0', deriv: '1' }],
      events: [{ when: 'c > 1', then: 'a = b; b = a' }],
      stopWhen: 'c > 2',
    });
    expect(swap.error).toBeUndefined();
    expect([swap.series.a.at(-1), swap.series.b.at(-1)]).toEqual([2, 1]);
    expect(swap.eventTimes![0]).toBeCloseTo(1, 9);
    expect(swap.t.at(-1)!).toBeCloseTo(2, 9);
  });
  it('reports malformed events and runaway (Zeno) behaviour', () => {
    expect(simulate({ ...ball, events: [{ when: 'y < 0', then: 'g = 3' }] }).error).toMatch(/not a state variable/);
    expect(simulate({ ...ball, events: [{ when: 'y < 0', then: 'vy == 2' }] }).error).toMatch(/not an assignment/);
    // With e = 0.5 the bounces accumulate at t = 3·√(2h/g): the run must stop there, not fall through the floor.
    const zeno = simulate({ ...ball, params: ball.params.map((p) => (p.name === 'e' ? { ...p, value: 0.5 } : p)), tEnd: 60 });
    expect(zeno.error).toMatch(/Zeno/);
    expect(zeno.t.at(-1)!).toBeCloseTo(3 * fallTime, 3);
    expect(Math.min(...zeno.series.y)).toBeGreaterThan(-1e-6);
  });
});

describe('failure diagnostics', () => {
  const base: OdeModel = { id: 'd', name: 'd', summary: '', params: [], derived: [], tEnd: 5, dt: 0.01, method: 'rk45', tol: 1e-8, timeSeries: ['x'], phase: ['x', 'y'], states: [] };
  it('names the variable racing away in a finite-time blow-up', () => {
    // x' = x² reaches infinity at t = 1; y is well behaved.
    const r = simulate({ ...base, states: [{ name: 'y', init: '1', deriv: '-y' }, { name: 'x', init: '1', deriv: 'x^2' }] });
    expect(r.error).toMatch(/t ≈ (1\.00|0\.99)/);
    expect(r.error).toMatch(/x is (changing fastest|growing without bound) there/);
  });
  it('does not call a runaway value an undefined expression', () => {
    // v' = v² + 1 is tan(t): it grows without bound at t = π/2, but nothing in it is undefined.
    const r = simulate({ ...base, states: [{ name: 'v', init: '0', deriv: 'v^2 + 1' }] });
    expect(r.error).toMatch(/t ≈ 1\.5/);
    expect(r.error).not.toMatch(/undefined/);
    expect(r.error).toMatch(/v is (changing fastest|growing without bound)/);
  });
  it('names the rate that becomes undefined', () => {
    // sqrt of a quantity that goes negative.
    const r = simulate({ ...base, method: 'rk4', states: [{ name: 'u', init: '1', deriv: '-1' }, { name: 'w', init: '0', deriv: 'sqrt(u)' }], tEnd: 3 });
    expect(r.error).toMatch(/rate of change of w becomes undefined/);
  });
});
