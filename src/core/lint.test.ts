import { describe, expect, it } from 'vitest';
import { checkModel, namesIn } from './lint';
import { simulate, type OdeModel } from './ode';
import { MODELS } from '../sim/models';

const ball: OdeModel = {
  id: 'ball', name: 'Ball', summary: '',
  states: [{ name: 'y', init: 'h0', deriv: 'vy' }, { name: 'vy', init: '0', deriv: '-g' }],
  params: [{ name: 'g', value: 9.81, min: 1, max: 25 }, { name: 'h0', value: 5, min: 0, max: 10 }, { name: 'bounce', value: 0.8, min: 0, max: 1 }],
  derived: [{ name: 'E', expr: '0.5 * vy^2 + g * y' }],
  events: [{ when: 'y < 0', then: 'vy = -bounce * vy' }],
  tEnd: 5, dt: 0.001, method: 'rk4', timeSeries: ['y'], phase: ['y', 'vy'],
};
const check = (m: OdeModel) => checkModel(m, simulate(m));
const about = (m: OdeModel, where: string) => check(m).filter((f) => f.where === where).map((f) => f.message);

describe('names in an expression', () => {
  it('lists what is read and leaves out what is called', () => {
    expect([...namesIn('-k * x + sin(omega * t) / max(m, 1)')!].sort()).toEqual(['k', 'm', 'omega', 't', 'x']);
    expect(namesIn('3 + 4')!.size).toBe(0);
    expect(namesIn('')!.size).toBe(0);
    expect(namesIn('2 * (x')).toBeNull();
  });
});

describe('check my model', () => {
  it('finds nothing wrong with a sound model', () => {
    expect(check(ball)).toEqual([]);
  });

  it('finds nothing to warn about in any template', () => {
    for (const m of MODELS) {
      expect(check(m).filter((f) => f.level === 'warn'), m.name).toEqual([]);
    }
  });

  it('flags a parameter no equation uses', () => {
    const m = { ...ball, params: [...ball.params, { name: 'mass', value: 1, min: 0, max: 5 }] };
    expect(about(m, 'parameter mass')).toEqual([expect.stringMatching(/not used by any equation/)]);
    // Used only by an event still counts as used.
    expect(about(ball, 'parameter bounce')).toEqual([]);
  });

  it('suggests the name a misspelling was meant to be', () => {
    const m = { ...ball, derived: [{ name: 'E', expr: '0.5 * vy^2 + g * yy + bonce' }] };
    const found = checkModel(m).filter((f) => f.where === 'observable E').map((f) => f.message);
    expect(found).toEqual([expect.stringMatching(/“yy”.*Did you mean “y”/), expect.stringMatching(/“bonce”.*Did you mean “bounce”/)]);
    const far = checkModel({ ...ball, derived: [{ name: 'E', expr: 'zeta * 2' }] }).find((f) => f.where === 'observable E')!;
    expect(far.message).toMatch(/Add it as a parameter/);
    // Built-in constants and time are not misspellings.
    expect(checkModel({ ...ball, derived: [{ name: 'E', expr: 'pi * e * tau * t + g + y + vy' }] }).filter((f) => f.where === 'observable E')).toEqual([]);
  });

  it('flags a state that can never change, unless an event sets it', () => {
    const frozen = { ...ball, states: [...ball.states, { name: 'n', init: '0', deriv: '0' }] };
    expect(check(frozen).filter((f) => f.where === 'state n')).toEqual([expect.objectContaining({ level: 'note', message: expect.stringMatching(/stays at its initial value/) })]);
    const counted = { ...frozen, events: [{ when: 'y < 0', then: 'vy = -bounce * vy; n = n + 1' }] };
    expect(about(counted, 'state n')).toEqual([]);
    // A constant rate that is not zero is a perfectly good clock.
    expect(about({ ...ball, states: [...ball.states, { name: 'n', init: '0', deriv: '2' }] }, 'state n')).toEqual([]);
  });

  it('flags events that cannot fire or do nothing', () => {
    const constant = { ...ball, events: [{ when: 'g > 5', then: 'vy = 0' }] };
    expect(about(constant, 'event 1')).toEqual([expect.stringMatching(/depends only on parameters/)]);
    const empty = { ...ball, events: [{ when: 'y < 0', then: '' }] };
    expect(checkModel(empty).filter((f) => f.where === 'event 1').map((f) => f.message)).toEqual([expect.stringMatching(/sets nothing/)]);
    const wrong = { ...ball, events: [{ when: 'y < 0', then: 'E = 0' }] };
    expect(checkModel(wrong).filter((f) => f.where === 'event 1').map((f) => f.message)).toEqual([expect.stringMatching(/“E”, which is not a state variable/)]);
    // An event with no condition yet is a blank row, not a mistake.
    expect(checkModel({ ...ball, events: [{ when: '', then: '' }] }).filter((f) => f.where.startsWith('event'))).toEqual([]);
  });

  it('uses the run to spot an event that is true from the start, or never true', () => {
    // y starts at 5 and the condition y > -100 holds throughout: it never *turns* true.
    const always = { ...ball, events: [{ when: 'y > -1000', then: 'vy = 0' }] };
    expect(about(always, 'event 1')).toEqual([expect.stringMatching(/already true at the start/)]);
    const never = { ...ball, tEnd: 0.5, events: [{ when: 'y < 0', then: 'vy = -bounce * vy' }] };
    const found = check(never).filter((f) => f.where === 'event 1');
    expect(found).toEqual([expect.objectContaining({ level: 'note', message: expect.stringMatching(/did not fire/) })]);
    // An event that fired is left alone, and without a run nothing is claimed.
    expect(about(ball, 'event 1')).toEqual([]);
    expect(checkModel(never).filter((f) => f.where === 'event 1')).toEqual([]);
  });

  it('reports a stop condition that was never met, or ends the run at once', () => {
    expect(about({ ...ball, events: [], stopWhen: 'y < -1000', params: ball.params.slice(0, 2) }, 'stop condition')).toEqual([expect.stringMatching(/was not met/)]);
    expect(about({ ...ball, events: [], stopWhen: 'y > 0', params: ball.params.slice(0, 2) }, 'stop condition')).toEqual([expect.stringMatching(/true from the start/)]);
    expect(about({ ...ball, events: [], stopWhen: 'y < 0', params: ball.params.slice(0, 2) }, 'stop condition')).toEqual([]);
  });

  it('flags a fixed step too coarse to resolve the run, and a value outside its range', () => {
    expect(checkModel({ ...ball, dt: 0.5 }).filter((f) => f.where === 'solver')[0].message).toMatch(/only 10 steps/);
    expect(checkModel({ ...ball, dt: 0.5, method: 'rk45' }).filter((f) => f.where === 'solver')).toEqual([]);
    const outside = { ...ball, params: ball.params.map((p) => (p.name === 'g' ? { ...p, value: 30 } : p)) };
    expect(checkModel(outside).filter((f) => f.where === 'parameter g')).toEqual([expect.objectContaining({ level: 'note' })]);
  });

  it('leaves text that does not parse to the run\'s own error', () => {
    expect(checkModel({ ...ball, derived: [{ name: 'E', expr: '2 * (y' }] }).filter((f) => f.where === 'observable E')).toEqual([]);
  });
});
