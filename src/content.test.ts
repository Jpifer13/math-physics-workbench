import { describe, expect, it } from 'vitest';
import { evaluate } from './core/graph';
import { simulate } from './core/ode';
import { formatQuantity } from './core/units';
import { EXAMPLES } from './flow/examples';
import { toGraph } from './flow/types';
import { MODELS } from './sim/models';

describe('bundled example flows', () => {
  for (const ex of EXAMPLES) {
    it(`${ex.name} evaluates cleanly`, () => {
      const results = evaluate(toGraph(ex.nodes, ex.edges));
      for (const [id, r] of results) expect(r.error, `node ${id}`).toBeUndefined();
      expect(results.get(ex.model.outputId)?.q).toBeDefined();
      expect(ex.nodes.some((n) => n.id === ex.model.xId)).toBe(true);
    });
  }

  it('gives textbook answers', () => {
    const value = (name: string) => {
      const ex = EXAMPLES.find((e) => e.name === name)!;
      const out = ex.nodes.find((n) => n.id === ex.model.outputId)!;
      const f = formatQuantity(evaluate(toGraph(ex.nodes, ex.edges)).get(out.id)!.q!, (out.data.cfg as { unit: string }).unit);
      return [f.value, f.unit] as const;
    };
    expect(value("Newton's law of gravitation")[0]).toBeCloseTo(687.4, 0); // weight of 70 kg ≈ 687 N
    expect(value('Pendulum period')[0]).toBeCloseTo(2.006, 3);
    expect(value('Lorentz factor')[0]).toBeCloseTo(1.1551, 3);
    expect(value('de Broglie wavelength')[0]).toBeCloseTo(0.7274, 3); // nm
    expect(value('Ideal gas law')[0]).toBeCloseTo(101.5, 0); // kPa
    expect(value('Photon energy')).toEqual([expect.closeTo(2.4797, 3), 'eV']);
    expect(value('Escape velocity')[0]).toBeCloseTo(11.186, 2); // km/s
  });
});

describe('bundled simulation models', () => {
  for (const m of MODELS) {
    it(`${m.name} runs without error`, () => {
      const run = simulate(m);
      expect(run.error).toBeUndefined();
      expect(run.t.length).toBeGreaterThan(100);
      for (const name of [...m.timeSeries, ...m.phase]) expect(run.series[name], name).toBeDefined();
    });
  }

  it('conserves energy and angular momentum on an orbit', () => {
    const run = simulate(MODELS.find((m) => m.id === 'orbit')!);
    const drift = (s: number[]) => Math.abs(s.at(-1)! - s[0]);
    expect(drift(run.series.E)).toBeLessThan(1e-6);
    expect(drift(run.series.Lz)).toBeLessThan(1e-6);
  });
});
