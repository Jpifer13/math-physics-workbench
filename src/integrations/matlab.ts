import type { OdeModel } from '../core/ode';
import { headerLines, planOf } from './plan';
import { nameTable, translate, type Dialect } from './translate';

const RESERVED = new Set([
  'break', 'case', 'catch', 'classdef', 'continue', 'else', 'elseif', 'end', 'for', 'function', 'global', 'if',
  'otherwise', 'parfor', 'persistent', 'return', 'spmd', 'switch', 'try', 'while', 'pi', 'exp', 'log', 'sin', 'cos',
  'tan', 'abs', 'min', 'max', 'mod', 'sqrt', 'sign', 'floor', 'ceil', 'round', 'deal', 'double', 'zeros', 'numel',
  'ode45', 'ode23s', 'odeset', 'error', 'isempty', 'fopen', 'fclose', 'fprintf', 'dlmwrite', 'exist', 'y', 't', 'i', 'j',
]);

const FN: Record<string, string> = {
  sin: 'sin', cos: 'cos', tan: 'tan', asin: 'asin', acos: 'acos', atan: 'atan', atan2: 'atan2', sinh: 'sinh', cosh: 'cosh',
  tanh: 'tanh', exp: 'exp', ln: 'log', log10: 'log10', log2: 'log2', sqrt: 'sqrt', abs: 'abs', sign: 'sign',
  floor: 'floor', ceil: 'ceil', round: 'round', pow: 'power', mod: 'mod',
};
const OP: Record<string, string> = { and: '&&', or: '||', '!=': '~=' };

const dialect: Dialect = {
  // %.17g round-trips a double; MATLAB reads 1e-07 and 0.1 alike.
  number: (v) => String(v),
  constant: (n) => (n === 'pi' ? 'pi' : 'exp(1)'),
  negate: (a) => `(-${a})`,
  not: (a) => `(~${a})`,
  binary: (op, a, b) => (op === 'mod' ? `mod(${a}, ${b})` : `(${a} ${OP[op] ?? op} ${b})`),
  call: (name, args) => {
    if (name === 'log') return args.length === 2 ? `(log(${args[0]}) / log(${args[1]}))` : `log(${args[0]})`;
    if (name === 'cbrt') return `nthroot(${args[0]}, 3)`;
    // min and max take exactly two values here; fold longer lists.
    if (name === 'min' || name === 'max') return args.reduce((acc, a) => `${name}(${acc}, ${a})`);
    return FN[name] ? `${FN[name]}(${args.join(', ')})` : null;
  },
  conditional: (c, a, b) => `sim_pick(${c}, ${a}, ${b})`,
};

const METHOD = { rk45: 'ode45', ros23: 'ode23s', rk4: 'ode45', euler: 'ode45' } as const;

/**
 * A script for MATLAB or GNU Octave. It uses only anonymous functions, because
 * the two disagree on where local functions may appear in a script file.
 */
export function generateMatlab(model: OdeModel): string {
  const plan = planOf(model);
  const id = nameTable(plan.names.slice(1), RESERVED, (n) => (n.startsWith('sim_') ? `${n}_` : `${n}_`));
  const paramNames = new Set(plan.params.map((p) => p.name));
  const stateIndex = new Map(plan.states.map((s, i) => [s.name, i + 1]));
  const derivedExpr = new Map(plan.derived.map((d) => [d.name, d.expr]));

  /** Translate with states read from the vector `vec` and time from `time`; observables are expanded in place. */
  const tr = (expr: string, vec: string, time: string): string =>
    translate(expr, dialect, (n) => {
      if (n === 't') return time;
      if (paramNames.has(n)) return id(n);
      if (stateIndex.has(n)) return `${vec}(${stateIndex.get(n)})`;
      if (derivedExpr.has(n)) return `(${tr(derivedExpr.get(n)!, vec, time)})`;
      return undefined;
    });
  /** Initial values are assigned in order and may refer to earlier ones. */
  const trInit = (expr: string): string =>
    translate(expr, dialect, (n) => (n === 't' ? '0' : paramNames.has(n) ? id(n) : stateIndex.has(n) ? `sim_y0(${stateIndex.get(n)})` : undefined));

  const conditions = [...plan.events.map((e) => e.when), ...(plan.stopWhen ? [plan.stopWhen] : [])];
  const stopIndex = plan.stopWhen ? plan.events.length + 1 : 0;
  const solver = METHOD[plan.method];
  const n = plan.states.length;
  const hasEvents = conditions.length > 0;

  const out: string[] = [];
  for (const line of headerLines(plan, 'MATLAB or GNU Octave', solver)) out.push(`% ${line}`);
  out.push('', '% Parameters');
  for (const p of plan.params) out.push(`${id(p.name)} = ${String(p.value)};${p.label || p.unit ? `  % ${[p.label, p.unit].filter(Boolean).join(', ')}` : ''}`);
  out.push('', `sim_tend = ${plan.tEnd};`, `sim_rtol = ${plan.rtol};`);
  out.push("if ~exist('sim_outfile', 'var'), sim_outfile = 'result.csv'; end", '');
  out.push("sim_pick = @(c, a, b) subsref({b, a}, struct('type', '{}', 'subs', {{(c ~= 0) + 1}}));", '');
  out.push('% Initial state', `sim_y0 = zeros(${n}, 1);`);
  plan.states.forEach((s, i) => out.push(`sim_y0(${i + 1}) = ${trInit(s.init)};  % ${s.name}`));
  out.push('', '% Rates of change');
  out.push(`sim_rhs = @(t, y) [${plan.states.map((s) => tr(s.deriv, 'y', 't')).join('; ...\n    ')}];`);
  if (plan.derived.length) {
    out.push('', '% Observables');
    out.push(`sim_obs = @(t, y) [${plan.derived.map((d) => tr(d.expr, 'y', 't')).join(', ...\n    ')}];`);
  }
  out.push('', `sim_opts = odeset('RelTol', sim_rtol, 'AbsTol', sim_rtol * 1e-3, 'MaxStep', ${plan.maxStep});`);
  if (hasEvents) {
    const ones = conditions.map(() => '1').join('; ');
    out.push('% Each condition is +0.5 when true and -0.5 when false; an event is its upward crossing.');
    out.push(`sim_events = @(t, y) deal([${conditions.map((c) => `double(${tr(c, 'y', 't')}) - 0.5`).join('; ...\n    ')}], [${ones}], [${ones}]);`);
    out.push("sim_opts = odeset(sim_opts, 'Events', sim_events);");
  }
  out.push('', 'sim_T = []; sim_Y = []; sim_t0 = 0; sim_yc = sim_y0; sim_count = 0;', 'while sim_t0 < sim_tend');
  if (hasEvents) {
    out.push(`  [sim_ts, sim_ys, sim_te, sim_ye, sim_ie] = ${solver}(sim_rhs, [sim_t0 sim_tend], sim_yc, sim_opts);`);
  } else {
    out.push(`  [sim_ts, sim_ys] = ${solver}(sim_rhs, [sim_t0 sim_tend], sim_yc, sim_opts);`, '  sim_ie = [];');
  }
  out.push(
    '  sim_T = [sim_T; sim_ts]; sim_Y = [sim_Y; sim_ys];',
    '  if isempty(sim_ie) || sim_ts(end) >= sim_tend, break; end',
    '  sim_t0 = sim_ts(end); sim_yc = sim_ys(end, :).\'; sim_k = sim_ie(end);',
  );
  if (stopIndex) out.push(`  if sim_k == ${stopIndex}, break; end`);
  if (plan.events.length) {
    out.push('  sim_new = sim_yc;', '  switch sim_k');
    plan.events.forEach((e, k) => {
      out.push(`    case ${k + 1}`);
      for (const r of e.resets) out.push(`      sim_new(${stateIndex.get(r.state)}) = ${tr(r.expr, 'sim_yc', 'sim_t0')};  % ${r.state}`);
    });
    out.push('  end', '  sim_yc = sim_new;', '  sim_T = [sim_T; sim_t0]; sim_Y = [sim_Y; sim_yc.\'];');
  }
  out.push("  sim_count = sim_count + 1; if sim_count > 10000, error('More than 10000 events fired'); end", 'end', '');

  if (plan.derived.length) {
    out.push(`sim_D = zeros(numel(sim_T), ${plan.derived.length});`, 'for sim_i = 1:numel(sim_T)', "  sim_D(sim_i, :) = sim_obs(sim_T(sim_i), sim_Y(sim_i, :).');", 'end');
  } else {
    out.push('sim_D = zeros(numel(sim_T), 0);');
  }
  out.push(
    "sim_fid = fopen(sim_outfile, 'w');",
    `fprintf(sim_fid, '%s\\n', '${['t', ...plan.states.map((s) => s.name), ...plan.derived.map((d) => d.name)].join(',')}');`,
    'sim_M = [sim_T, sim_Y, sim_D];',
    "sim_fmt = [repmat('%.17g,', 1, size(sim_M, 2) - 1), '%.17g\\n'];",
    "fprintf(sim_fid, sim_fmt, sim_M.');",
    'fclose(sim_fid);',
    '',
  );
  return out.join('\n');
}
