/** Everything that can be dragged from the palette onto the canvas. */
import { OPS, type NodeKind } from '../core/graph';
import { CONSTANTS } from '../core/units';
import type { Cfg } from './types';

export interface PaletteItem {
  key: string;
  kind: NodeKind;
  cfg: Cfg;
  title: string;
  glyph: string;
  hint: string;
}
export interface PaletteGroup {
  title: string;
  tone: Tone;
  items: PaletteItem[];
}
export type Tone = 'input' | 'constant' | 'op' | 'formula' | 'output' | 'group';

export const toneOf = (kind: NodeKind): Tone =>
  kind === 'quantity' ? 'input' : kind === 'constant' ? 'constant' : kind === 'op' ? 'op' : kind === 'formula' ? 'formula' : kind === 'group' ? 'group' : 'output';

const quantity = (label: string, symbol: string, value: number, unit: string, glyph = symbol): PaletteItem => ({
  key: `q-${label}`, kind: 'quantity', cfg: { label, symbol, value, unit }, title: label, glyph,
  hint: `An adjustable ${label.toLowerCase()} input${unit ? ` in ${unit}` : ''}`,
});

export const PALETTE: PaletteGroup[] = [
  {
    title: 'Inputs',
    tone: 'input',
    items: [
      quantity('Number', 'x', 1, '', '#'),
      quantity('Mass', 'm', 1, 'kg'),
      quantity('Length', 'L', 1, 'm'),
      quantity('Distance', 'd', 1, 'm'),
      quantity('Radius', 'r', 1, 'm'),
      quantity('Time', 't', 1, 's'),
      quantity('Speed', 'v', 1, 'm/s'),
      quantity('Acceleration', 'a', 1, 'm/s²'),
      quantity('Force', 'F', 1, 'N'),
      quantity('Energy', 'E', 1, 'J'),
      quantity('Angle', 'theta', 45, 'deg', 'θ'),
      quantity('Frequency', 'f', 1, 'Hz'),
      quantity('Wavelength', 'lambda', 500, 'nm', 'λ'),
      quantity('Temperature', 'T', 293, 'K'),
      quantity('Charge', 'q', 1, 'µC'),
      quantity('Voltage', 'V', 1, 'V'),
      quantity('Current', 'I', 1, 'A'),
      quantity('Resistance', 'R', 1, 'Ω'),
      quantity('Pressure', 'P', 101.325, 'kPa'),
      quantity('Volume', 'V', 1, 'L'),
    ],
  },
  {
    title: 'Constants',
    tone: 'constant',
    items: CONSTANTS.map((c) => ({
      key: `c-${c.id}`, kind: 'constant' as const, cfg: { constId: c.id }, title: c.name, glyph: c.symbol,
      hint: `${c.name}${c.note ? ` — ${c.note}` : ''}`,
    })),
  },
  ...(['Arithmetic', 'Powers & roots', 'Trigonometry', 'Exponential'] as const).map((group) => ({
    title: group,
    tone: 'op' as const,
    items: OPS.filter((o) => o.group === group).map((o) => ({
      key: `op-${o.id}`, kind: 'op' as const, cfg: { op: o.id }, title: o.label, glyph: o.glyph, hint: o.hint,
    })),
  })),
  {
    title: 'Advanced',
    tone: 'formula',
    items: [
      {
        key: 'formula', kind: 'formula', cfg: { label: 'Formula', expr: 'a * b' }, title: 'Formula', glyph: 'ƒ',
        hint: 'Type any expression — each variable becomes an input port',
      },
    ],
  },
  {
    title: 'Outputs',
    tone: 'output',
    items: [
      {
        key: 'output', kind: 'output', cfg: { label: 'Result', symbol: 'y', unit: '' }, title: 'Result', glyph: '=',
        hint: 'A labelled result that can be charted in the modeling panel',
      },
    ],
  },
];
