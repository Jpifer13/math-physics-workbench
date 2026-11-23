import { describe, expect, it } from 'vitest';
import { toText } from './expr';
import { evaluate, expandGroups, groupNodes, inputPorts, sweep, ungroupNode, upstreamOf, type GNode, type Graph, type GroupData } from './graph';

const q = (id: string, symbol: string, value: number, unit: string): GNode => ({ id, kind: 'quantity', data: { label: symbol, symbol, value, unit } });
const op = (id: string, name: string): GNode => ({ id, kind: 'op', data: { op: name } });

/** Kinetic energy, E = ½·m·v², built from single-operation blocks. */
const kinetic: Graph = {
  nodes: [q('m', 'm', 2, 'kg'), q('v', 'v', 3, 'm/s'), op('sq', 'square'), op('mul', 'mul'), op('half', 'half'), { id: 'E', kind: 'output', data: { label: 'Energy', symbol: 'E', unit: 'J' } }],
  edges: [
    { source: 'v', target: 'sq', port: 'x' }, { source: 'm', target: 'mul', port: 'a' }, { source: 'sq', target: 'mul', port: 'b' },
    { source: 'mul', target: 'half', port: 'x' }, { source: 'half', target: 'E', port: 'in' },
  ],
};
const grouped = (g: Graph, ids: string[], id = 'G', label = 'Half m v squared') => {
  const r = groupNodes(g, ids, id, label);
  if ('problem' in r) throw new Error(r.problem);
  return r.graph;
};
const value = (g: Graph, id: string) => evaluate(g).get(id)!;

describe('grouping blocks', () => {
  it('gives the same answer, units and formula as the blocks it replaced', () => {
    const before = value(kinetic, 'E');
    const g = grouped(kinetic, ['sq', 'mul', 'half']);
    const after = value(g, 'E');
    expect(after.q!.v).toBe(9);
    expect(after.q).toEqual(before.q);
    expect(toText(after.ex!)).toBe(toText(before.ex!));
    // The group block itself shows the value it passes on.
    expect(value(g, 'G').q!.v).toBe(9);
  });

  it('turns the wires that crossed the boundary into ports and one output', () => {
    const g = grouped(kinetic, ['sq', 'mul', 'half']);
    expect(g.nodes.map((n) => n.id)).toEqual(['m', 'v', 'E', 'G']);
    const data = g.nodes.find((n) => n.id === 'G')!.data as GroupData;
    expect(data.nodes.map((n) => n.id)).toEqual(['sq', 'mul', 'half']);
    expect(data.edges).toHaveLength(2);
    expect(data.output).toBe('half');
    expect(inputPorts(g.nodes.find((n) => n.id === 'G')!)).toEqual(['v', 'm']);
    expect(g.edges).toEqual(expect.arrayContaining([
      { source: 'v', target: 'G', port: 'v' }, { source: 'm', target: 'G', port: 'm' }, { source: 'G', target: 'E', port: 'in' },
    ]));
    expect(g.edges).toHaveLength(3);
  });

  it('keeps an input inside the group as a fixed value of the block', () => {
    // Group the speed with the squaring: the group needs only the mass from outside.
    const g = grouped(kinetic, ['v', 'sq', 'mul', 'half']);
    expect(inputPorts(g.nodes.find((n) => n.id === 'G')!)).toEqual(['m']);
    expect(value(g, 'E').q!.v).toBe(9);
    // Sweeping the mass, still outside, works through the group.
    expect(sweep(g, 'E', 'm', [0, 2, 4]).y).toEqual([0, 9, 18]);
    expect(upstreamOf(g, 'E')).toEqual(new Set(['G', 'm']));
  });

  it('uses one port when the same outside block feeds two inner inputs', () => {
    // v × v, with v outside.
    const square: Graph = { nodes: [q('v', 'v', 3, 'm/s'), op('mul', 'mul'), op('dbl', 'double')], edges: [{ source: 'v', target: 'mul', port: 'a' }, { source: 'v', target: 'mul', port: 'b' }, { source: 'mul', target: 'dbl', port: 'x' }] };
    const g = grouped(square, ['mul', 'dbl']);
    expect(inputPorts(g.nodes.find((n) => n.id === 'G')!)).toEqual(['v']);
    expect(g.edges).toEqual([{ source: 'v', target: 'G', port: 'v' }]);
    expect(value(g, 'G').q!.v).toBe(18);
  });

  it('names ports after what feeds them, falling back to the inner input and keeping them distinct', () => {
    // (p + r) and (s + u) summed. Two quantities share the symbol p; a block with no symbol gives the inner port's name.
    const g0: Graph = {
      nodes: [q('p', 'p', 1, 'm'), q('r', 'r', 2, 'm'), q('s', 'p', 3, 'm'), q('u0', 'u', 2, 'm'), op('u', 'double'), op('add1', 'add'), op('add2', 'add'), op('sum', 'add')],
      edges: [
        { source: 'p', target: 'add1', port: 'a' }, { source: 'r', target: 'add1', port: 'b' }, { source: 's', target: 'add2', port: 'a' }, { source: 'u', target: 'add2', port: 'b' }, { source: 'u0', target: 'u', port: 'x' },
        { source: 'add1', target: 'sum', port: 'a' }, { source: 'add2', target: 'sum', port: 'b' },
      ],
    };
    const g = grouped(g0, ['add1', 'add2', 'sum']);
    expect(inputPorts(g.nodes.find((n) => n.id === 'G')!)).toEqual(['p', 'r', 'p2', 'b']);
    expect(value(g, 'G').q!.v).toBe(10);
  });

  it('still catches a unit mismatch, and names the block inside that failed', () => {
    // kg + m/s is not a sum; the doubling after it merely waits on it.
    const bad: Graph = { nodes: [q('m', 'm', 2, 'kg'), q('v', 'v', 3, 'm/s'), op('add', 'add'), op('dbl', 'double')], edges: [{ source: 'm', target: 'add', port: 'a' }, { source: 'v', target: 'add', port: 'b' }, { source: 'add', target: 'dbl', port: 'x' }] };
    const cause = value(bad, 'add').error!;
    expect(value(bad, 'dbl').error).toBe('Waiting on an upstream node');
    const g = grouped(bad, ['add', 'dbl']);
    expect(value(g, 'G').error).toBe(`Inside the group, Add: ${cause}`);
  });

  it('reports an unconnected port of a group', () => {
    const g = grouped(kinetic, ['sq', 'mul', 'half']);
    const open = { ...g, edges: g.edges.filter((e) => e.source !== 'm') };
    expect(value(open, 'G').error).toBe('Inside the group, Multiply: Input "a" is not connected');
  });

  it('passes on a failure that lies outside the group as it is', () => {
    const g = grouped(kinetic, ['sq', 'mul', 'half']);
    const broken = { ...g, nodes: g.nodes.map((n) => (n.id === 'm' ? q('m', 'm', NaN, 'kg') : n)) };
    expect(value(broken, 'G')).toMatchObject({ error: 'Waiting on an upstream node', upstream: true });
  });

  it('explains a selection that cannot be a group', () => {
    const problem = (ids: string[]) => { const r = groupNodes(kinetic, ids, 'G', 'x'); return 'problem' in r ? r.problem : ''; };
    expect(problem(['sq'])).toMatch(/at least two blocks/);
    expect(problem(['half', 'E'])).toMatch(/Result block cannot go inside a group/);
    // m and sq both send a value to mul, outside the selection.
    expect(problem(['m', 'sq'])).toMatch(/one output, but 2 of these blocks \(m, Square\) pass a value on/);
    expect(problem(['nope', 'sq'])).toMatch(/at least two blocks/);
  });

  it('picks the block nothing consumes when no wire leaves the selection', () => {
    const loose: Graph = { nodes: [q('v', 'v', 3, 'm/s'), op('sq', 'square')], edges: [{ source: 'v', target: 'sq', port: 'x' }] };
    const g = grouped(loose, ['v', 'sq']);
    expect((g.nodes[0].data as GroupData).output).toBe('sq');
    expect(value(g, 'G').q!.v).toBe(9);
  });
});

describe('groups inside groups, and copies', () => {
  it('evaluates a group nested in a group', () => {
    const inner = grouped(kinetic, ['sq', 'mul'], 'inner', 'm v squared');
    const outer = grouped(inner, ['inner', 'half'], 'outer', 'kinetic');
    expect(outer.nodes.map((n) => n.id)).toEqual(['m', 'v', 'E', 'outer']);
    expect(value(outer, 'E').q!.v).toBe(9);
    expect(value(outer, 'outer').q!.v).toBe(9);
    const flat = expandGroups(outer);
    expect(flat.graph.nodes.some((n) => n.kind === 'group')).toBe(false);
    expect(flat.outputs.get('outer')).toBe('outer/half');
    expect(flat.graph.nodes.map((n) => n.id)).toContain('outer/inner/sq');
  });

  it('lets two copies of a group work side by side on different inputs', () => {
    const g = grouped(kinetic, ['sq', 'mul', 'half']);
    const group = g.nodes.find((n) => n.id === 'G')!;
    const two: Graph = {
      nodes: [...g.nodes, { ...group, id: 'G2' }, q('m2', 'M', 10, 'kg')],
      edges: [...g.edges, { source: 'v', target: 'G2', port: 'v' }, { source: 'm2', target: 'G2', port: 'm' }],
    };
    expect(value(two, 'G').q!.v).toBe(9);
    expect(value(two, 'G2').q!.v).toBe(45);
  });

  it('leaves a graph with no groups exactly as it was', () => {
    expect(expandGroups(kinetic).graph).toBe(kinetic);
  });
});

describe('ungrouping', () => {
  it('restores the original blocks and wires', () => {
    const g = grouped(kinetic, ['sq', 'mul', 'half']);
    const back = ungroupNode(g, 'G', (id) => `${id}_copy`)!;
    const key = (e: { source: string; target: string; port: string }) => `${e.source}>${e.target}:${e.port}`;
    expect(back.graph.nodes.map((n) => n.id).sort()).toEqual(kinetic.nodes.map((n) => n.id).sort());
    expect(back.graph.edges.map(key).sort()).toEqual(kinetic.edges.map(key).sort());
    expect(value(back.graph, 'E').q!.v).toBe(9);
  });

  it('renames inner blocks whose ids are taken, as when a copy is opened', () => {
    const g = grouped(kinetic, ['sq', 'mul', 'half']);
    const group = g.nodes.find((n) => n.id === 'G')!;
    const two: Graph = { nodes: [...g.nodes, { ...group, id: 'G2' }], edges: [...g.edges, { source: 'v', target: 'G2', port: 'v' }, { source: 'm', target: 'G2', port: 'm' }] };
    const first = ungroupNode(two, 'G', (id) => `${id}_copy`)!;
    const second = ungroupNode(first.graph, 'G2', (id) => `${id}_copy`)!;
    expect(second.ids).toEqual({ sq: 'sq_copy', mul: 'mul_copy', half: 'half_copy' });
    const ids = second.graph.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(value(second.graph, 'half_copy').q!.v).toBe(9);
    expect(value(second.graph, 'E').q!.v).toBe(9);
  });

  it('is nothing to do for a block that is not a group', () => {
    expect(ungroupNode(kinetic, 'sq', (id) => id)).toBeNull();
    expect(ungroupNode(kinetic, 'missing', (id) => id)).toBeNull();
  });
});
