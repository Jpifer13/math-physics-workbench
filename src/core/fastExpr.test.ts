import { compile } from 'mathjs';
import { describe, expect, it } from 'vitest';
import { MODELS } from '../sim/models';
import { compileFast } from './fastExpr';
import { simulate } from './ode';

describe('fast expression compiler', () => {
  const slot = { x: 0, y: 1, t: 2, k: 3 };
  const v = [1.3, -0.7, 2.5, 4];
  const scope = { x: 1.3, y: -0.7, t: 2.5, k: 4 };

  it('agrees with mathjs across the supported syntax', () => {
    const cases = [
      'x + y * k - t / 3', '-x^2', '(x + y)^3', '2^-x', 'x^y^2', '-(k / t) * sin(x) - 0.1 * y',
      'sqrt(x^2 + y^2)', 'exp(-t / k) * cos(3 * t)', 'atan2(y, x)', 'log(k)', 'log(k, 2)', 'log10(k) + log2(k)',
      'abs(y) + sign(y) + floor(t) + ceil(t) + round(t)', 'min(x, y, t) + max(x, y, t)', 'mod(t, 2)', 't % 2',
      'x < y', 'x > y', 'x <= x', 'x != y', 'x == x', 'x > 0 and y > 0', 'x > 0 or y > 0', 'not (x > 0)',
      'y < 0 ? k : t', 'pi * e', '1e-3 * k', 'tanh(x) + sinh(y) + cosh(t)', 'cbrt(k) + asin(0.3) + acos(0.3) + atan(x)',
    ];
    for (const c of cases) {
      const fast = compileFast(c, slot);
      expect(fast, c).not.toBeNull();
      expect(fast!(v), c).toBeCloseTo(Number(compile(c).evaluate({ ...scope })), 12);
    }
  });

  it('declines what it cannot do exactly, leaving it to mathjs', () => {
    for (const c of ['unknown + 1', 'factorial(3)', 'x!', '[1, 2]', 'x = 3', 'sin(', 'gamma(x)']) {
      expect(compileFast(c, slot), c).toBeNull();
    }
  });

  it('compiles every expression in the bundled templates', () => {
    for (const m of MODELS) {
      const names = ['t', ...m.params.map((p) => p.name), ...m.states.map((s) => s.name), ...m.derived.map((d) => d.name)];
      const table = Object.fromEntries(names.map((n, i) => [n, i]));
      for (const e of [...m.states.map((s) => s.deriv), ...m.derived.map((d) => d.expr), ...(m.stopWhen ? [m.stopWhen] : [])]) {
        expect(compileFast(e, table), `${m.id}: ${e}`).not.toBeNull();
      }
    }
  });

  it('still runs models that need the mathjs fallback, and reports unknown symbols', () => {
    const base = MODELS.find((m) => m.id === 'pendulum')!;
    const viaFallback = simulate({ ...base, derived: [{ name: 'E', expr: 'gamma(3) * 0.25 * L^2 * omega^2 + g * L * (1 - cos(theta))' }] });
    expect(viaFallback.error).toBeUndefined();
    expect(viaFallback.series.E.at(-1)!).toBeCloseTo(simulate(base).series.E.at(-1)!, 9);
    expect(simulate({ ...base, states: [base.states[0], { ...base.states[1], deriv: '-(g / L) * sin(theta) + oops' }] }).error).toMatch(/oops/);
  });

  it('lets rates depend on observables', () => {
    const r = simulate({
      id: 'x', name: 'x', summary: '', params: [], tEnd: 1, dt: 0.001, timeSeries: ['x'], phase: ['x', 'x'],
      states: [{ name: 'x', init: '1', deriv: 'rate' }],
      derived: [{ name: 'rate', expr: '-2 * x' }],
    });
    expect(r.series.x.at(-1)!).toBeCloseTo(Math.exp(-2), 8);
  });
});
