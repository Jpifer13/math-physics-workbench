import { describe, expect, it } from 'vitest';
import { simFile } from '../core/docfile';
import { parseTable } from '../core/fit';
import type { OdeModel } from '../core/ode';
import { readProvenanceTitle } from '../core/brand';
import { parseArgs, runCli, type CliIo } from './cli';

const decay: OdeModel = {
  id: 'decay', name: 'Decay', summary: '',
  states: [{ name: 'x', init: 'x0', deriv: '-k * x', unit: 'm' }],
  params: [{ name: 'x0', value: 2, min: 0, max: 5, unit: 'm' }, { name: 'k', value: 0.5, min: 0.1, max: 2, unit: '1/s' }],
  derived: [{ name: 'half', expr: 'x / 2', unit: 'm' }],
  tEnd: 2, dt: 0.01, method: 'rk4', timeSeries: ['x'], phase: ['x', 'x'],
  experiment: { param: 'k', from: 0.5, to: 1.5, points: 3, observable: 'x', measure: 'final' },
  expectations: [{ observable: 'x', measure: 'final', compare: 'equals', value: 2 * Math.exp(-1), tolerance: 1e-6 }],
  uncertainty: { inputs: [{ param: 'x0', dist: 'normal', a: 2, b: 0.1 }, { param: 'k', dist: 'normal', a: 0.5, b: 0.05 }], samples: 64, observable: 'x', measure: 'final', seed: 3 },
};

/** A file system in memory, and everything the command wrote. */
function harness(files: Record<string, string> = { 'decay.physsim': simFile(decay, 3, '0.1.0') }) {
  const written: Record<string, string> = {};
  let out = '', err = '';
  const io: CliIo = {
    read: (p) => { if (!(p in files)) throw new Error('no such file'); return files[p]; },
    write: (p, t) => { written[p] = t; },
    out: (t) => { out += t; }, err: (t) => { err += t; },
    now: () => '2026-12-01T00:00:00Z', appVersion: '0.1.0', fileFormat: 3,
  };
  return { run: (...argv: string[]) => runCli(argv, io), out: () => out, err: () => err, written };
}
const table = (csv: string) => Object.fromEntries(parseTable(csv).map((c) => [c.name, c.values]));
const header = (csv: string) => csv.split('\n').filter((l) => l.startsWith('# '));

describe('arguments', () => {
  it('splits a command line into command, file and options', () => {
    expect(parseArgs(['run', 'a.physsim', '--set', 'k=2', '--set=m=3', '--out', 'r.csv'])).toEqual({ command: 'run', file: 'a.physsim', options: { set: ['k=2', 'm=3'], out: ['r.csv'] } });
    expect(parseArgs(['--version']).options.version).toBeDefined();
    expect(() => parseArgs(['run', 'a', '--nope'])).toThrow(/Unknown option --nope/);
    expect(() => parseArgs(['run', 'a', '--out'])).toThrow(/needs a value/);
    expect(() => parseArgs(['run', 'a', 'b'])).toThrow(/Unexpected argument/);
  });

  it('explains itself', () => {
    const h = harness();
    expect(h.run('--help')).toBe(0);
    expect(h.out()).toMatch(/Usage:/);
    expect(h.out()).toMatch(/math-physics-workbench run <model.physsim>/);
    const v = harness();
    expect(v.run('--version')).toBe(0);
    expect(v.out()).toBe('Math & Physics Workbench 0.1.0\n');
    // No command at all is a mistake, but still shows how to use it.
    const none = harness();
    expect(none.run()).toBe(2);
    expect(none.out()).toMatch(/Usage:/);
  });
});

describe('run', () => {
  it('writes the run as CSV on standard output, with units and a provenance header', () => {
    const h = harness();
    expect(h.run('run', 'decay.physsim')).toBe(0);
    const t = table(h.out());
    expect(Object.keys(t)).toEqual(['t', 'x (m)', 'half (m)']);
    expect(t.t.at(-1)).toBeCloseTo(2, 9);
    expect(t['x (m)'].at(-1)).toBeCloseTo(2 * Math.exp(-1), 6);
    expect(readProvenanceTitle(header(h.out())[0])).toEqual({ app: 'Math & Physics Workbench', version: '0.1.0', when: '2026-12-01T00:00:00Z' });
    expect(h.out()).toMatch(/# parameters: x0 = 2 m; k = 0.5 1\/s/);
    expect(h.err()).toBe('');
  });

  it('applies --set and --end, and records them in the header', () => {
    const h = harness();
    expect(h.run('run', 'decay.physsim', '--set', 'k=1', '--set', 'x0=4', '--end', '1')).toBe(0);
    const t = table(h.out());
    expect(t.t.at(-1)).toBeCloseTo(1, 9);
    expect(t['x (m)'].at(-1)).toBeCloseTo(4 * Math.exp(-1), 6);
    expect(h.out()).toMatch(/# parameters: x0 = 4 m; k = 1 1\/s/);
    expect(h.out()).toMatch(/duration 1\b/);
  });

  it('writes to a file when asked and says so on standard error', () => {
    const h = harness();
    expect(h.run('run', 'decay.physsim', '--out', 'r.csv')).toBe(0);
    expect(h.out()).toBe('');
    expect(table(h.written['r.csv']).t.length).toBe(201);
    expect(h.err()).toBe('Wrote 201 samples to r.csv\n');
  });

  it('exits 1 with the reason when the model cannot run', () => {
    const broken = { ...decay, states: [{ name: 'x', init: 'x0', deriv: '-kk * x' }] };
    const h = harness({ 'b.physsim': simFile(broken, 3, '0.1.0') });
    expect(h.run('run', 'b.physsim')).toBe(1);
    expect(h.err()).toMatch(/The model did not run: .*kk/);
    expect(h.out()).toBe('');
  });
});

describe('experiment', () => {
  it('runs the experiment saved in the file', () => {
    const h = harness();
    expect(h.run('experiment', 'decay.physsim')).toBe(0);
    const t = table(h.out());
    expect(t['k (1/s)']).toEqual([0.5, 1, 1.5]);
    t['final value of x (m)'].forEach((v, i) => expect(v).toBeCloseTo(2 * Math.exp(-2 * [0.5, 1, 1.5][i]), 6));
    expect(h.out()).toMatch(/# experiment: final of x for k from 0.5 to 1.5 in 3 steps/);
  });

  it('takes a design from the command line instead', () => {
    const h = harness();
    expect(h.run('experiment', 'decay.physsim', '--param', 'x0', '--from', '1', '--to', '3', '--points', '5', '--measure', 'max', '--observable', 'half')).toBe(0);
    const t = table(h.out());
    expect(t['x0 (m)']).toEqual([1, 1.5, 2, 2.5, 3]);
    expect(t['maximum of half (m)']).toEqual([0.5, 0.75, 1, 1.25, 1.5]);
  });

  it('scans two parameters in long format', () => {
    const h = harness();
    expect(h.run('experiment', 'decay.physsim', '--param', 'k', '--from', '0.5', '--to', '1', '--points', '2', '--param2', 'x0', '--from2', '1', '--to2', '2', '--points2', '2')).toBe(0);
    const t = table(h.out());
    expect(t['k (1/s)']).toEqual([0.5, 1, 0.5, 1]);
    expect(t['x0 (m)']).toEqual([1, 1, 2, 2]);
    expect(t['final value of x (m)'][3]).toBeCloseTo(2 * Math.exp(-2), 6);
  });

  it('uses the parameter\'s own range when it is not the saved one', () => {
    const h = harness();
    expect(h.run('experiment', 'decay.physsim', '--param', 'x0', '--points', '3')).toBe(0);
    expect(table(h.out())['x0 (m)']).toEqual([0, 2.5, 5]);
  });

  it('says what is missing or wrong', () => {
    const bare = harness({ 'n.physsim': simFile({ ...decay, experiment: undefined }, 3, '0.1.0') });
    expect(bare.run('experiment', 'n.physsim')).toBe(2);
    expect(bare.err()).toMatch(/no saved experiment/);
    const h = harness();
    expect(h.run('experiment', 'decay.physsim', '--param', 'mass')).toBe(2);
    expect(h.err()).toMatch(/no parameter “mass”. Its parameters are: x0, k/);
    const m = harness();
    expect(m.run('experiment', 'decay.physsim', '--measure', 'biggest')).toBe(2);
    expect(m.err()).toMatch(/Unknown measure “biggest”/);
    const r = harness();
    expect(r.run('experiment', 'decay.physsim', '--from', '3', '--to', '1')).toBe(2);
    expect(r.err()).toMatch(/must be greater than/);
  });
});

describe('uncertainty', () => {
  it('samples the saved inputs and reports the spread and the sensitivity', () => {
    const h = harness();
    expect(h.run('uncertainty', 'decay.physsim')).toBe(0);
    const t = table(h.out());
    expect(Object.keys(t)).toEqual(['x0 (m)', 'k (1/s)', 'final value of x (m)']);
    expect(t['x0 (m)']).toHaveLength(128);
    const lines = header(h.out());
    expect(lines.find((l) => l.startsWith('# result:'))).toMatch(/mean 0\.7\d+, standard deviation 0\.0\d+/);
    expect(lines.filter((l) => l.startsWith('# sensitivity to'))).toHaveLength(2);
    expect(lines.find((l) => l.includes('uncertainty analysis'))).toMatch(/base sample 64, seed 3/);
    // The same seed gives the same file; another seed does not.
    const again = harness(); again.run('uncertainty', 'decay.physsim');
    expect(again.out()).toBe(h.out());
    const other = harness(); other.run('uncertainty', 'decay.physsim', '--seed', '4', '--samples', '32');
    expect(other.out()).not.toBe(h.out());
    expect(table(other.out())['x0 (m)']).toHaveLength(64);
  });

  it('needs an analysis saved in the file', () => {
    const h = harness({ 'n.physsim': simFile({ ...decay, uncertainty: undefined }, 3, '0.1.0') });
    expect(h.run('uncertainty', 'n.physsim')).toBe(2);
    expect(h.err()).toMatch(/no saved uncertainty analysis/);
  });
});

describe('check', () => {
  it('passes a model whose expectations hold', () => {
    const h = harness();
    expect(h.run('check', 'decay.physsim')).toBe(0);
    expect(h.out()).toMatch(/^Decay\n {2}run: ok — 200 steps, ended at t = 2/);
    expect(h.out()).toMatch(/expectations: 1 of 1 hold/);
    expect(h.out()).toMatch(/ok {3}final value of x = 0\.73\d+ ± 0\.000001 \(actual 0\.73/);
    expect(h.out()).toMatch(/model check: nothing to look at/);
  });

  it('exits 1 when a change breaks an expectation, which is what makes it useful in a pipeline', () => {
    const h = harness();
    expect(h.run('check', 'decay.physsim', '--set', 'k=0.6')).toBe(1);
    expect(h.out()).toMatch(/expectations: 0 of 1 hold/);
    expect(h.out()).toMatch(/FAIL final value of x/);
  });

  it('reports the model check without failing on it', () => {
    const odd = { ...decay, params: [...decay.params, { name: 'unused', value: 1, min: 0, max: 2 }] };
    const h = harness({ 'o.physsim': simFile(odd, 3, '0.1.0') });
    expect(h.run('check', 'o.physsim')).toBe(0);
    expect(h.out()).toMatch(/model check: 1 thing to look at\n {4}warning parameter unused is not used by any equation/);
  });

  it('exits 1 when the model does not run at all', () => {
    const broken = { ...decay, states: [{ name: 'x', init: 'x0', deriv: 'nope' }] };
    const h = harness({ 'b.physsim': simFile(broken, 3, '0.1.0') });
    expect(h.run('check', 'b.physsim')).toBe(1);
    expect(h.out()).toMatch(/run: FAILED — /);
  });
});

describe('template', () => {
  it('lists the templates and writes one as a file the other commands accept', () => {
    const list = harness();
    expect(list.run('template')).toBe(0);
    expect(list.out()).toMatch(/^projectile +Projectile with air drag$/m);
    expect(list.out().trim().split('\n')).toHaveLength(10);

    const h = harness();
    expect(h.run('template', 'pendulum', '--out', 'p.physsim')).toBe(0);
    expect(h.err()).toMatch(/Wrote the “Pendulum” template to p.physsim/);
    const next = harness({ 'p.physsim': h.written['p.physsim'] });
    expect(next.run('check', 'p.physsim')).toBe(0);
    expect(next.out()).toMatch(/^Pendulum\n {2}run: ok/);
  });

  it('every template runs from the command line', () => {
    const ids = harness(); ids.run('template');
    for (const id of ids.out().trim().split('\n').map((l) => l.split(/\s+/)[0])) {
      const made = harness(); made.run('template', id);
      const h = harness({ 'm.physsim': made.out() });
      expect(h.run('run', 'm.physsim'), id).toBe(0);
      expect(h.run('experiment', 'm.physsim'), id).toBe(0);
    }
    // Several hundred simulations: a few seconds here, longer on a shared CI machine.
  }, 60_000);

  it('names the templates when asked for one that does not exist', () => {
    const h = harness();
    expect(h.run('template', 'spring')).toBe(2);
    expect(h.err()).toMatch(/no template “spring”. The templates are: projectile, bounce/);
  });
});

describe('files and mistakes', () => {
  it('explains a file it cannot use', () => {
    const cases: [Record<string, string>, RegExp][] = [
      [{}, /Could not read “decay.physsim”/],
      [{ 'decay.physsim': 'not json' }, /is not a Math & Physics Workbench simulation/],
      [{ 'decay.physsim': JSON.stringify({ format: 99, ...decay }) }, /saved by a newer version/],
      [{ 'decay.physsim': JSON.stringify({ name: 'f', description: '', nodes: [], edges: [], model: {} }) }, /is an equation flow/],
    ];
    for (const [files, message] of cases) {
      const h = harness(files);
      expect(h.run('run', 'decay.physsim')).toBe(2);
      expect(h.err()).toMatch(message);
      expect(h.err()).toMatch(/Run with --help/);
    }
  });

  it('reads files from earlier formats and from the app\'s earlier name', () => {
    const old = JSON.stringify({ format: 1, app: '0.1.0', ...decay });
    const h = harness({ 'old.physsim': old });
    expect(h.run('run', 'old.physsim')).toBe(0);
  });

  it('rejects a bad command, a missing file and a bad --set', () => {
    const a = harness(); expect(a.run('simulate', 'decay.physsim')).toBe(2); expect(a.err()).toMatch(/Unknown command “simulate”/);
    const b = harness(); expect(b.run('run')).toBe(2); expect(b.err()).toMatch(/Which file\?/);
    const c = harness(); expect(c.run('run', 'decay.physsim', '--set', 'k')).toBe(2); expect(c.err()).toMatch(/expects name=number/);
    const d = harness(); expect(d.run('run', 'decay.physsim', '--set', 'k=fast')).toBe(2);
    const e = harness(); expect(e.run('run', 'decay.physsim', '--set', 'q=1')).toBe(2); expect(e.err()).toMatch(/no parameter “q”/);
    const f = harness(); expect(f.run('run', 'decay.physsim', '--end', '-1')).toBe(2);
  });
});
