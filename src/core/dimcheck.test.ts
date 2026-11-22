import { describe, expect, it } from 'vitest';
import { MODELS } from '../sim/models';
import { checkUnits, parseUnit } from './dimcheck';
import type { OdeModel } from './ode';
import { dim, dimEq, siUnitFor } from './units';

describe('unit parsing', () => {
  const d = (t: string) => parseUnit(t)?.d;
  it('reads units the way people write them', () => {
    expect(dimEq(d('m/s²')!, dim(0, 1, -2))).toBe(true);
    expect(dimEq(d('m/s^2')!, dim(0, 1, -2))).toBe(true);
    expect(dimEq(d('kg·m²/s²')!, dim(1, 2, -2))).toBe(true);
    expect(dimEq(d('J/(mol·K)')!, dim(1, 2, -2, 0, -1, -1))).toBe(true);
    expect(dimEq(d('J/kg·K')!, dim(0, 2, -2, 0, -1))).toBe(true);
    expect(dimEq(d('N m')!, dim(1, 2, -2))).toBe(true);
    expect(dimEq(d('1/s')!, dim(0, 0, -1))).toBe(true);
    expect(dimEq(d('s⁻¹')!, dim(0, 0, -1))).toBe(true);
    expect(dimEq(d('C/kg')!, dim(-1, 0, 1, 1))).toBe(true);
    expect(dimEq(d('m^(1/2)')!, dim(0, 0.5))).toBe(true);
    expect(parseUnit('°')!.factor).toBeCloseTo(Math.PI / 180);
    expect(parseUnit('km/h')!.factor).toBeCloseTo(1 / 3.6);
    expect(siUnitFor(d('V/m')!)).toBe('V/m');
  });
  it('declines what it does not understand', () => {
    for (const bad of ['furlongs', 'm//s', 'kg^', '(m', '', 'm/']) expect(parseUnit(bad), bad).toBeNull();
  });
});

describe('unit checking of models', () => {
  it('finds every bundled template consistent', () => {
    for (const m of MODELS) expect(checkUnits(m).issues, m.id).toEqual([]);
  });
  it('actually checks the annotated templates', () => {
    const r = checkUnits(MODELS.find((m) => m.id === 'cyclotron')!);
    expect(r.empty).toBe(false);
    expect(r.checked).toBeGreaterThanOrEqual(8);
    expect(checkUnits(MODELS.find((m) => m.id === 'lorenz')!).empty).toBe(true);
  });

  const spring: OdeModel = {
    id: 's', name: 's', summary: '', tEnd: 10, dt: 0.01, timeSeries: ['x'], phase: ['x', 'v'],
    states: [{ name: 'x', init: 'x0', deriv: 'v', unit: 'm' }, { name: 'v', init: '0', deriv: '(-k * x - b * v) / m', unit: 'm/s' }],
    params: [
      { name: 'x0', value: 1, min: 0, max: 2, unit: 'm' }, { name: 'k', value: 10, min: 0, max: 50, unit: 'N/m' },
      { name: 'b', value: 0.3, min: 0, max: 5, unit: 'kg/s' }, { name: 'm', value: 1, min: 0, max: 5, unit: 'kg' },
    ],
    derived: [{ name: 'E', expr: '0.5 * m * v^2 + 0.5 * k * x^2' }],
  };
  const messages = (m: OdeModel) => checkUnits(m).issues.map((i) => `${i.where}: ${i.message}`);

  it('passes a correct model and infers units for unlabelled observables', () => {
    const r = checkUnits(spring);
    expect(r.issues).toEqual([]);
    expect(r.inferred).toEqual({ E: 'J' });
  });
  it('catches a rate with the wrong units', () => {
    // Forgetting to divide the force by the mass.
    const wrong = { ...spring, states: [spring.states[0], { ...spring.states[1], deriv: '-k * x - b * v' }] };
    expect(messages(wrong)).toEqual(['rate:v: The rate of change of v works out as force (N), but dv/dt needs acceleration (m/s²)']);
  });
  it('catches mismatched terms, initial values, labels and function arguments', () => {
    expect(messages({ ...spring, states: [spring.states[0], { ...spring.states[1], deriv: '(-k * x - b) / m' }] })[0]).toMatch(/rate:v: In the rate of change of v, it subtracts force \(N\) and kg\/s/);
    expect(messages({ ...spring, states: [{ ...spring.states[0], init: 'k' }, spring.states[1]] })[0]).toMatch(/init:x: The initial value of x works out as stiffness \(N\/m\), but x needs length \(m\)/);
    expect(messages({ ...spring, derived: [{ name: 'E', expr: spring.derived[0].expr, unit: 'N' }] })[0]).toMatch(/E is labelled N, but its expression works out as energy \(J\)/);
    expect(messages({ ...spring, derived: [{ name: 'q', expr: 'sin(x)' }] })[0]).toMatch(/sin\(\) is given length \(m\); its argument must be a plain number/);
    expect(messages({ ...spring, derived: [{ name: 'q', expr: 'x^v' }] })[0]).toMatch(/an exponent is velocity/);
  });
  it('checks event resets and conditions', () => {
    const ev = { ...spring, events: [{ when: 'x < v', then: 'v = k' }] };
    const out = messages(ev);
    expect(out[0]).toMatch(/event:1: In the condition of event 1, it compares length \(m\) and velocity \(m\/s\)/);
    expect(out[1]).toMatch(/The reset of v in event 1 works out as stiffness/);
  });
  it('treats unlabelled quantities as unknown, and zero as compatible with anything', () => {
    const partial = { ...spring, params: spring.params.map((p) => (p.name === 'b' ? { ...p, unit: undefined } : p)), stopWhen: 'x < 0', events: [{ when: 'v > 0 and x >= 0', then: '' }] };
    expect(checkUnits(partial).issues).toEqual([]);
  });
  it('warns about non-SI units and unrecognised ones', () => {
    const km = { ...spring, params: spring.params.map((p) => (p.name === 'x0' ? { ...p, unit: 'km' } : p)) };
    expect(messages(km)[0]).toMatch(/param:x0: x0 is in km, which is not an SI unit/);
    const odd = { ...spring, params: spring.params.map((p) => (p.name === 'b' ? { ...p, unit: 'slugs' } : p)) };
    expect(messages(odd)).toEqual(['param:b: The unit "slugs" of b is not recognised, so equations involving it are not checked']);
    // Degrees are dimensionless, so an angle in degrees converted in the equations is fine.
    expect(checkUnits(MODELS.find((m) => m.id === 'projectile')!).issues).toEqual([]);
  });
});
