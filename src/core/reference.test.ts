import { describe, expect, it } from 'vitest';
import { compileFast } from './fastExpr';
import { simulate, type OdeModel } from './ode';
import { applyCompletion, completions, REFERENCE, searchReference, type ModelName } from './reference';

describe('reference', () => {
  it('every example evaluates to the value the reference states', () => {
    for (const r of REFERENCE) {
      const f = compileFast(r.example, {});
      expect(f, `${r.name}: "${r.example}" is not understood`).not.toBeNull();
      expect(f!([]), `${r.name}: ${r.example}`).toBeCloseTo(r.value, 12);
    }
  });

  it('every function works inside a model as written in its usage', () => {
    // The usage line with every argument name replaced by a number must run in the solver.
    for (const r of REFERENCE.filter((x) => x.kind === 'function')) {
      const call = r.usage.replace(', …', '').replace(/\b[a-zA-Z]\b/g, '0.5');
      const model: OdeModel = {
        id: 'ref', name: 'ref', summary: '', states: [{ name: 's', init: '0', deriv: '1' }], params: [],
        derived: [{ name: 'q', expr: call }], tEnd: 0.1, dt: 0.05, timeSeries: ['s'], phase: ['s', 's'],
      };
      const run = simulate(model);
      expect(run.error, `${r.usage} → ${call}`).toBeUndefined();
      expect(Number.isFinite(run.series.q[0]), call).toBe(true);
    }
  });

  it('has no two entries with the same name', () => {
    const names = REFERENCE.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('searches names, usage and meaning', () => {
    expect(searchReference('square root').map((r) => r.name)).toEqual(['sqrt']);
    expect(searchReference('LOG').map((r) => r.name)).toEqual(expect.arrayContaining(['log', 'log10', 'log2']));
    expect(searchReference('remainder').map((r) => r.name)).toEqual(['%', 'mod']);
    expect(searchReference('')).toHaveLength(REFERENCE.length);
    expect(searchReference('nothing matches this')).toEqual([]);
  });
});

describe('completion', () => {
  const names: ModelName[] = [
    { name: 'theta', kind: 'state' }, { name: 'omega', kind: 'state' }, { name: 'omega0', kind: 'parameter', detail: 'Natural frequency' },
    { name: 'E', kind: 'observable' }, { name: 't', kind: 'time' },
  ];
  const at = (text: string) => completions(text, text.length, names);

  it('offers the model\'s names before functions', () => {
    const c = at('-om')!;
    expect(c.options.map((o) => o.label)).toEqual(['omega', 'omega0']);
    expect(c.options[1].detail).toBe('Natural frequency');
    expect([c.from, c.to]).toEqual([1, 3]);
    expect(at('t')!.options.map((o) => o.label)).toEqual(['theta', 'tan(x)', 'tanh(x)', 'tau']);
  });

  it('inserts a function with its opening bracket and puts the caret after it', () => {
    const c = at('2 * sq')!;
    expect(c.options[0]).toMatchObject({ label: 'sqrt(x)', insert: 'sqrt(' });
    expect(applyCompletion('2 * sq', c, c.options[0])).toEqual({ text: '2 * sqrt(', caret: 9 });
  });

  it('completes in the middle of an expression without disturbing the rest', () => {
    const text = 'sin(the) + 1';
    const c = completions(text, 7, names)!;
    expect(applyCompletion(text, c, c.options[0])).toEqual({ text: 'sin(theta) + 1', caret: 9 });
  });

  it('stays quiet when there is nothing useful to offer', () => {
    expect(at('')).toBeNull();
    expect(at('2 * ')).toBeNull();
    expect(at('zzz')).toBeNull();
    // Already complete, and the only match.
    expect(at('theta')).toBeNull();
    // The caret is inside a name, not at its end.
    expect(completions('omega', 2, names)).toBeNull();
    // The e of a number in scientific notation.
    expect(at('2e')).toBeNull();
    expect(at('1.5e')).toBeNull();
  });

  it('still offers a longer name when the typed one is already a name', () => {
    expect(at('omega')!.options.map((o) => o.label)).toEqual(['omega0']);
  });

  it('prefers the model\'s own name over a built-in of the same name', () => {
    const c = completions('e', 1, [{ name: 'e', kind: 'parameter' }, { name: 'eps', kind: 'parameter' }])!;
    expect(c.options.map((o) => o.label)).toEqual(['eps', 'exp(x)']);
  });

  it('limits how many are offered', () => {
    expect(completions('s', 1, [], 3)!.options).toHaveLength(3);
  });
});
