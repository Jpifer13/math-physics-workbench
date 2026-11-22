import { describe, expect, it } from 'vitest';
import { blockName, diffFlow, diffSim, flowFile, layoutFlow, readDocument, simFile, writeDocument, type FlowFile } from './docfile';
import type { OdeModel } from './ode';

const model: OdeModel = {
  id: 'osc', name: 'Oscillator', summary: 'A mass on a spring',
  states: [{ name: 'x', init: 'x0', deriv: 'v', unit: 'm' }, { name: 'v', init: '0', deriv: '-k * x / m', unit: 'm/s' }],
  params: [{ name: 'k', value: 4, min: 0, max: 10, unit: 'N/m' }, { name: 'm', value: 1, min: 0.1, max: 5, unit: 'kg', label: 'Mass' }, { name: 'x0', value: 1, min: -2, max: 2 }],
  derived: [{ name: 'E', expr: '0.5 * m * v^2 + 0.5 * k * x^2', unit: 'J' }],
  events: [{ when: 'x < -1', then: 'v = -v' }],
  tEnd: 20, dt: 0.01, method: 'rk45', tol: 1e-8, timeSeries: ['x'], phase: ['x', 'v'],
  expectations: [{ observable: 'E', measure: 'range', compare: 'atMost', value: 1e-6 }],
  uncertainty: { inputs: [{ param: 'k', dist: 'normal', a: 4, b: 0.2 }], samples: 256, observable: 'x', measure: 'max', seed: 1 },
  data: { name: 'run.csv', columns: [{ name: 't', values: [0, 1, 2] }, { name: 'x', values: [1, 0.5, -0.2] }], timeCol: 0, pairs: [{ valueCol: 1, observable: 'x' }] },
  notes: 'First try.\nSecond line with "quotes".',
};

const flow: FlowFile = {
  name: 'Kinetic energy', description: '',
  nodes: [
    { id: 'n2', type: 'phys', position: { x: 300.4, y: 40 }, data: { kind: 'op', cfg: { op: 'mul' } } },
    { id: 'n1', type: 'phys', position: { x: 0, y: 0 }, data: { kind: 'quantity', cfg: { label: 'Mass', symbol: 'm', value: 2, unit: 'kg' } } },
    { id: 'n3', type: 'phys', position: { x: 600, y: 40 }, data: { kind: 'output', cfg: { label: 'Energy', symbol: 'E', unit: 'J' } } },
  ],
  edges: [{ id: 'n2->n3:value', source: 'n2', target: 'n3', targetHandle: 'value' }, { id: 'n1->n2:a', source: 'n1', target: 'n2', targetHandle: 'a', sourceHandle: null }],
  model: { outputId: 'n3', xId: 'n1', min: 0, max: 10 },
};

const lines = (s: string) => s.split('\n');
/** Lines that differ between two texts of the same length. */
const changed = (a: string, b: string) => lines(a).filter((l, i) => l !== lines(b)[i]);

describe('writing documents', () => {
  it('round-trips a simulation exactly', () => {
    const r = readDocument(simFile(model, 3, '0.1.0'), 3);
    expect(r.kind).toBe('sim');
    expect(r.kind === 'sim' && r.model).toEqual(model);
  });

  it('puts one state, parameter, observable and data column on each line', () => {
    const text = simFile(model, 3, '0.1.0');
    expect(lines(text).filter((l) => l.includes('"deriv"'))).toHaveLength(2);
    expect(lines(text).filter((l) => l.trim().startsWith('{ "name": "k"'))).toHaveLength(1);
    expect(lines(text).filter((l) => l.includes('"values"'))).toHaveLength(2);
    expect(text).toContain('    { "name": "x", "init": "x0", "deriv": "v", "unit": "m" },');
    // What the model computes comes before how it is shown, and the data comes last.
    expect(text.indexOf('"states"')).toBeLessThan(text.indexOf('"timeSeries"'));
    expect(text.indexOf('"timeSeries"')).toBeLessThan(text.indexOf('"data"'));
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('changes one line when one thing changes', () => {
    const edited = { ...model, params: model.params.map((p) => (p.name === 'k' ? { ...p, value: 5 } : p)) };
    const diff = changed(simFile(model, 3, '0.1.0'), simFile(edited, 3, '0.1.0'));
    expect(diff).toHaveLength(1);
    expect(diff[0]).toContain('"name": "k"');
  });

  it('does not depend on the order keys were set in', () => {
    const shuffled = { ...model, states: model.states.map((s) => ({ unit: s.unit, deriv: s.deriv, name: s.name, init: s.init })) };
    const reordered = Object.fromEntries(Object.entries(shuffled).reverse()) as unknown as OdeModel;
    expect(simFile(reordered, 3, '0.1.0')).toBe(simFile(model, 3, '0.1.0'));
  });

  it('gives a field it does not know a stable place', () => {
    const text = writeDocument({ zeta: 1, name: 'a', alpha: [1, 2] }, ['name']);
    expect(text).toBe('{\n  "name": "a",\n  "alpha": [1, 2],\n  "zeta": 1\n}\n');
    expect(JSON.parse(text)).toEqual({ name: 'a', alpha: [1, 2], zeta: 1 });
  });

  it('round-trips a flow, with blocks in a fixed order and positions apart', () => {
    const text = flowFile(flow, 3, '0.1.0');
    const r = readDocument(text, 3);
    expect(r.kind).toBe('flow');
    if (r.kind !== 'flow') return;
    expect(r.flow.nodes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3']);
    expect(r.flow.nodes[1]).toEqual({ id: 'n2', type: 'phys', position: { x: 300, y: 40 }, data: { kind: 'op', cfg: { op: 'mul' } } });
    expect(r.flow.edges.map((e) => e.id)).toEqual(['n1->n2:a', 'n2->n3:value']);
    expect(r.flow.model).toEqual(flow.model);
    expect(text).toContain('    { "id": "n1", "kind": "quantity", "cfg": { "label": "Mass", "symbol": "m", "value": 2, "unit": "kg" } },');
    expect(text).toContain('    "n2": [300, 40],');
  });

  it('moving a block, or re-ordering blocks in memory, touches only the layout', () => {
    const moved = { ...flow, nodes: [...flow.nodes].reverse().map((n) => (n.id === 'n1' ? { ...n, position: { x: 50, y: 80 } } : n)) };
    const diff = changed(flowFile(flow, 3, '0.1.0'), flowFile(moved, 3, '0.1.0'));
    expect(diff).toEqual(['    "n1": [0, 0],']);
  });
});

describe('reading documents', () => {
  it('reads flows written before positions moved into the layout', () => {
    const old = JSON.stringify({ format: 2, app: '0.1.0', ...flow });
    const r = readDocument(old, 3);
    expect(r.kind === 'flow' && r.flow.nodes.find((n) => n.id === 'n2')).toEqual(flow.nodes[0]);
  });

  it('reads simulations from every earlier format, and files with no format at all', () => {
    for (const format of [1, 2, undefined]) {
      const r = readDocument(JSON.stringify({ format, ...model }), 3);
      expect(r.kind === 'sim' && r.model).toEqual(model);
    }
  });

  it('refuses a newer file and anything that is not a document', () => {
    expect(readDocument(JSON.stringify({ format: 9, ...model }), 3)).toEqual({ kind: 'newer', format: 9 });
    expect(readDocument('not json', 3)).toEqual({ kind: 'unknown' });
    expect(readDocument('[1, 2]', 3)).toEqual({ kind: 'unknown' });
    expect(readDocument('{"hello": 1}', 3)).toEqual({ kind: 'unknown' });
    expect(readDocument('null', 3)).toEqual({ kind: 'unknown' });
  });
});

describe('comparing simulations', () => {
  it('finds nothing between a model and itself', () => {
    expect(diffSim(model, JSON.parse(JSON.stringify(model)))).toEqual([]);
  });

  it('ignores the order keys are stored in', () => {
    const scene = { bodies: [{ x: 'x', y: '0', label: 'mass', trail: true }] };
    const reordered = { bodies: [{ trail: true, label: 'mass', y: '0', x: 'x' }] };
    expect(diffSim({ ...model, scene }, { ...model, scene: reordered })).toEqual([]);
    // …including after a trip through a file.
    const r = readDocument(simFile({ ...model, scene }, 3, '0.1.0'), 3);
    expect(r.kind === 'sim' && diffSim({ ...model, scene }, r.model)).toEqual([]);
  });

  it('reports each change in the user\'s terms', () => {
    const after: OdeModel = {
      ...model,
      states: [{ ...model.states[0] }, { ...model.states[1], deriv: '-k * x / m - b * v' }],
      params: [{ ...model.params[0], value: 5 }, model.params[1], { name: 'b', value: 0.1, min: 0, max: 1 }],
      derived: [],
      events: [],
      tol: 1e-10,
      notes: 'Added damping.',
    };
    const d = diffSim(model, after);
    const find = (what: string) => d.find((c) => c.what === what);
    expect(find('dv/dt')).toMatchObject({ kind: 'changed', before: '-k * x / m', after: '-k * x / m - b * v', numeric: true });
    expect(find('k')).toMatchObject({ kind: 'changed', before: '4', after: '5', section: 'Parameters' });
    expect(find('b')).toMatchObject({ kind: 'added', after: '0.1' });
    expect(find('x0')).toMatchObject({ kind: 'removed', before: '1' });
    expect(find('E')).toMatchObject({ kind: 'removed', section: 'Observables' });
    expect(find('event')).toMatchObject({ kind: 'removed', before: 'when x < -1 then v = -v' });
    expect(find('relative tolerance')).toMatchObject({ before: '1e-8', after: '1e-10', numeric: true });
    expect(find('notes')).toMatchObject({ numeric: false });
    expect(d).toHaveLength(8);
  });

  it('separates what changes the numbers from what does not', () => {
    const after: OdeModel = { ...model, name: 'Renamed', timeSeries: ['x', 'v'], dt: 0.5, params: model.params.map((p) => ({ ...p, max: p.max * 2 })) };
    const d = diffSim(model, after);
    expect(d.length).toBeGreaterThan(3);
    // The step of a fixed-step method is unused while both versions are adaptive.
    expect(d.every((c) => !c.numeric)).toBe(true);
    expect(diffSim({ ...model, method: 'rk4' }, { ...after, method: 'rk4' }).find((c) => c.what === 'step')?.numeric).toBe(true);
  });

  it('notices data whose values changed under the same columns', () => {
    const after = { ...model, data: { ...model.data!, columns: [model.data!.columns[0], { name: 'x', values: [1, 0.5, -0.3] }] } };
    expect(diffSim(model, after)).toEqual([expect.objectContaining({ what: 'measured data', numeric: false })]);
    expect(diffSim(model, { ...model, data: undefined })[0]).toMatchObject({ what: 'measured data', after: '—' });
  });
});

describe('comparing flows', () => {
  it('finds nothing between a flow and its saved form', () => {
    const r = readDocument(flowFile({ ...flow, nodes: flow.nodes.map((n) => ({ ...n, position: { x: Math.round(n.position.x), y: n.position.y } })) }, 3, '0.1.0'), 3);
    expect(r.kind === 'flow' && diffFlow(flow, r.flow)).toEqual([]);
  });

  it('names blocks and wires as the user sees them', () => {
    const after: FlowFile = {
      ...flow,
      nodes: [
        { ...flow.nodes[1], position: { x: 10, y: 10 }, data: { kind: 'quantity', cfg: { label: 'Mass', symbol: 'm', value: 3, unit: 'kg' } } },
        flow.nodes[2],
        { id: 'n4', position: { x: 0, y: 0 }, data: { kind: 'op', cfg: { op: 'square' } } },
      ],
      edges: [{ id: 'n1->n4:x', source: 'n1', target: 'n4', targetHandle: 'x' }],
    };
    const d = diffFlow(flow, after);
    expect(d).toContainEqual(expect.objectContaining({ section: 'Blocks', kind: 'changed', what: 'Mass: value', before: '2', after: '3', numeric: true }));
    expect(d).toContainEqual(expect.objectContaining({ section: 'Blocks', kind: 'removed', what: 'mul' }));
    expect(d).toContainEqual(expect.objectContaining({ section: 'Blocks', kind: 'added', what: 'square' }));
    expect(d).toContainEqual(expect.objectContaining({ section: 'Wires', kind: 'removed', before: 'Mass → mul (a)' }));
    expect(d).toContainEqual(expect.objectContaining({ section: 'Wires', kind: 'added', after: 'Mass → square (x)' }));
    expect(d).toContainEqual(expect.objectContaining({ what: 'positions', after: '1 block moved', numeric: false }));
    expect(blockName(flow.nodes[2])).toBe('Energy');
  });
});

describe('auto-layout', () => {
  it('places each block to the right of everything feeding it', () => {
    const at = layoutFlow(flow.nodes, flow.edges);
    expect(at.n1.x).toBeLessThan(at.n2.x);
    expect(at.n2.x).toBeLessThan(at.n3.x);
    expect(new Set([at.n1.y, at.n2.y, at.n3.y]).size).toBe(1);
  });

  it('stacks the blocks of a column without overlap and keeps wires short', () => {
    const nodes = ['a', 'b', 'c', 'sum', 'out'].map((id) => ({ id }));
    const edges = [{ source: 'c', target: 'out' }, { source: 'a', target: 'sum' }, { source: 'b', target: 'sum' }, { source: 'sum', target: 'out' }];
    const at = layoutFlow(nodes, edges);
    expect(new Set([at.a.y, at.b.y, at.c.y]).size).toBe(3);
    expect([at.a.x, at.b.x, at.c.x]).toEqual([0, 0, 0]);
    // The furthest input sets the column: out is fed by c (column 0) and sum (column 1).
    expect(at.out.x).toBeGreaterThan(at.sum.x);
    // sum sits level with the middle of the two blocks feeding it.
    expect(at.sum.y).toBeCloseTo((at.a.y + at.b.y) / 2, 0);
  });

  it('copes with a loop, a dangling wire and no wires at all', () => {
    const loop = layoutFlow([{ id: 'a' }, { id: 'b' }], [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }, { source: 'gone', target: 'a' }]);
    expect(Object.values(loop).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(loop.a.x).not.toBe(loop.b.x);
    const loose = layoutFlow([{ id: 'a' }, { id: 'b' }], []);
    expect(loose.a.x).toBe(0);
    expect(loose.a.y).not.toBe(loose.b.y);
    expect(layoutFlow([], [])).toEqual({});
  });
});
