import type { OdeModel } from '../core/ode';
import { headerLines, planOf } from './plan';
import { ExportError, translate, type Dialect } from './translate';

const FN: Record<string, string> = {
  sin: 'Sin', cos: 'Cos', tan: 'Tan', asin: 'ArcSin', acos: 'ArcCos', atan: 'ArcTan', sinh: 'Sinh', cosh: 'Cosh',
  tanh: 'Tanh', exp: 'Exp', ln: 'Log', log10: 'Log10', log2: 'Log2', sqrt: 'Sqrt', cbrt: 'CubeRoot', abs: 'Abs',
  sign: 'Sign', floor: 'Floor', ceil: 'Ceiling', round: 'Round', min: 'Min', max: 'Max', pow: 'Power', mod: 'Mod',
};
const OP: Record<string, string> = { and: '&&', or: '||' };

/** Wolfram Language writes powers of ten as 1.5*^-7. */
const num = (v: number): string => {
  const s = String(v);
  const [mant, exp] = s.split('e');
  const m = /\./.test(mant) ? mant : `${mant}.`;
  return exp === undefined ? m : `${m}*^${Number(exp)}`;
};

const dialect: Dialect = {
  number: num,
  constant: (n) => (n === 'pi' ? 'Pi' : 'E'),
  negate: (a) => `(-${a})`,
  not: (a) => `(!${a})`,
  binary: (op, a, b) => (op === 'mod' ? `Mod[${a}, ${b}]` : `(${a} ${OP[op] ?? op} ${b})`),
  call: (name, args) => {
    if (name === 'log') return args.length === 2 ? `Log[${args[1]}, ${args[0]}]` : `Log[${args[0]}]`;
    // atan2(y, x) is ArcTan[x, y].
    if (name === 'atan2') return `ArcTan[${args[1]}, ${args[0]}]`;
    return FN[name] ? `${FN[name]}[${args.join(', ')}]` : null;
  },
  conditional: (c, a, b) => `If[${c}, ${a}, ${b}]`,
};

/**
 * Wolfram symbols cannot contain underscores, and many single capitals (E, I, C,
 * D, N, K, O) are built in — so every model name is prefixed and re-spelled.
 */
const wl = (name: string) => `m${name.replace(/_/g, 'u')}`;

/** A Wolfram Language script (run with wolframscript, or paste into a notebook). */
export function generateMathematica(model: OdeModel): string {
  const plan = planOf(model);
  const spelled = new Map<string, string>();
  for (const n of plan.names.slice(1)) {
    const s = wl(n);
    if ([...spelled.values()].includes(s)) throw new ExportError(`"${n}" collides with another name once underscores are removed`);
    spelled.set(n, s);
  }
  const paramNames = new Set(plan.params.map((p) => p.name));
  const stateNames = new Set(plan.states.map((s) => s.name));
  const derivedExpr = new Map(plan.derived.map((d) => [d.name, d.expr]));

  /** `at` is how a state is written: x[t] inside the equations, or its initial value. */
  const tr = (expr: string, at: (state: string) => string, time = 't'): string =>
    translate(expr, dialect, (n) => {
      if (n === 't') return time;
      if (paramNames.has(n)) return spelled.get(n);
      if (stateNames.has(n)) return at(n);
      if (derivedExpr.has(n)) return `(${tr(derivedExpr.get(n)!, at, time)})`;
      return undefined;
    });
  const fn = (s: string) => `${spelled.get(s)}[t]`;
  const ini = (s: string) => `ini${spelled.get(s)}`;
  const digits = Math.max(3, Math.round(-Math.log10(plan.rtol)));

  const out: string[] = [];
  out.push('(*', ...headerLines(plan, 'Wolfram Language (Mathematica)', 'NDSolve').map((l) => `  ${l}`), '  Names are prefixed with "m" because single capitals such as E, I, C, D and N are built-in symbols.', '*)', '');
  out.push('(* Parameters *)');
  for (const p of plan.params) out.push(`${spelled.get(p.name)} = ${num(p.value)};${p.label || p.unit ? ` (* ${[p.label, p.unit].filter(Boolean).join(', ')} *)` : ''}`);
  out.push('', `simTEnd = ${num(plan.tEnd)};`, 'simOut = If[Length[$ScriptCommandLine] > 1, $ScriptCommandLine[[2]], "result.csv"];', '');
  out.push('(* Initial state *)');
  for (const s of plan.states) out.push(`${ini(s.name)} = N[${tr(s.init, ini, '0.')}];`);
  out.push('', 'simEquations = {');
  const eqs = [
    ...plan.states.map((s) => `  ${spelled.get(s.name)}'[t] == ${tr(s.deriv, fn)}`),
    ...plan.states.map((s) => `  ${spelled.get(s.name)}[0] == ${ini(s.name)}`),
    ...plan.events.map((e) => `  WhenEvent[${tr(e.when, fn)}, {${e.resets.map((r) => `${fn(r.state)} -> ${tr(r.expr, fn)}`).join(', ')}}]`),
    ...(plan.stopWhen ? [`  WhenEvent[${tr(plan.stopWhen, fn)}, "StopIntegration"]`] : []),
  ];
  out.push(eqs.join(',\n'), '};', '');
  out.push(
    `simSolution = First[NDSolve[simEquations, {${plan.states.map((s) => spelled.get(s.name)).join(', ')}}, {t, 0, simTEnd},`,
    `  ${plan.method === 'ros23' ? 'Method -> "StiffnessSwitching", ' : ''}PrecisionGoal -> ${digits}, AccuracyGoal -> ${digits + 3}, MaxStepSize -> ${num(plan.maxStep)}, MaxSteps -> Infinity]];`,
    '',
    `simLast = (${spelled.get(plan.states[0].name)} /. simSolution)["Domain"][[1, 2]];`,
    'simTimes = Subdivide[0., simLast, 2000];',
    `simRow[time_] := {time, ${[...plan.states.map((s) => fn(s.name)), ...plan.derived.map((d) => tr(d.expr, fn))].join(', ')}} /. simSolution /. t -> time;`,
    `Export[simOut, Prepend[simRow /@ simTimes, {${['t', ...plan.states.map((s) => s.name), ...plan.derived.map((d) => d.name)].map((n) => `"${n}"`).join(', ')}}], "CSV"];`,
    '',
  );
  return out.join('\n');
}
