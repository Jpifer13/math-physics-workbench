/**
 * Initial-value-problem modelling: a model is a set of state variables with
 * derivative expressions, integrated with classic 4th-order Runge–Kutta.
 */
import { compile, type EvalFunction } from 'mathjs';

export interface StateVar { name: string; init: string; deriv: string; unit?: string }
export interface Param { name: string; value: number; min: number; max: number; step?: number; unit?: string; label?: string }
export interface Derived { name: string; expr: string; unit?: string }

export interface SceneBody {
  x: string;
  y: string;
  label?: string;
  /** Draw a line from this body to another point: 'origin' or [xExpr, yExpr]. */
  link?: 'origin' | [string, string];
  linkStyle?: 'rod' | 'spring';
  trail?: boolean;
}
export interface Scene {
  bodies: SceneBody[];
  /** Fixed markers such as a central star: [x, y, label]. */
  anchors?: [number, number, string][];
}

export interface OdeModel {
  id: string;
  name: string;
  summary: string;
  /** LaTeX lines describing the governing equations. */
  equations: string[];
  states: StateVar[];
  params: Param[];
  derived: Derived[];
  tEnd: number;
  dt: number;
  /** Stop the run early when this expression becomes true (e.g. "y < 0"). */
  stopWhen?: string;
  scene?: Scene;
  /** Default variables to chart. */
  timeSeries: string[];
  phase: [string, string];
  /** Default axes of the 3-D trajectory view (state/derived names or "t"). */
  view3d?: [string, string, string];
  explore?: string;
}

export interface SimResult {
  t: number[];
  series: Record<string, number[]>;
  error?: string;
}

const MAX_STEPS = 200_000;

export function simulate(model: OdeModel, paramValues?: Record<string, number>): SimResult {
  const scope: Record<string, number> = { t: 0 };
  for (const p of model.params) scope[p.name] = paramValues?.[p.name] ?? p.value;
  const names = model.states.map((s) => s.name);
  const empty: SimResult = { t: [], series: {} };

  let derivs: EvalFunction[];
  let derived: EvalFunction[];
  let stop: EvalFunction | undefined;
  const y: number[] = [];
  try {
    if (!(model.dt > 0) || !(model.tEnd > 0)) throw new Error('Time step and duration must be positive');
    if (new Set(names).size !== names.length) throw new Error('State variable names must be unique');
    // Initial conditions may reference parameters and earlier states.
    for (const s of model.states) {
      const v = Number(compile(s.init).evaluate(scope));
      if (!Number.isFinite(v)) throw new Error(`Initial value of ${s.name} is not a number`);
      scope[s.name] = v;
      y.push(v);
    }
    derivs = model.states.map((s) => compile(s.deriv));
    derived = model.derived.map((d) => compile(d.expr));
    stop = model.stopWhen ? compile(model.stopWhen) : undefined;
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }

  const n = names.length;
  const f = (t: number, state: number[], out: number[]) => {
    scope.t = t;
    for (let i = 0; i < n; i++) scope[names[i]] = state[i];
    for (let i = 0; i < n; i++) out[i] = Number(derivs[i].evaluate(scope));
  };

  const steps = Math.min(MAX_STEPS, Math.ceil(model.tEnd / model.dt));
  // Keep at most ~4000 recorded samples so charts stay fast.
  const stride = Math.max(1, Math.ceil(steps / 4000));
  const tOut: number[] = [];
  const series: Record<string, number[]> = {};
  for (const name of names) series[name] = [];
  for (const d of model.derived) series[d.name] = [];

  const record = (t: number) => {
    scope.t = t;
    for (let i = 0; i < n; i++) scope[names[i]] = y[i];
    tOut.push(t);
    for (let i = 0; i < n; i++) series[names[i]].push(y[i]);
    model.derived.forEach((d, i) => {
      const v = Number(derived[i].evaluate(scope));
      scope[d.name] = v;
      series[d.name].push(v);
    });
  };

  const k1 = new Array<number>(n), k2 = new Array<number>(n), k3 = new Array<number>(n), k4 = new Array<number>(n);
  const tmp = new Array<number>(n);
  const h = model.dt;
  try {
    record(0);
    for (let s = 1; s <= steps; s++) {
      const t = (s - 1) * h;
      f(t, y, k1);
      for (let i = 0; i < n; i++) tmp[i] = y[i] + (h / 2) * k1[i];
      f(t + h / 2, tmp, k2);
      for (let i = 0; i < n; i++) tmp[i] = y[i] + (h / 2) * k2[i];
      f(t + h / 2, tmp, k3);
      for (let i = 0; i < n; i++) tmp[i] = y[i] + h * k3[i];
      f(t + h, tmp, k4);
      for (let i = 0; i < n; i++) y[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
      if (y.some((v) => !Number.isFinite(v))) {
        return { t: tOut, series, error: `The solution blew up at t ≈ ${(s * h).toPrecision(3)} — try a smaller time step` };
      }
      const last = s === steps;
      let stopped = false;
      if (stop) {
        scope.t = s * h;
        for (let i = 0; i < n; i++) scope[names[i]] = y[i];
        stopped = Boolean(stop.evaluate(scope));
      }
      if (s % stride === 0 || last || stopped) record(s * h);
      if (stopped) break;
    }
  } catch (err) {
    return { t: tOut, series, error: err instanceof Error ? err.message : String(err) };
  }
  return { t: tOut, series };
}

/** Evaluate an expression at every recorded sample of a run (for scenes and custom plots). */
export function evalOverRun(expr: string, model: OdeModel, run: SimResult, paramValues?: Record<string, number>): number[] {
  const code = compile(expr);
  const scope: Record<string, number> = {};
  for (const p of model.params) scope[p.name] = paramValues?.[p.name] ?? p.value;
  const keys = Object.keys(run.series);
  return run.t.map((t, i) => {
    scope.t = t;
    for (const k of keys) scope[k] = run.series[k][i];
    return Number(code.evaluate(scope));
  });
}
