/**
 * Dimensional quantities.
 *
 * Every value flowing through the tool is stored in SI base units together
 * with a dimension vector, so the engine can catch "kg + m" mistakes and
 * label results (J, N, m/s, ...) automatically.
 */

/** Exponents of the SI base dimensions: [mass, length, time, current, temperature, amount, luminous]. */
export type Dim = readonly [number, number, number, number, number, number, number];

export interface Quantity {
  /** Value in SI base units. */
  v: number;
  d: Dim;
}

export const DIMLESS: Dim = [0, 0, 0, 0, 0, 0, 0];
const BASE_SYMBOLS = ['kg', 'm', 's', 'A', 'K', 'mol', 'cd'];

export const dim = (M = 0, L = 0, T = 0, I = 0, Th = 0, N = 0, J = 0): Dim => [M, L, T, I, Th, N, J];
export const dimMul = (a: Dim, b: Dim): Dim => a.map((x, i) => x + b[i]) as unknown as Dim;
export const dimDiv = (a: Dim, b: Dim): Dim => a.map((x, i) => x - b[i]) as unknown as Dim;
export const dimPow = (a: Dim, p: number): Dim =>
  a.map((x) => {
    const r = x * p;
    // Snap away float noise so sqrt(m^2) is exactly m.
    const snapped = Math.round(r * 1e6) / 1e6;
    return snapped === 0 ? 0 : snapped;
  }) as unknown as Dim;
export const dimEq = (a: Dim, b: Dim): boolean => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
export const isDimless = (a: Dim): boolean => dimEq(a, DIMLESS);
export const dimKey = (a: Dim): string => a.join(',');

export interface UnitDef {
  symbol: string;
  name: string;
  /** Multiply a value in this unit by `f` to get SI. */
  f: number;
  d: Dim;
  group: string;
}

const U: UnitDef[] = [];
const unit = (group: string, symbol: string, name: string, f: number, d: Dim) =>
  U.push({ symbol, name, f, d, group });

const D = {
  none: DIMLESS,
  mass: dim(1),
  length: dim(0, 1),
  time: dim(0, 0, 1),
  current: dim(0, 0, 0, 1),
  temp: dim(0, 0, 0, 0, 1),
  amount: dim(0, 0, 0, 0, 0, 1),
  area: dim(0, 2),
  volume: dim(0, 3),
  velocity: dim(0, 1, -1),
  accel: dim(0, 1, -2),
  force: dim(1, 1, -2),
  energy: dim(1, 2, -2),
  power: dim(1, 2, -3),
  pressure: dim(1, -1, -2),
  freq: dim(0, 0, -1),
  momentum: dim(1, 1, -1),
  density: dim(1, -3),
  charge: dim(0, 0, 1, 1),
  voltage: dim(1, 2, -3, -1),
  resistance: dim(1, 2, -3, -2),
  capacitance: dim(-1, -2, 4, 2),
  inductance: dim(1, 2, -2, -2),
  bfield: dim(1, 0, -2, -1),
  efield: dim(1, 1, -3, -1),
  springK: dim(1, 0, -2),
  inertia: dim(1, 2),
  entropy: dim(1, 2, -2, 0, -1),
};

const eV = 1.602176634e-19;

unit('Dimensionless', '', 'number (no unit)', 1, D.none);
unit('Dimensionless', 'rad', 'radian', 1, D.none);
unit('Dimensionless', 'deg', 'degree', Math.PI / 180, D.none);
unit('Dimensionless', '%', 'percent', 0.01, D.none);

unit('Mass', 'kg', 'kilogram', 1, D.mass);
unit('Mass', 'g', 'gram', 1e-3, D.mass);
unit('Mass', 'mg', 'milligram', 1e-6, D.mass);
unit('Mass', 't', 'tonne', 1e3, D.mass);
unit('Mass', 'u', 'atomic mass unit', 1.6605390666e-27, D.mass);
unit('Mass', 'M☉', 'solar mass', 1.98847e30, D.mass);
unit('Mass', 'lb', 'pound', 0.45359237, D.mass);

unit('Length', 'm', 'metre', 1, D.length);
unit('Length', 'km', 'kilometre', 1e3, D.length);
unit('Length', 'cm', 'centimetre', 1e-2, D.length);
unit('Length', 'mm', 'millimetre', 1e-3, D.length);
unit('Length', 'µm', 'micrometre', 1e-6, D.length);
unit('Length', 'nm', 'nanometre', 1e-9, D.length);
unit('Length', 'Å', 'ångström', 1e-10, D.length);
unit('Length', 'AU', 'astronomical unit', 1.495978707e11, D.length);
unit('Length', 'ly', 'light-year', 9.4607304725808e15, D.length);
unit('Length', 'ft', 'foot', 0.3048, D.length);
unit('Length', 'mi', 'mile', 1609.344, D.length);

unit('Time', 's', 'second', 1, D.time);
unit('Time', 'ms', 'millisecond', 1e-3, D.time);
unit('Time', 'µs', 'microsecond', 1e-6, D.time);
unit('Time', 'ns', 'nanosecond', 1e-9, D.time);
unit('Time', 'min', 'minute', 60, D.time);
unit('Time', 'h', 'hour', 3600, D.time);
unit('Time', 'day', 'day', 86400, D.time);
unit('Time', 'yr', 'year', 31557600, D.time);

unit('Motion', 'm/s', 'metre per second', 1, D.velocity);
unit('Motion', 'km/h', 'kilometre per hour', 1 / 3.6, D.velocity);
unit('Motion', 'km/s', 'kilometre per second', 1e3, D.velocity);
unit('Motion', 'mph', 'mile per hour', 0.44704, D.velocity);
unit('Motion', 'm/s²', 'metre per second squared', 1, D.accel);
unit('Motion', 'Hz', 'hertz', 1, D.freq);
unit('Motion', 'rad/s', 'radian per second', 1, D.freq);
unit('Motion', 'kg·m/s', 'momentum', 1, D.momentum);
unit('Motion', 'kg·m²', 'moment of inertia', 1, D.inertia);

unit('Force & energy', 'N', 'newton', 1, D.force);
unit('Force & energy', 'kN', 'kilonewton', 1e3, D.force);
unit('Force & energy', 'J', 'joule', 1, D.energy);
unit('Force & energy', 'kJ', 'kilojoule', 1e3, D.energy);
unit('Force & energy', 'MJ', 'megajoule', 1e6, D.energy);
unit('Force & energy', 'eV', 'electronvolt', eV, D.energy);
unit('Force & energy', 'keV', 'kiloelectronvolt', eV * 1e3, D.energy);
unit('Force & energy', 'MeV', 'megaelectronvolt', eV * 1e6, D.energy);
unit('Force & energy', 'GeV', 'gigaelectronvolt', eV * 1e9, D.energy);
unit('Force & energy', 'kWh', 'kilowatt-hour', 3.6e6, D.energy);
unit('Force & energy', 'cal', 'calorie', 4.184, D.energy);
unit('Force & energy', 'kt TNT', 'kiloton of TNT', 4.184e12, D.energy);
unit('Force & energy', 'W', 'watt', 1, D.power);
unit('Force & energy', 'kW', 'kilowatt', 1e3, D.power);
unit('Force & energy', 'N/m', 'spring constant', 1, D.springK);

unit('Matter', 'Pa', 'pascal', 1, D.pressure);
unit('Matter', 'kPa', 'kilopascal', 1e3, D.pressure);
unit('Matter', 'bar', 'bar', 1e5, D.pressure);
unit('Matter', 'atm', 'atmosphere', 101325, D.pressure);
unit('Matter', 'm²', 'square metre', 1, D.area);
unit('Matter', 'm³', 'cubic metre', 1, D.volume);
unit('Matter', 'L', 'litre', 1e-3, D.volume);
unit('Matter', 'kg/m³', 'density', 1, D.density);
unit('Matter', 'K', 'kelvin', 1, D.temp);
unit('Matter', 'mol', 'mole', 1, D.amount);
unit('Matter', 'J/K', 'entropy / heat capacity', 1, D.entropy);

unit('Electromagnetism', 'A', 'ampere', 1, D.current);
unit('Electromagnetism', 'C', 'coulomb', 1, D.charge);
unit('Electromagnetism', 'µC', 'microcoulomb', 1e-6, D.charge);
unit('Electromagnetism', 'nC', 'nanocoulomb', 1e-9, D.charge);
unit('Electromagnetism', 'V', 'volt', 1, D.voltage);
unit('Electromagnetism', 'kV', 'kilovolt', 1e3, D.voltage);
unit('Electromagnetism', 'Ω', 'ohm', 1, D.resistance);
unit('Electromagnetism', 'F', 'farad', 1, D.capacitance);
unit('Electromagnetism', 'µF', 'microfarad', 1e-6, D.capacitance);
unit('Electromagnetism', 'H', 'henry', 1, D.inductance);
unit('Electromagnetism', 'T', 'tesla', 1, D.bfield);
unit('Electromagnetism', 'V/m', 'electric field', 1, D.efield);

export const UNITS: readonly UnitDef[] = U;
const UNIT_MAP = new Map(U.map((u) => [u.symbol, u]));
export const getUnit = (symbol: string): UnitDef | undefined => UNIT_MAP.get(symbol);
export const unitGroups = (): string[] => [...new Set(U.map((u) => u.group))];
export const compatibleUnits = (d: Dim): UnitDef[] => U.filter((u) => dimEq(u.d, d));

/** Build a quantity from a value expressed in a named unit. */
export function fromUnit(value: number, symbol: string): Quantity {
  const u = getUnit(symbol);
  if (!u) throw new Error(`Unknown unit "${symbol}"`);
  return { v: value * u.f, d: u.d };
}
export function toUnit(q: Quantity, symbol: string): number {
  const u = getUnit(symbol);
  if (!u) throw new Error(`Unknown unit "${symbol}"`);
  if (!dimEq(u.d, q.d)) throw new Error(`Cannot express ${dimName(q.d)} in ${symbol}`);
  return q.v / u.f;
}

/** Preferred SI unit symbol for well-known dimensions. */
const PREFERRED: [Dim, string, string][] = [
  [D.mass, 'kg', 'mass'],
  [D.length, 'm', 'length'],
  [D.time, 's', 'time'],
  [D.current, 'A', 'electric current'],
  [D.temp, 'K', 'temperature'],
  [D.amount, 'mol', 'amount of substance'],
  [D.area, 'm²', 'area'],
  [D.volume, 'm³', 'volume'],
  [D.velocity, 'm/s', 'velocity'],
  [D.accel, 'm/s²', 'acceleration'],
  [D.force, 'N', 'force'],
  [D.energy, 'J', 'energy'],
  [D.power, 'W', 'power'],
  [D.pressure, 'Pa', 'pressure'],
  [D.freq, 's⁻¹', 'frequency / rate'],
  [D.momentum, 'kg·m/s', 'momentum'],
  [D.density, 'kg/m³', 'density'],
  [D.charge, 'C', 'electric charge'],
  [D.voltage, 'V', 'electric potential'],
  [D.resistance, 'Ω', 'resistance'],
  [D.capacitance, 'F', 'capacitance'],
  [D.inductance, 'H', 'inductance'],
  [D.bfield, 'T', 'magnetic field'],
  [D.efield, 'V/m', 'electric field'],
  [D.springK, 'N/m', 'stiffness'],
  [D.inertia, 'kg·m²', 'moment of inertia'],
  [D.entropy, 'J/K', 'entropy'],
  [dim(1, 2, -1), 'J·s', 'action / angular momentum'],
  [dim(0, 0, -2), 's⁻²', 'angular acceleration'],
];
const PREF_MAP = new Map(PREFERRED.map(([d, s, n]) => [dimKey(d), { symbol: s, name: n }]));

const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '-': '⁻', '.': '·', '/': 'ᐟ',
};
export const superscript = (s: string): string => [...s].map((c) => SUP[c] ?? c).join('');

function expStr(e: number): string {
  if (Number.isInteger(e)) return String(e);
  // Show simple fractions (halves, thirds) nicely.
  for (const den of [2, 3, 4]) {
    const num = e * den;
    if (Math.abs(num - Math.round(num)) < 1e-6) return `${Math.round(num)}/${den}`;
  }
  return e.toFixed(2);
}

/** Compose a unit string from base SI units, e.g. kg·m²/s². */
export function baseUnitString(d: Dim): string {
  const pos: string[] = [];
  const neg: string[] = [];
  d.forEach((e, i) => {
    if (e === 0) return;
    const mag = Math.abs(e);
    const part = BASE_SYMBOLS[i] + (mag === 1 ? '' : superscript(expStr(mag)));
    (e > 0 ? pos : neg).push(part);
  });
  if (!pos.length && !neg.length) return '';
  if (!neg.length) return pos.join('·');
  if (!pos.length) {
    // All-negative: use negative exponents, e.g. s⁻¹.
    return d
      .map((e, i) => (e < 0 ? BASE_SYMBOLS[i] + superscript(expStr(e)) : ''))
      .filter(Boolean)
      .join('·');
  }
  return `${pos.join('·')}/${neg.length > 1 ? `(${neg.join('·')})` : neg[0]}`;
}

/** SI unit label for a dimension (named unit if one exists, else base units). */
export function siUnitFor(d: Dim): string {
  return PREF_MAP.get(dimKey(d))?.symbol ?? baseUnitString(d);
}

/** Human name of the physical quantity a dimension represents. */
export function dimName(d: Dim): string {
  if (isDimless(d)) return 'dimensionless';
  return PREF_MAP.get(dimKey(d))?.name ?? baseUnitString(d);
}

/** Format a plain number: fixed for everyday magnitudes, ×10ⁿ otherwise. */
export function fmtNum(x: number, sig = 5): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'NaN' : x > 0 ? '∞' : '−∞';
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1e-3 && a < 1e6) {
    return String(parseFloat(x.toPrecision(sig))).replace('-', '−');
  }
  const [m, e] = x.toExponential(sig - 1).split('e');
  const mant = String(parseFloat(m)).replace('-', '−');
  const exp = superscript(String(parseInt(e, 10)));
  return mant === '1' ? `10${exp}` : mant === '−1' ? `−10${exp}` : `${mant}×10${exp}`;
}

export function fmtNumLatex(x: number, sig = 4): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? '\\text{NaN}' : x > 0 ? '\\infty' : '-\\infty';
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1e-3 && a < 1e6) return String(parseFloat(x.toPrecision(sig)));
  const [m, e] = x.toExponential(sig - 1).split('e');
  const mant = String(parseFloat(m));
  const exp = parseInt(e, 10);
  return mant === '1' ? `10^{${exp}}` : `${mant}\\times 10^{${exp}}`;
}

export const unitLatex = (symbol: string): string => (symbol ? `\\,\\text{${symbol.replace('%', '\\%')}}` : '');

export interface Formatted {
  value: number;
  text: string;
  unit: string;
}

/** Format a quantity in a chosen unit (or the SI default when omitted/incompatible). */
export function formatQuantity(q: Quantity, preferredUnit?: string): Formatted {
  const u = preferredUnit ? getUnit(preferredUnit) : undefined;
  if (u && dimEq(u.d, q.d)) {
    const value = q.v / u.f;
    return { value, text: fmtNum(value), unit: u.symbol };
  }
  return { value: q.v, text: fmtNum(q.v), unit: siUnitFor(q.d) };
}

/** Name of the quantity only when it has a well-known one (energy, force…), else ''. */
export const knownDimName = (d: Dim): string => PREF_MAP.get(dimKey(d))?.name ?? '';

export const quantityText = (q: Quantity, preferredUnit?: string): string => {
  const f = formatQuantity(q, preferredUnit);
  return f.unit ? `${f.text} ${f.unit}` : f.text;
};

// ---------------------------------------------------------------- constants

export interface ConstantDef {
  id: string;
  name: string;
  /** LaTeX symbol. */
  latex: string;
  /** Plain-text symbol. */
  symbol: string;
  q: Quantity;
  unit: string;
  note?: string;
}

const constant = (
  id: string, name: string, symbol: string, latex: string, v: number, d: Dim, unit: string, note?: string,
): ConstantDef => ({ id, name, symbol, latex, q: { v, d }, unit, note });

export const CONSTANTS: readonly ConstantDef[] = [
  constant('c', 'Speed of light', 'c', 'c', 299792458, D.velocity, 'm/s', 'Exact by definition'),
  constant('G', 'Gravitational constant', 'G', 'G', 6.6743e-11, dim(-1, 3, -2), 'm³/(kg·s²)'),
  constant('g', 'Standard gravity', 'g', 'g', 9.80665, D.accel, 'm/s²', "Acceleration at Earth's surface"),
  constant('h', 'Planck constant', 'h', 'h', 6.62607015e-34, dim(1, 2, -1), 'J·s', 'Exact by definition'),
  constant('hbar', 'Reduced Planck constant', 'ħ', '\\hbar', 1.054571817e-34, dim(1, 2, -1), 'J·s'),
  constant('kB', 'Boltzmann constant', 'k_B', 'k_B', 1.380649e-23, D.entropy, 'J/K', 'Exact by definition'),
  constant('e', 'Elementary charge', 'e', 'e', eV, D.charge, 'C', 'Exact by definition'),
  constant('eps0', 'Vacuum permittivity', 'ε₀', '\\varepsilon_0', 8.8541878128e-12, dim(-1, -3, 4, 2), 'F/m'),
  constant('mu0', 'Vacuum permeability', 'μ₀', '\\mu_0', 1.25663706212e-6, dim(1, 1, -2, -2), 'N/A²'),
  constant('ke', 'Coulomb constant', 'kₑ', 'k_e', 8.9875517923e9, dim(1, 3, -4, -2), 'N·m²/C²'),
  constant('me', 'Electron mass', 'mₑ', 'm_e', 9.1093837015e-31, D.mass, 'kg'),
  constant('mp', 'Proton mass', 'mₚ', 'm_p', 1.67262192369e-27, D.mass, 'kg'),
  constant('NA', 'Avogadro constant', 'N_A', 'N_A', 6.02214076e23, dim(0, 0, 0, 0, 0, -1), '1/mol', 'Exact by definition'),
  constant('R', 'Gas constant', 'R', 'R', 8.314462618, dim(1, 2, -2, 0, -1, -1), 'J/(mol·K)'),
  constant('sigma', 'Stefan–Boltzmann constant', 'σ', '\\sigma', 5.670374419e-8, dim(1, 0, -3, 0, -4), 'W/(m²·K⁴)'),
  constant('Mearth', 'Mass of Earth', 'M⊕', 'M_\\oplus', 5.9722e24, D.mass, 'kg'),
  constant('Rearth', 'Radius of Earth', 'R⊕', 'R_\\oplus', 6.371e6, D.length, 'm'),
  constant('Msun', 'Mass of the Sun', 'M☉', 'M_\\odot', 1.98847e30, D.mass, 'kg'),
  constant('pi', 'Pi', 'π', '\\pi', Math.PI, D.none, '', 'Circle circumference ÷ diameter'),
  constant('euler', "Euler's number", 'e', '\\mathrm{e}', Math.E, D.none, '', 'Base of natural logarithms'),
];
const CONST_MAP = new Map(CONSTANTS.map((c) => [c.id, c]));
export const getConstant = (id: string): ConstantDef | undefined => CONST_MAP.get(id);
