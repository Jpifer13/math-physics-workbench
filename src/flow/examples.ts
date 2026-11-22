import type { NodeKind } from '../core/graph';
import { emptyModel, type Cfg, type FEdge, type FlowDoc, type FNode, type ModelCfg } from './types';

type N = [id: string, kind: NodeKind, cfg: Cfg, col: number, row: number];
type W = [source: string, target: string, port: string];

const COL = 290;
const ROW = 150;

export const makeEdge = (source: string, target: string, port: string): FEdge => ({
  id: `${source}->${target}:${port}`, source, target, targetHandle: port,
});

function flow(name: string, description: string, nodes: N[], wires: W[], model: Partial<ModelCfg>): FlowDoc {
  return {
    name,
    description,
    nodes: nodes.map(([id, kind, cfg, col, row]): FNode => ({
      id, type: 'phys', position: { x: col * COL, y: row * ROW }, data: { kind, cfg },
    })),
    edges: wires.map(([s, t, p]) => makeEdge(s, t, p)),
    model: { ...emptyModel(), ...model },
  };
}

const q = (label: string, symbol: string, value: number, unit: string): Cfg => ({ label, symbol, value, unit });
const k = (constId: string): Cfg => ({ constId });
const op = (id: string): Cfg => ({ op: id });
const out = (label: string, symbol: string, unit = ''): Cfg => ({ label, symbol, unit });

export const EXAMPLES: FlowDoc[] = [
  flow(
    'Mass–energy equivalence',
    'E = mc². A mass node feeds a multiply node; the speed of light is squared first. Because c² is enormous, a tiny mass is a vast amount of energy — try the "kt TNT" unit on the output.',
    [
      ['m', 'quantity', q('Mass', 'm', 1, 'kg'), 0, 0],
      ['c', 'constant', k('c'), 0, 1.2],
      ['sq', 'op', op('square'), 1, 1.2],
      ['mul', 'op', op('mul'), 2, 0.5],
      ['E', 'output', out('Energy', 'E', 'J'), 3, 0.5],
    ],
    [['c', 'sq', 'x'], ['m', 'mul', 'a'], ['sq', 'mul', 'b'], ['mul', 'E', 'in']],
    { outputId: 'E', xId: 'm', min: 0, max: 10 },
  ),
  flow(
    'Kinetic energy',
    'KE = ½mv². Energy grows with the square of speed: doubling the speed quadruples the energy. Switch the chart to "Map" to see how mass and speed trade off.',
    [
      ['m', 'quantity', q('Mass', 'm', 2, 'kg'), 0, 0],
      ['v', 'quantity', q('Speed', 'v', 3, 'm/s'), 0, 1.3],
      ['sq', 'op', op('square'), 1, 1.3],
      ['mul', 'op', op('mul'), 2, 0.5],
      ['half', 'op', op('half'), 3, 0.5],
      ['KE', 'output', out('Kinetic energy', 'KE', 'J'), 4, 0.5],
    ],
    [['v', 'sq', 'x'], ['m', 'mul', 'a'], ['sq', 'mul', 'b'], ['mul', 'half', 'x'], ['half', 'KE', 'in']],
    { outputId: 'KE', xId: 'v', min: 0, max: 10, yId: 'm', yMin: 0, yMax: 10 },
  ),
  flow(
    "Newton's law of gravitation",
    'F = G·m₁·m₂ / r². The default values are the Earth and a 70 kg person standing on its surface — the force is their weight. Sweep r to watch the inverse-square falloff.',
    [
      ['G', 'constant', k('G'), 0, 0],
      ['m1', 'quantity', q('Mass 1 (Earth)', 'm_1', 5.9722e24, 'kg'), 0, 1],
      ['m2', 'quantity', q('Mass 2 (person)', 'm_2', 70, 'kg'), 0, 2.3],
      ['r', 'quantity', q('Separation', 'r', 6371, 'km'), 0, 3.6],
      ['mm', 'op', op('mul'), 1, 1.6],
      ['gmm', 'op', op('mul'), 2, 0.7],
      ['r2', 'op', op('square'), 1, 3.6],
      ['div', 'op', op('div'), 3, 1.8],
      ['F', 'output', out('Gravitational force', 'F', 'N'), 4, 1.8],
    ],
    [['m1', 'mm', 'a'], ['m2', 'mm', 'b'], ['G', 'gmm', 'a'], ['mm', 'gmm', 'b'], ['r', 'r2', 'x'], ['gmm', 'div', 'a'], ['r2', 'div', 'b'], ['div', 'F', 'in']],
    { outputId: 'F', xId: 'r', min: 6371, max: 60000 },
  ),
  flow(
    'Pendulum period',
    'T = 2π√(L/g). For small swings the period depends only on length and gravity — not on the mass or the amplitude. Compare with the nonlinear pendulum in the Simulation Lab.',
    [
      ['L', 'quantity', q('Length', 'L', 1, 'm'), 0, 0],
      ['g', 'constant', k('g'), 0, 1.3],
      ['div', 'op', op('div'), 1, 0.5],
      ['sqrt', 'op', op('sqrt'), 2, 0.5],
      ['pi', 'constant', k('pi'), 1, 2],
      ['two', 'op', op('double'), 2, 2],
      ['mul', 'op', op('mul'), 3, 1.1],
      ['T', 'output', out('Period', 'T', 's'), 4, 1.1],
    ],
    [['L', 'div', 'a'], ['g', 'div', 'b'], ['div', 'sqrt', 'x'], ['pi', 'two', 'x'], ['two', 'mul', 'a'], ['sqrt', 'mul', 'b'], ['mul', 'T', 'in']],
    { outputId: 'T', xId: 'L', min: 0.05, max: 5 },
  ),
  flow(
    'Projectile range',
    'R = v₀² sin(2θ) / g, written with a Formula node — type any expression and it grows an input port per variable. The range peaks at 45°.',
    [
      ['v', 'quantity', q('Launch speed', 'v_0', 20, 'm/s'), 0, 0],
      ['th', 'quantity', q('Launch angle', 'theta', 45, 'deg'), 0, 1.3],
      ['g', 'constant', k('g'), 0, 2.6],
      ['f', 'formula', { label: 'Range formula', expr: 'v^2 * sin(2*theta) / g' }, 1.2, 1],
      ['R', 'output', out('Range', 'R', 'm'), 2.4, 1.2],
    ],
    [['v', 'f', 'v'], ['th', 'f', 'theta'], ['g', 'f', 'g'], ['f', 'R', 'in']],
    { outputId: 'R', xId: 'th', min: 0, max: 90, yId: 'v', yMin: 0, yMax: 40 },
  ),
  flow(
    'Lorentz factor',
    'γ = 1/√(1 − v²/c²). Time dilation and length contraction both scale with γ. It stays near 1 at everyday speeds and blows up as v approaches c.',
    [
      ['v', 'quantity', q('Speed', 'v', 150000, 'km/s'), 0, 0],
      ['c', 'constant', k('c'), 0, 1.3],
      ['f', 'formula', { label: 'Lorentz factor', expr: '1 / sqrt(1 - v^2 / c^2)' }, 1.2, 0.5],
      ['gamma', 'output', out('Lorentz factor', 'gamma'), 2.4, 0.6],
    ],
    [['v', 'f', 'v'], ['c', 'f', 'c'], ['f', 'gamma', 'in']],
    { outputId: 'gamma', xId: 'v', min: 0, max: 299000 },
  ),
  flow(
    'de Broglie wavelength',
    'λ = h / (m·v). Every moving particle has a wavelength. For an electron it is comparable to atomic spacing, which is why electron microscopes work.',
    [
      ['h', 'constant', k('h'), 0, 0],
      ['m', 'constant', k('me'), 0, 1.2],
      ['v', 'quantity', q('Speed', 'v', 1e6, 'm/s'), 0, 2.4],
      ['p', 'op', op('mul'), 1, 1.8],
      ['div', 'op', op('div'), 2, 0.8],
      ['lam', 'output', out('Wavelength', 'lambda', 'nm'), 3, 0.8],
    ],
    [['m', 'p', 'a'], ['v', 'p', 'b'], ['h', 'div', 'a'], ['p', 'div', 'b'], ['div', 'lam', 'in']],
    { outputId: 'lam', xId: 'v', min: 1e4, max: 1e8, logX: true, logY: true },
  ),
  flow(
    'Ideal gas law',
    'P = nRT / V. Pressure rises with temperature and falls as the gas is given more room. The default is one mole at room temperature in 24 L — about one atmosphere.',
    [
      ['n', 'quantity', q('Amount', 'n', 1, 'mol'), 0, 0],
      ['R', 'constant', k('R'), 0, 1.3],
      ['T', 'quantity', q('Temperature', 'T', 293, 'K'), 0, 2.4],
      ['V', 'quantity', q('Volume', 'V', 24, 'L'), 0, 3.7],
      ['nR', 'op', op('mul'), 1, 0.6],
      ['nRT', 'op', op('mul'), 2, 1.5],
      ['div', 'op', op('div'), 3, 2.5],
      ['P', 'output', out('Pressure', 'P', 'kPa'), 4, 2.5],
    ],
    [['n', 'nR', 'a'], ['R', 'nR', 'b'], ['nR', 'nRT', 'a'], ['T', 'nRT', 'b'], ['nRT', 'div', 'a'], ['V', 'div', 'b'], ['div', 'P', 'in']],
    { outputId: 'P', xId: 'V', min: 5, max: 60, yId: 'T', yMin: 100, yMax: 600 },
  ),
  flow(
    'Photon energy',
    'E = hc / λ. Shorter wavelengths carry more energy per photon: visible light is a couple of electronvolts, ultraviolet enough to break chemical bonds.',
    [
      ['h', 'constant', k('h'), 0, 0],
      ['c', 'constant', k('c'), 0, 1.2],
      ['lam', 'quantity', q('Wavelength', 'lambda', 500, 'nm'), 0, 2.4],
      ['hc', 'op', op('mul'), 1, 0.6],
      ['div', 'op', op('div'), 2, 1.5],
      ['E', 'output', out('Photon energy', 'E', 'eV'), 3, 1.5],
    ],
    [['h', 'hc', 'a'], ['c', 'hc', 'b'], ['hc', 'div', 'a'], ['lam', 'div', 'b'], ['div', 'E', 'in']],
    { outputId: 'E', xId: 'lam', min: 100, max: 1000 },
  ),
  flow(
    'Escape velocity',
    'v = √(2GM / r). The speed needed to coast away from a body forever. From the Earth\'s surface it is about 11.2 km/s, and it drops the higher you start.',
    [
      ['G', 'constant', k('G'), 0, 0],
      ['M', 'constant', k('Mearth'), 0, 1.2],
      ['r', 'quantity', q('Distance from centre', 'r', 6371, 'km'), 0, 2.4],
      ['f', 'formula', { label: 'Escape velocity', expr: 'sqrt(2 * G * M / r)' }, 1.2, 1],
      ['v', 'output', out('Escape velocity', 'v_esc', 'km/s'), 2.4, 1.2],
    ],
    [['G', 'f', 'G'], ['M', 'f', 'M'], ['r', 'f', 'r'], ['f', 'v', 'in']],
    { outputId: 'v', xId: 'r', min: 6371, max: 60000 },
  ),
];
