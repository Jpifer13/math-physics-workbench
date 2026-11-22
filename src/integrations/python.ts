import type { OdeModel } from '../core/ode';
import { headerLines, planOf } from './plan';
import { nameTable, numberLiteral, translate, type Dialect } from './translate';

const KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif',
  'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or',
  'pass', 'raise', 'return', 'try', 'while', 'with', 'yield', 'np', 'sys', 'solve_ivp', 'abs', 'min', 'max', 'float', 'main',
]);

const NP: Record<string, string> = {
  sin: 'np.sin', cos: 'np.cos', tan: 'np.tan', asin: 'np.arcsin', acos: 'np.arccos', atan: 'np.arctan', atan2: 'np.arctan2',
  sinh: 'np.sinh', cosh: 'np.cosh', tanh: 'np.tanh', exp: 'np.exp', ln: 'np.log', log10: 'np.log10', log2: 'np.log2',
  sqrt: 'np.sqrt', cbrt: 'np.cbrt', sign: 'np.sign', floor: 'np.floor', ceil: 'np.ceil', round: 'np.round',
  pow: 'np.power', mod: 'np.mod', abs: 'abs', min: 'min', max: 'max',
};

const dialect: Dialect = {
  number: numberLiteral,
  constant: (n) => (n === 'pi' ? 'np.pi' : 'np.e'),
  negate: (a) => `(-${a})`,
  not: (a) => `(not ${a})`,
  binary: (op, a, b) => {
    if (op === '^') return `(${a} ** ${b})`;
    if (op === 'mod') return `np.mod(${a}, ${b})`;
    return `(${a} ${op} ${b})`;
  },
  call: (name, args) => {
    if (name === 'log') return args.length === 2 ? `(np.log(${args[0]}) / np.log(${args[1]}))` : `np.log(${args[0]})`;
    return NP[name] ? `${NP[name]}(${args.join(', ')})` : null;
  },
  conditional: (c, a, b) => `(${a} if ${c} else ${b})`,
};

const METHOD = { rk45: 'RK45', ros23: 'Radau', rk4: 'RK45', euler: 'RK45' } as const;

/** A self-contained Python script that solves the model with SciPy. */
export function generatePython(model: OdeModel): string {
  const plan = planOf(model);
  const id = nameTable(plan.names, KEYWORDS);
  const tr = (e: string) => translate(e, dialect, (n) => (plan.names.includes(n) ? id(n) : undefined));
  const stateNames = plan.states.map((s) => id(s.name));
  const unpack = `    ${stateNames.join(', ')}${stateNames.length === 1 ? ',' : ''} = _y`;
  const derive = plan.derived.map((d) => `    ${id(d.name)} = ${tr(d.expr)}`);
  const body = (lines: string[]) => [unpack, ...derive, ...lines].join('\n');
  const method = METHOD[plan.method];

  const conditions = [...plan.events.map((e) => e.when), ...(plan.stopWhen ? [plan.stopWhen] : [])];
  const stopIndex = plan.stopWhen ? plan.events.length : -1;

  const out: string[] = [];
  out.push('#!/usr/bin/env python3', '"""', ...headerLines(plan, 'Python with NumPy and SciPy', `solve_ivp, ${method}`), '"""');
  out.push('import sys', '', 'import numpy as np', 'from scipy.integrate import solve_ivp', '');
  out.push('# Parameters');
  for (const p of plan.params) out.push(`${id(p.name)} = ${numberLiteral(p.value)}${p.label || p.unit ? `  # ${[p.label, p.unit].filter(Boolean).join(', ')}` : ''}`);
  out.push('', `_T_END = ${numberLiteral(plan.tEnd)}`, `_RTOL = ${numberLiteral(plan.rtol)}`, '', '');

  out.push('def _initial():', '    t = 0.0');
  for (const s of plan.states) out.push(`    ${id(s.name)} = ${tr(s.init)}`);
  out.push(`    return [${stateNames.map((n) => `float(${n})`).join(', ')}]`, '', '');

  out.push('def _rhs(t, _y):', body([`    return [${plan.states.map((s) => tr(s.deriv)).join(', ')}]`]), '', '');
  out.push('def _observables(t, _y):', body([`    return [${plan.derived.map((d) => id(d.name)).join(', ')}]`]), '', '');

  conditions.forEach((c, k) => {
    out.push(`def _event_${k}(t, _y):`, body([`    return 1.0 if ${tr(c)} else -1.0`]), '', '');
    out.push(`_event_${k}.terminal = True`, `_event_${k}.direction = 1.0`, '', '');
  });
  plan.events.forEach((e, k) => {
    const next = plan.states.map((s) => {
      const r = e.resets.find((x) => x.state === s.name);
      return r ? tr(r.expr) : id(s.name);
    });
    out.push(`def _reset_${k}(t, _y):`, body([`    return [${next.map((n) => `float(${n})`).join(', ')}]`]), '', '');
  });

  out.push(
    'def main(path):',
    '    t0, y = 0.0, _initial()',
    `    events = [${conditions.map((_, k) => `_event_${k}`).join(', ')}]`,
    ...(plan.events.length ? [`    resets = [${plan.events.map((_, k) => `_reset_${k}`).join(', ')}]`] : []),
    '    ts, ys = [], []',
    '    for _ in range(10000):',
    `        sol = solve_ivp(_rhs, (t0, _T_END), y, method="${method}", rtol=_RTOL, atol=_RTOL * 1e-3,`,
    `                        max_step=${numberLiteral(plan.maxStep)}, events=events or None)`,
    '        if not sol.success:',
    '            raise RuntimeError(sol.message)',
    '        ts.append(sol.t)',
    '        ys.append(sol.y.T)',
    '        if sol.status != 1:',
    '            break',
    '        # An event ended this stretch: find which one, apply its reset, and carry on from there.',
    '        fired = [k for k, te in enumerate(sol.t_events) if len(te)]',
    '        t0 = float(sol.t[-1])',
    '        y = [float(v) for v in sol.y[:, -1]]',
    ...(stopIndex >= 0 ? [`        if ${stopIndex} in fired:`, '            break'] : []),
    ...(plan.events.length ? ['        y = resets[fired[0]](t0, y)', '        ts.append(np.array([t0]))', '        ys.append(np.array([y]))'] : []),
    '        if t0 >= _T_END:',
    '            break',
    '    else:',
    '        raise RuntimeError("More than 10000 events fired")',
    '    t = np.concatenate(ts)',
    '    y = np.vstack(ys)',
    `    obs = np.array([_observables(ti, yi) for ti, yi in zip(t, y)]).reshape(len(t), ${plan.derived.length})`,
    `    header = "${['t', ...plan.states.map((s) => s.name), ...plan.derived.map((d) => d.name)].join(',')}"`,
    '    np.savetxt(path, np.column_stack([t, y, obs]), delimiter=",", header=header, comments="", fmt="%.17g")',
    '',
    '',
    'if __name__ == "__main__":',
    '    main(sys.argv[1] if len(sys.argv) > 1 else "result.csv")',
    '',
  );
  return out.join('\n');
}
