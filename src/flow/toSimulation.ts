/**
 * The bridge from an equation flow to the simulation: a flow's composed
 * formula becomes an observable there, and the flow's inputs and constants
 * become parameters (in SI units) unless the simulation already defines them.
 */
import { symbolsOf, toText, type Ex } from '../core/expr';
import { useSim } from '../sim/store';

const identifier = (raw: string, fallback: string) => {
  const s = raw.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[A-Za-z_]/.test(s) ? s : s ? `q_${s}` : fallback;
};

export interface Transfer {
  observable: string;
  expression: string;
  /** Parameters created in the simulation. */
  added: string[];
  /** Symbols the simulation already defined, which the formula now refers to. */
  reused: string[];
  replaced: boolean;
}

export function addFlowToSimulation(ex: Ex, outputSymbol: string, outputUnit: string): Transfer {
  const { model, patch } = useSim.getState();
  const taken = new Set(['t', ...model.states.map((s) => s.name), ...model.params.map((p) => p.name)]);
  const derivedNames = new Set(model.derived.map((d) => d.name));

  const added: string[] = [];
  const reused: string[] = [];
  const params = [...model.params];
  for (const s of symbolsOf(ex)) {
    const name = s.name!;
    if (name === 'pi' || (name === 'e' && s.si === undefined)) continue;
    if (taken.has(name) || derivedNames.has(name)) {
      reused.push(name);
    } else if (s.si !== undefined && Number.isFinite(s.si)) {
      const v = s.si;
      params.push({ name, value: v, min: v === 0 ? 0 : Math.min(0, 2 * v), max: v === 0 ? 1 : Math.max(0, 2 * v), unit: s.unit || undefined, label: 'from equation flow' });
      taken.add(name);
      added.push(name);
    }
  }

  let observable = identifier(outputSymbol, 'flow_result');
  if (taken.has(observable)) observable = `${observable}_flow`;
  const expression = toText(ex);
  const replaced = derivedNames.has(observable);
  const entry = { name: observable, expr: expression, unit: outputUnit || undefined };
  patch({
    params,
    derived: replaced ? model.derived.map((d) => (d.name === observable ? entry : d)) : [...model.derived, entry],
  });
  return { observable, expression, added, reused, replaced };
}
