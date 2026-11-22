import type { OdeModel } from '../core/ode';
import { headerLines, planOf } from './plan';
import { nameTable, numberLiteral, translate, type Dialect } from './translate';

const RESERVED = new Set([
  'baremodule', 'begin', 'break', 'catch', 'const', 'continue', 'do', 'else', 'elseif', 'end', 'export', 'false',
  'finally', 'for', 'function', 'global', 'if', 'import', 'let', 'local', 'macro', 'module', 'quote', 'return',
  'struct', 'true', 'try', 'using', 'while', 'pi', 'u', 'du', 'p', 'integrator', 'main', 'abs', 'min', 'max', 'mod',
]);

const FN: Record<string, string> = {
  sin: 'sin', cos: 'cos', tan: 'tan', asin: 'asin', acos: 'acos', atan: 'atan', atan2: 'atan', sinh: 'sinh', cosh: 'cosh',
  tanh: 'tanh', exp: 'exp', ln: 'log', log10: 'log10', log2: 'log2', sqrt: 'sqrt', cbrt: 'cbrt', abs: 'abs', sign: 'sign',
  floor: 'floor', ceil: 'ceil', round: 'round', min: 'min', max: 'max', mod: 'mod',
};
const OP: Record<string, string> = { and: '&&', or: '||' };

const dialect: Dialect = {
  number: numberLiteral,
  constant: (n) => (n === 'pi' ? 'pi' : 'exp(1.0)'),
  negate: (a) => `(-${a})`,
  not: (a) => `(!${a})`,
  binary: (op, a, b) => (op === 'mod' ? `mod(${a}, ${b})` : `(${a} ${OP[op] ?? op} ${b})`),
  call: (name, args) => {
    // Julia's two-argument log takes the base first.
    if (name === 'log') return args.length === 2 ? `log(${args[1]}, ${args[0]})` : `log(${args[0]})`;
    if (name === 'pow') return `(${args[0]} ^ ${args[1]})`;
    return FN[name] ? `${FN[name]}(${args.join(', ')})` : null;
  },
  conditional: (c, a, b) => `(${c} ? ${a} : ${b})`,
};

const METHOD = { rk45: 'DP5()', ros23: 'Rosenbrock23()', rk4: 'Tsit5()', euler: 'Tsit5()' } as const;

/** A Julia script using DifferentialEquations.jl. */
export function generateJulia(model: OdeModel): string {
  const plan = planOf(model);
  const id = nameTable(plan.names, RESERVED);
  const tr = (e: string) => translate(e, dialect, (n) => (plan.names.includes(n) ? id(n) : undefined));
  const stateNames = plan.states.map((s) => id(s.name));
  const unpack = (vec: string) => `    ${stateNames.join(', ')}${stateNames.length === 1 ? ',' : ''} = ${vec}`;
  const derive = plan.derived.map((d) => `    ${id(d.name)} = ${tr(d.expr)}`);
  const solver = METHOD[plan.method];

  const out: string[] = [];
  out.push('#=', ...headerLines(plan, 'Julia with DifferentialEquations.jl', solver), '=#');
  out.push('using DifferentialEquations', 'using DelimitedFiles', '', '# Parameters');
  for (const p of plan.params) out.push(`const ${id(p.name)} = ${numberLiteral(p.value)}${p.label || p.unit ? `  # ${[p.label, p.unit].filter(Boolean).join(', ')}` : ''}`);
  out.push('', `const sim_tend = ${numberLiteral(plan.tEnd)}`, `const sim_rtol = ${numberLiteral(plan.rtol)}`, '');

  out.push('function sim_initial()', '    t = 0.0');
  for (const s of plan.states) out.push(`    ${id(s.name)} = ${tr(s.init)}`);
  out.push(`    return Float64[${stateNames.join(', ')}]`, 'end', '');

  out.push('function sim_rhs!(du, u, p, t)', unpack('u'), ...derive);
  plan.states.forEach((s, i) => out.push(`    du[${i + 1}] = ${tr(s.deriv)}`));
  out.push('    return nothing', 'end', '');

  out.push('function sim_observables(u, t)', unpack('u'), ...derive, `    return Float64[${plan.derived.map((d) => id(d.name)).join(', ')}]`, 'end', '');

  const callbacks: string[] = [];
  const condition = (name: string, expr: string) => {
    // +1 when the condition holds and -1 otherwise, so the event is its upward crossing.
    out.push(`function ${name}(u, t, integrator)`, unpack('u'), ...derive, `    return ${tr(expr)} ? 1.0 : -1.0`, 'end', '');
  };
  plan.events.forEach((e, k) => {
    condition(`sim_condition_${k + 1}`, e.when);
    out.push(`function sim_reset_${k + 1}!(integrator)`, '    t = integrator.t', unpack('integrator.u'), ...derive);
    // Evaluate every new value before assigning any of them.
    e.resets.forEach((r, i) => out.push(`    sim_new_${i + 1} = ${tr(r.expr)}`));
    e.resets.forEach((r, i) => out.push(`    integrator.u[${plan.states.findIndex((s) => s.name === r.state) + 1}] = sim_new_${i + 1}`));
    out.push('    return nothing', 'end', '');
    callbacks.push(`ContinuousCallback(sim_condition_${k + 1}, sim_reset_${k + 1}!, nothing)`);
  });
  if (plan.stopWhen) {
    condition('sim_stop_condition', plan.stopWhen);
    callbacks.push('ContinuousCallback(sim_stop_condition, terminate!, nothing)');
  }

  out.push(
    'function main(path)',
    '    problem = ODEProblem(sim_rhs!, sim_initial(), (0.0, sim_tend))',
    `    solution = solve(problem, ${solver}; reltol = sim_rtol, abstol = sim_rtol * 1e-3, dtmax = ${numberLiteral(plan.maxStep)}${callbacks.length ? `,\n        callback = CallbackSet(${callbacks.join(',\n            ')})` : ''})`,
    `    rows = [vcat(t, u, sim_observables(u, t))' for (u, t) in zip(solution.u, solution.t)]`,
    '    open(path, "w") do io',
    `        println(io, "${['t', ...plan.states.map((s) => s.name), ...plan.derived.map((d) => d.name)].join(',')}")`,
    "        writedlm(io, vcat(rows...), ',')",
    '    end',
    'end',
    '',
    'main(length(ARGS) > 0 ? ARGS[1] : "result.csv")',
    '',
  );
  return out.join('\n');
}
