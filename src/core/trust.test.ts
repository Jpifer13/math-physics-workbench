import { describe, expect, it } from 'vitest';
import { parseTable } from './fit';
import { toCsv } from './measure';
import { simulate, type OdeModel } from './ode';
import { accuracyReport, checkExpectations, compareRuns, describeExpectation, fingerprint, modelEssence, provenance } from './trust';
import { MODELS } from '../sim/models';

const sho: OdeModel = {
  id: 'sho', name: 'Oscillator', summary: '',
  states: [{ name: 'x', init: '1', deriv: 'v' }, { name: 'v', init: '0', deriv: '-k*x' }],
  params: [{ name: 'k', value: 4, min: 0, max: 10, unit: 'N/m' }],
  derived: [{ name: 'E', expr: '0.5*v^2 + 0.5*k*x^2' }],
  tEnd: 20, dt: 0.01, method: 'rk45', tol: 1e-8, timeSeries: ['x'], phase: ['x', 'v'],
};

describe('accuracy report', () => {
  it('finds a well-resolved run converged', () => {
    const rep = accuracyReport(sho, simulate(sho));
    expect(rep.refined.error).toBeUndefined();
    expect(rep.worst).toBeLessThan(1e-3);
    expect(rep.refined.label).toMatch(/tolerance tightened/);
    expect(rep.crossMethod.label).toBe('RK45 against Rosenbrock23');
    expect(rep.growing).toBe(false);
  });
  it('exposes an under-resolved run', () => {
    const coarse = { ...sho, method: 'euler' as const, dt: 0.05 };
    const rep = accuracyReport(coarse, simulate(coarse));
    expect(rep.refined.label).toMatch(/step halved from 0.05 to 0.025/);
    expect(rep.worst).toBeGreaterThan(0.1);
  });
  it('recognises sensitive dynamics by error growing to the end of the run', () => {
    const lorenz = MODELS.find((m) => m.id === 'lorenz')!;
    const rep = accuracyReport(lorenz, simulate(lorenz));
    expect(rep.worst).toBeGreaterThan(0.01);
    expect(rep.growing).toBe(true);
  });
  it('recommends the other solver only when it measurably does better', () => {
    // Strongly stiff: relaxes to cos(t) a hundred thousand times faster than cos(t) varies.
    const stiff: OdeModel = {
      id: 'stiff', name: 'stiff', summary: '', derived: [], tEnd: 4, dt: 0.01, method: 'rk45', tol: 1e-6, timeSeries: ['y'], phase: ['y', 'y'],
      states: [{ name: 'y', init: '0', deriv: '-lambda * (y - cos(t))' }], params: [{ name: 'lambda', value: 1e5, min: 1, max: 1e6 }],
    };
    const rep = accuracyReport(stiff, simulate(stiff));
    expect(rep.faster?.method).toBe('ros23');
    expect(rep.faster!.ratio).toBeGreaterThan(10);
    // A smooth oscillator gains nothing from the stiff method, and a relaxation oscillator with sharp jumps is not helped either.
    expect(accuracyReport(sho, simulate(sho)).faster).toBeUndefined();
    const vdp = { ...MODELS.find((m) => m.id === 'vdp')!, method: 'rk45' as const, tol: 1e-8, tEnd: 100, params: [{ name: 'mu', value: 20, min: 0, max: 50 }, { name: 'x0', value: 0.5, min: -3, max: 3 }] };
    expect(accuracyReport(vdp, simulate(vdp)).faster).toBeUndefined();
  });
  it('compares only where both runs have data', () => {
    const a = simulate(sho);
    const b = simulate({ ...sho, tEnd: 10, derived: [] });
    const { rows } = compareRuns(a, b);
    expect(rows.map((r) => r.name)).toEqual(['x', 'v']);
    expect(Math.max(...rows.map((r) => r.worst / r.scale))).toBeLessThan(1e-3);
  });
});

describe('expectations', () => {
  it('passes and fails against a run, with the measured value', () => {
    const model: OdeModel = {
      ...sho,
      expectations: [
        { observable: 'x', measure: 'period', compare: 'equals', value: Math.PI, tolerance: 1e-3 },
        { observable: 'E', measure: 'range', compare: 'atMost', value: 1e-5 },
        { observable: 'x', measure: 'max', compare: 'atLeast', value: 2 },
        { observable: 'gone', measure: 'final', compare: 'equals', value: 0, tolerance: 1 },
      ],
    };
    const r = checkExpectations(model, simulate(model));
    expect(r.map((x) => x.pass)).toEqual([true, true, false, false]);
    expect(r[0].actual).toBeCloseTo(Math.PI, 3);
    expect(r[3].actual).toBeNaN();
    expect(describeExpectation(model.expectations![1])).toBe('peak-to-peak range of E ≤ 0.00001');
  });
  it('catches an edit that breaks known behaviour', () => {
    const guarded: OdeModel = { ...sho, expectations: [{ observable: 'E', measure: 'range', compare: 'atMost', value: 1e-5 }] };
    expect(checkExpectations(guarded, simulate(guarded))[0].pass).toBe(true);
    const broken = { ...guarded, states: [guarded.states[0], { ...guarded.states[1], deriv: '-k*x - 0.1*v' }] };
    expect(checkExpectations(broken, simulate(broken))[0].pass).toBe(false);
  });
});

describe('provenance', () => {
  it('fingerprints what determines the numbers, and nothing else', () => {
    const base = fingerprint(modelEssence(sho));
    expect(base).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprint(modelEssence({ ...sho, name: 'Renamed', notes: 'x', timeSeries: ['v'] }))).toBe(base);
    expect(fingerprint(modelEssence({ ...sho, params: [{ ...sho.params[0], value: 4.0001 }] }))).not.toBe(base);
    expect(fingerprint(modelEssence({ ...sho, tol: 1e-9 }))).not.toBe(base);
  });
  it('writes a header that survives a CSV round trip', () => {
    const run = simulate(sho);
    const lines = provenance(sho, { appVersion: '0.1.0', when: '2026-01-01T00:00:00Z', run });
    expect(lines[0]).toBe('Math & Physics Workbench 0.1.0 — exported 2026-01-01T00:00:00Z');
    expect(lines.join('\n')).toContain('parameters: k = 4 N/m');
    expect(lines.join('\n')).toContain('state v: initial 0; rate -k*x');
    const csv = toCsv([{ name: 't', values: run.t.slice(0, 5) }, { name: 'x', values: run.series.x.slice(0, 5) }], lines);
    expect(csv.startsWith('# Math & Physics Workbench 0.1.0')).toBe(true);
    // The header is ignored on import, so an exported file can be read straight back.
    const back = parseTable(csv);
    expect(back.map((c) => c.name)).toEqual(['t', 'x']);
    expect(back[1].values).toEqual(run.series.x.slice(0, 5));
  });
});
