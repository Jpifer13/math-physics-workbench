import { describe, expect, it } from 'vitest';
import { APP_NAME, isRunRecordKind, provenanceTitle, readProvenanceTitle, readStored, RUN_RECORD_KIND, storageKey } from './brand';
import { parseTable } from './fit';
import { toCsv } from './measure';
import { readDocument } from './docfile';

const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
  };
};

describe('the app\'s name in files', () => {
  it('writes the current name and reads it back', () => {
    const line = provenanceTitle('0.2.0', '2026-12-01T00:00:00Z');
    expect(line).toBe('Math & Physics Workbench 0.2.0 — exported 2026-12-01T00:00:00Z');
    expect(readProvenanceTitle(line)).toEqual({ app: APP_NAME, version: '0.2.0', when: '2026-12-01T00:00:00Z' });
    expect(readProvenanceTitle(`# ${line}`)).toEqual({ app: APP_NAME, version: '0.2.0', when: '2026-12-01T00:00:00Z' });
  });

  it('still reads headers written under the earlier name', () => {
    expect(readProvenanceTitle('# Physics Tooling 0.1.0 — exported 2026-11-22T22:42:52.236Z'))
      .toEqual({ app: 'Physics Tooling', version: '0.1.0', when: '2026-11-22T22:42:52.236Z' });
    expect(readProvenanceTitle('# Some Other Program 1.0 — exported today')).toBeNull();
    expect(readProvenanceTitle('# model: Projectile')).toBeNull();
  });

  it('imports a CSV exported by an earlier version, header and all', () => {
    const old = [
      '# Physics Tooling 0.1.0 — exported 2026-11-22T22:42:52.236Z',
      '# model: Projectile with air drag (fingerprint 110b57ca5d985078)',
      '# solver: RK4, step 0.005, duration 30',
      't,x', '0,0', '1,2.5', '2,4.75',
    ].join('\n');
    const columns = parseTable(old);
    expect(columns.map((c) => c.name)).toEqual(['t', 'x']);
    expect(columns[1].values).toEqual([0, 2.5, 4.75]);
    // …and one written now, whose name contains an ampersand and spaces.
    const now = toCsv([{ name: 't', values: [0, 1, 2] }, { name: 'x', values: [0, 2.5, 4.75] }], [provenanceTitle('0.2.0', 'now'), 'model: Projectile']);
    expect(now.startsWith('# Math & Physics Workbench 0.2.0')).toBe(true);
    expect(parseTable(now)[1].values).toEqual([0, 2.5, 4.75]);
  });

  it('recognises run records from before and after the rename', () => {
    expect(RUN_RECORD_KIND).toBe('math-physics-workbench-run-record');
    expect(isRunRecordKind(RUN_RECORD_KIND)).toBe(true);
    expect(isRunRecordKind('physics-tooling-run-record')).toBe(true);
    expect(isRunRecordKind('something-else')).toBe(false);
    expect(isRunRecordKind(undefined)).toBe(false);
  });

  it('opens documents saved by the app under its earlier name', () => {
    const sim = JSON.stringify({ format: 2, app: '0.1.0', id: 'm', name: 'Old', summary: '', states: [{ name: 'x', init: '0', deriv: '1' }], params: [], derived: [], tEnd: 1, dt: 0.1, timeSeries: ['x'], phase: ['x', 'x'] });
    expect(readDocument(sim, 3).kind).toBe('sim');
    const flow = JSON.stringify({ format: 1, name: 'Old flow', description: '', nodes: [], edges: [], model: {} });
    expect(readDocument(flow, 3).kind).toBe('flow');
  });
});

describe('stored settings', () => {
  it('uses keys under the current name', () => {
    expect(storageKey('sim.v1')).toBe('math-physics-workbench.sim.v1');
  });

  it('finds a setting saved under the earlier name and moves it across', () => {
    const store = memory({ 'physics-tooling.sim.v1': '{"name":"Working copy"}' });
    expect(readStored(store, 'sim.v1')).toBe('{"name":"Working copy"}');
    expect(store.data.get('math-physics-workbench.sim.v1')).toBe('{"name":"Working copy"}');
    expect(store.data.has('physics-tooling.sim.v1')).toBe(false);
    // The second read needs no migration.
    expect(readStored(store, 'sim.v1')).toBe('{"name":"Working copy"}');
  });

  it('prefers what was saved under the current name', () => {
    const store = memory({ 'physics-tooling.flow.v1': 'old', 'math-physics-workbench.flow.v1': 'new' });
    expect(readStored(store, 'flow.v1')).toBe('new');
    expect(store.data.get('physics-tooling.flow.v1')).toBe('old');
  });

  it('gives null when nothing was ever saved', () => {
    expect(readStored(memory(), 'hints.v1')).toBeNull();
  });
});
