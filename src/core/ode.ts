/**
 * Initial-value-problem modelling: a model is a set of state variables with
 * derivative expressions, integrated by a choice of fixed-step (Euler, RK4),
 * adaptive (Dormand–Prince RK45) or stiff (Rosenbrock 2(3)) methods.
 */
import { compile as mathCompile, type EvalFunction } from 'mathjs';
import { compileFast, type Fast } from './fastExpr';

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

// Parsing dominates short runs, and experiments re-run the same model hundreds of times.
const compiled = new Map<string, EvalFunction>();
function compile(expr: string): EvalFunction {
  let code = compiled.get(expr);
  if (!code) {
    if (compiled.size > 500) compiled.clear();
    code = mathCompile(expr);
    compiled.set(expr, code);
  }
  return code;
}

export type SolverMethod = 'rk45' | 'ros23' | 'rk4' | 'euler';

export type MeasureId = 'final' | 'max' | 'min' | 'mean' | 'rms' | 'amplitude' | 'period' | 'tmax' | 'duration';

/** A virtual experiment: vary one parameter and measure one observable on each run. */
export interface ScanConfig {
  param: string;
  from: number;
  to: number;
  points: number;
  observable: string;
  measure: MeasureId;
  /** Optional second parameter: the experiment becomes a 2-D map. */
  param2?: string;
  from2?: number;
  to2?: number;
  points2?: number;
}

/** Measured data kept with a model, and how its columns map onto the model's observables. */
export interface ModelData {
  name: string;
  columns: { name: string; values: number[] }[];
  timeCol: number;
  /** Each measured column to compare, the observable it corresponds to, and an optional error-bar column. */
  pairs: { valueCol: number; observable: string; sigmaCol?: number }[];
}

/** A discrete event: when `when` becomes true, apply the assignments in `then` to the state. */
export interface SimEvent {
  /** Condition; the event fires at the moment it turns from false to true. */
  when: string;
  /** Assignments to state variables, separated by `;` — e.g. `vy = -e * vy`. All right-hand sides use the pre-event state. */
  then: string;
}

export interface OdeModel {
  id: string;
  name: string;
  summary: string;
  states: StateVar[];
  params: Param[];
  derived: Derived[];
  tEnd: number;
  /** Step size for the fixed-step methods. */
  dt: number;
  /** Integration method (default RK4). */
  method?: SolverMethod;
  /** Relative error tolerance for the adaptive method (default 1e-8). */
  tol?: number;
  /** Stop the run early when this expression becomes true (e.g. "y < 0"). */
  stopWhen?: string;
  /** Discrete events that reset state variables (bounces, kicks, switching). */
  events?: SimEvent[];
  scene?: Scene;
  /** Default variables to chart. */
  timeSeries: string[];
  phase: [string, string];
  /** Default axes of the 3-D trajectory view (state/derived names or "t"). */
  view3d?: [string, string, string];
  /** The saved parameter-scan experiment for this model. */
  experiment?: ScanConfig;
  /** Imported measurements to compare and fit against. */
  data?: ModelData;
  /** Free-form lab notes kept with the model. */
  notes?: string;
}

export interface SimStats {
  method: SolverMethod;
  /** Accepted integration steps. */
  steps: number;
  /** Steps rejected by the adaptive error control. */
  rejected: number;
  /** Right-hand-side evaluations. */
  evals: number;
  /** Discrete events that fired. */
  events: number;
  /** Wall-clock time in milliseconds. */
  ms: number;
}

export interface SimResult {
  t: number[];
  series: Record<string, number[]>;
  error?: string;
  stats?: SimStats;
  /** Times at which discrete events fired. */
  eventTimes?: number[];
}

const MAX_STEPS = 400_000;
const MAX_SAMPLES = 6000;
const MAX_EVENTS = 5000;

// Dormand–Prince 5(4) coefficients.
const DP_C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];
const DP_A = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
];
const DP_B5 = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0];
const DP_B4 = [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40];

export function simulate(model: OdeModel, paramValues?: Record<string, number>): SimResult {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const method: SolverMethod = model.method ?? 'rk4';
  const names = model.states.map((s) => s.name);
  const stats: SimStats = { method, steps: 0, rejected: 0, evals: 0, events: 0, ms: 0 };
  const finish = (r: SimResult): SimResult => {
    stats.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
    return { ...r, stats };
  };

  // Every named quantity lives in one flat array: [t, parameters…, states…, observables…].
  const order = ['t', ...model.params.map((p) => p.name), ...names, ...model.derived.map((d) => d.name)];
  const slot: Record<string, number> = {};
  order.forEach((name, i) => { slot[name] = i; });
  const vals = new Float64Array(order.length);
  model.params.forEach((p) => { vals[slot[p.name]] = paramValues?.[p.name] ?? p.value; });
  const stateAt = names.length ? slot[names[0]] : 0;
  const derivedAt = stateAt + names.length;

  /** Compile an expression: the fast path when possible, mathjs otherwise. */
  const prepare = (expr: string): Fast => {
    const fast = compileFast(expr, slot);
    if (fast) return fast;
    const code = compile(expr);
    const scope: Record<string, number> = {};
    return (v) => {
      for (let i = 0; i < order.length; i++) scope[order[i]] = v[i];
      return Number(code.evaluate(scope));
    };
  };

  let derivs: Fast[];
  let derived: Fast[];
  let stop: Fast | undefined;
  let events: { when: Fast; set: { index: number; value: Fast }[] }[] = [];
  const y: number[] = [];
  try {
    if (!(model.tEnd > 0)) throw new Error('Duration must be positive');
    if ((method === 'rk4' || method === 'euler') && !(model.dt > 0)) throw new Error('Time step must be positive');
    if (!names.length) throw new Error('Add at least one state variable');
    const all = order.slice(1);
    const dup = all.find((n, i) => all.indexOf(n) !== i);
    if (dup) throw new Error(`The name "${dup}" is used more than once`);
    const bad = all.find((n) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) || n === 't');
    if (bad !== undefined) throw new Error(`"${bad}" is not a valid name (use letters, digits and _; "t" is reserved for time)`);
    // Initial conditions may reference parameters and earlier states (mathjs reports unknown symbols clearly).
    const initScope: Record<string, number> = { t: 0 };
    for (const p of model.params) initScope[p.name] = vals[slot[p.name]];
    model.states.forEach((s, i) => {
      const v = Number(compile(s.init).evaluate(initScope));
      if (!Number.isFinite(v)) throw new Error(`Initial value of ${s.name} is not a number`);
      initScope[s.name] = v;
      vals[stateAt + i] = v;
      y.push(v);
    });
    // Evaluate each expression once through mathjs so mistakes (unknown symbols, syntax) are reported up front.
    const check = (expr: string, known: Record<string, number>) => { compile(expr).evaluate({ ...known }); };
    const known: Record<string, number> = { ...initScope };
    model.derived.forEach((d) => { check(d.expr, known); known[d.name] = 0; });
    model.states.forEach((s) => check(s.deriv, known));
    if (model.stopWhen) check(model.stopWhen, known);
    derivs = model.states.map((s) => prepare(s.deriv));
    derived = model.derived.map((d) => prepare(d.expr));
    stop = model.stopWhen ? prepare(model.stopWhen) : undefined;
    events = (model.events ?? []).filter((e) => e.when.trim()).map((e, k) => {
      check(e.when, known);
      const set = e.then.split(/[;\n]/).map((a) => a.trim()).filter(Boolean).map((a) => {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)\s*(.+)$/.exec(a);
        if (!m) throw new Error(`Event ${k + 1}: "${a}" is not an assignment (write e.g. vy = -e * vy)`);
        const index = names.indexOf(m[1]);
        if (index < 0) throw new Error(`Event ${k + 1}: "${m[1]}" is not a state variable, so it cannot be reset`);
        check(m[2], known);
        return { index, value: prepare(m[2]) };
      });
      return { when: prepare(e.when), set };
    });
  } catch (err) {
    return finish({ t: [], series: {}, error: err instanceof Error ? err.message : String(err) });
  }

  const n = names.length;
  const nd = derived.length;
  /** Load a state into the value array, refreshing observables so rates may depend on them. */
  const load = (t: number, state: number[]) => {
    vals[0] = t;
    for (let i = 0; i < n; i++) vals[stateAt + i] = state[i];
    for (let i = 0; i < nd; i++) vals[derivedAt + i] = derived[i](vals);
  };
  const f = (t: number, state: number[], out: number[]) => {
    stats.evals++;
    load(t, state);
    for (let i = 0; i < n; i++) out[i] = derivs[i](vals);
  };

  const tOut: number[] = [];
  const series: Record<string, number[]> = {};
  for (const name of names) series[name] = [];
  for (const d of model.derived) series[d.name] = [];
  const record = (t: number) => {
    load(t, y);
    tOut.push(t);
    for (let i = 0; i < n; i++) series[names[i]].push(y[i]);
    for (let i = 0; i < nd; i++) series[model.derived[i].name].push(vals[derivedAt + i]);
  };
  const shouldStop = (t: number) => {
    if (!stop) return false;
    load(t, y);
    return Boolean(stop(vals));
  };
  const blewUp = (t: number): SimResult =>
    finish({ t: tOut, series, error: `The solution diverged at t ≈ ${t.toPrecision(3)} — try a smaller step or tolerance` });

  const tmp = new Array<number>(n);
  const yPrev = new Array<number>(n);
  const ra = new Array<number>(n), rb = new Array<number>(n), rc = new Array<number>(n), rd = new Array<number>(n);
  /** One classical RK4 step from (t0, y0), written to `out`. Used to locate events inside a step. */
  const rk4Step = (t0: number, y0: number[], h: number, out: number[]) => {
    f(t0, y0, ra);
    for (let i = 0; i < n; i++) tmp[i] = y0[i] + (h / 2) * ra[i];
    f(t0 + h / 2, tmp, rb);
    for (let i = 0; i < n; i++) tmp[i] = y0[i] + (h / 2) * rb[i];
    f(t0 + h / 2, tmp, rc);
    for (let i = 0; i < n; i++) tmp[i] = y0[i] + h * rc[i];
    f(t0 + h, tmp, rd);
    for (let i = 0; i < n; i++) out[i] = y0[i] + (h / 6) * (ra[i] + 2 * rb[i] + 2 * rc[i] + rd[i]);
  };
  const trial = new Array<number>(n);
  /**
   * `cond` turned true somewhere in the step of size h from (t0, yPrev). Bisect on the
   * step fraction; returns the bracket [last false, first true] as offsets from t0.
   */
  const bracket = (t0: number, h: number, cond: Fast): [number, number] => {
    let lo = 0, hi = h;
    for (let it = 0; it < 60 && hi - lo > 1e-13 * Math.max(1, Math.abs(t0), h); it++) {
      const mid = (lo + hi) / 2;
      rk4Step(t0, yPrev, mid, trial);
      load(t0 + mid, trial);
      if (cond(vals)) hi = mid;
      else lo = mid;
    }
    return [lo, hi];
  };
  /** Land on the first moment the stop condition holds, leaving that state in `y`. */
  const locateStop = (t0: number, h: number): number => {
    if (!stop) return t0 + h;
    const hi = bracket(t0, h, stop)[1];
    rk4Step(t0, yPrev, hi, y);
    return t0 + hi;
  };

  const eventTimes: number[] = [];
  const armed = events.map(() => true);
  let lastFired = -1;
  let lastTime = -Infinity;
  const readEvents = (t: number) => {
    load(t, y);
    events.forEach((e, k) => { armed[k] = !e.when(vals); });
  };
  /**
   * After a step from (t0, yPrev) to (t0 + h, y): if an event's condition has just turned
   * true, rewind to the instant before it, apply its resets, and return that time so the
   * integrator restarts there. Returns t0 + h when nothing fired.
   */
  const handleEvents = (t0: number, h: number): number => {
    const scale = Math.max(1, Math.abs(t0), h);
    load(t0 + h, y);
    let first = -1;
    let firstLo = h;
    for (let k = 0; k < events.length; k++) {
      if (!armed[k] || !events[k].when(vals)) continue;
      const [lo] = bracket(t0, h, events[k].when);
      load(t0 + h, y);
      // Straight after firing, the same condition turning true at once is the same crossing
      // carrying on (the reset did not clear it), not a new event: wait for it to clear.
      if (k === lastFired && t0 === lastTime && lo <= 4e-13 * scale) { armed[k] = false; continue; }
      if (first < 0 || lo < firstLo) { first = k; firstLo = lo; }
    }
    if (first < 0) {
      events.forEach((e, k) => { if (!e.when(vals)) armed[k] = true; });
      return t0 + h;
    }
    const te = t0 + firstLo;
    // One event re-firing ever sooner (a ball coming to rest by smaller and smaller bounces)
    // never lets time advance; say so rather than grind on or let the state slip through.
    if (first === lastFired && te - lastTime < 1e-9 * Math.max(1, model.tEnd)) {
      rk4Step(t0, yPrev, firstLo, y);
      record(te);
      throw new Error(`Events accumulate without limit at t ≈ ${te.toPrecision(5)} (Zeno behaviour) — add a stop condition, or change the event so the system can come to rest`);
    }
    if (++stats.events > MAX_EVENTS) throw new Error(`More than ${MAX_EVENTS.toLocaleString()} events fired — shorten the run or check the event conditions`);
    rk4Step(t0, yPrev, firstLo, y);
    record(te);
    // All right-hand sides see the pre-event state.
    const next = events[first].set.map((a) => a.value(vals));
    events[first].set.forEach((a, i) => { y[a.index] = next[i]; });
    if (y.some((v) => !Number.isFinite(v))) throw new Error(`An event reset produced a non-finite value at t ≈ ${te.toPrecision(4)}`);
    record(te);
    eventTimes.push(te);
    lastFired = first;
    lastTime = te;
    // Re-arm from the post-reset state: an event whose condition still holds waits until it clears.
    readEvents(te);
    return te;
  };
  const hasEvents = events.length > 0;

  try {
    record(0);
    if (hasEvents) readEvents(0);
    if (method === 'rk45') {
      const rtol = model.tol && model.tol > 0 ? model.tol : 1e-8;
      const atol = rtol * 1e-3;
      // Cap the step so the recorded trajectory stays smooth enough to plot and animate.
      const hMax = model.tEnd / 400;
      const k: number[][] = Array.from({ length: 7 }, () => new Array<number>(n));
      const yNew = new Array<number>(n);
      let t = 0;
      let h = Math.min(hMax, model.tEnd * 1e-3);
      while (t < model.tEnd * (1 - 1e-12)) {
        if (stats.steps + stats.rejected > MAX_STEPS) {
          return finish({ t: tOut, series, error: 'Too many steps — the system may be stiff; loosen the tolerance or shorten the run' });
        }
        h = Math.min(h, model.tEnd - t);
        f(t, y, k[0]);
        for (let st = 1; st < 7; st++) {
          for (let i = 0; i < n; i++) {
            let acc = 0;
            for (let j = 0; j < st; j++) acc += DP_A[st][j] * k[j][i];
            tmp[i] = y[i] + h * acc;
          }
          f(t + DP_C[st] * h, tmp, k[st]);
        }
        let err = 0;
        for (let i = 0; i < n; i++) {
          let s5 = 0, s4 = 0;
          for (let j = 0; j < 7; j++) { s5 += DP_B5[j] * k[j][i]; s4 += DP_B4[j] * k[j][i]; }
          yNew[i] = y[i] + h * s5;
          const scale = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(yNew[i]));
          err = Math.max(err, Math.abs(h * (s5 - s4)) / scale);
        }
        if (!Number.isFinite(err)) return blewUp(t);
        if (err <= 1) {
          for (let i = 0; i < n; i++) { yPrev[i] = y[i]; y[i] = yNew[i]; }
          stats.steps++;
          const tEvent = hasEvents ? handleEvents(t, h) : t + h;
          if (tEvent < t + h) {
            // Restart cautiously from the event: the right-hand side has just jumped.
            t = tEvent;
            h = Math.min(h, hMax) * 0.1;
            continue;
          }
          if (shouldStop(t + h)) {
            record(locateStop(t, h));
            break;
          }
          t += h;
          record(t);
        } else stats.rejected++;
        h = Math.min(hMax, h * Math.min(5, Math.max(0.2, 0.9 * Math.pow(Math.max(err, 1e-10), -0.2))));
        if (h < model.tEnd * 1e-14) return finish({ t: tOut, series, error: `Step size collapsed at t ≈ ${t.toPrecision(3)} — the equations may be singular there` });
      }
    } else if (method === 'ros23') {
      // Linearly implicit Rosenbrock 2(3) pair (Shampine & Reichelt's ode23s) for stiff systems.
      const rtol = model.tol && model.tol > 0 ? model.tol : 1e-6;
      const atol = rtol * 1e-3;
      const hMax = model.tEnd / 400;
      const d = 1 / (2 + Math.SQRT2);
      const e32 = 6 + Math.SQRT2;
      const SQRT_EPS = 1.4901161193847656e-8;
      const F0 = new Array<number>(n), F1 = new Array<number>(n), F2 = new Array<number>(n), col = new Array<number>(n);
      const k1 = new Array<number>(n), k2 = new Array<number>(n), k3 = new Array<number>(n), dT = new Array<number>(n);
      const yNew = new Array<number>(n), rhs = new Array<number>(n);
      const J = Array.from({ length: n }, () => new Array<number>(n));
      const W = Array.from({ length: n }, () => new Array<number>(n));
      const perm = new Array<number>(n);
      /** In-place LU factorisation of W with partial pivoting; false if singular. */
      const factor = (): boolean => {
        for (let c = 0; c < n; c++) {
          let p = c;
          for (let r = c + 1; r < n; r++) if (Math.abs(W[r][c]) > Math.abs(W[p][c])) p = r;
          if (!(Math.abs(W[p][c]) > 1e-300)) return false;
          perm[c] = p;
          if (p !== c) { const swap = W[p]; W[p] = W[c]; W[c] = swap; }
          for (let r = c + 1; r < n; r++) {
            const m = (W[r][c] /= W[c][c]);
            for (let q = c + 1; q < n; q++) W[r][q] -= m * W[c][q];
          }
        }
        return true;
      };
      const solve = (b: number[], out: number[]) => {
        for (let i = 0; i < n; i++) out[i] = b[i];
        for (let c = 0; c < n; c++) {
          const p = perm[c];
          if (p !== c) { const swap = out[p]; out[p] = out[c]; out[c] = swap; }
          for (let r = c + 1; r < n; r++) out[r] -= W[r][c] * out[c];
        }
        for (let c = n - 1; c >= 0; c--) {
          for (let q = c + 1; q < n; q++) out[c] -= W[c][q] * out[q];
          out[c] /= W[c][c];
        }
      };
      let t = 0;
      let h = Math.min(hMax, model.tEnd * 1e-4);
      let stopped = false;
      while (!stopped && t < model.tEnd * (1 - 1e-12)) {
        h = Math.min(h, model.tEnd - t);
        f(t, y, F0);
        // Jacobian and time derivative by forward differences (one evaluation per state).
        for (let j = 0; j < n; j++) {
          const del = SQRT_EPS * Math.max(Math.abs(y[j]), 1e-6);
          for (let i = 0; i < n; i++) tmp[i] = y[i];
          tmp[j] += del;
          f(t, tmp, col);
          for (let i = 0; i < n; i++) J[i][j] = (col[i] - F0[i]) / del;
        }
        const delT = SQRT_EPS * Math.max(Math.abs(t), h, 1e-6);
        f(t + delT, y, col);
        for (let i = 0; i < n; i++) dT[i] = (col[i] - F0[i]) / delT;

        for (;;) {
          if (stats.steps + stats.rejected > MAX_STEPS) {
            return finish({ t: tOut, series, error: 'Too many steps — loosen the tolerance or shorten the run' });
          }
          if (h < model.tEnd * 1e-14) return finish({ t: tOut, series, error: `Step size collapsed at t ≈ ${t.toPrecision(3)} — the equations may be singular there` });
          for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) W[i][j] = (i === j ? 1 : 0) - h * d * J[i][j];
          if (!factor()) { h /= 2; stats.rejected++; continue; }
          for (let i = 0; i < n; i++) rhs[i] = F0[i] + h * d * dT[i];
          solve(rhs, k1);
          for (let i = 0; i < n; i++) tmp[i] = y[i] + 0.5 * h * k1[i];
          f(t + 0.5 * h, tmp, F1);
          for (let i = 0; i < n; i++) rhs[i] = F1[i] - k1[i];
          solve(rhs, k2);
          for (let i = 0; i < n; i++) { k2[i] += k1[i]; yNew[i] = y[i] + h * k2[i]; }
          f(t + h, yNew, F2);
          for (let i = 0; i < n; i++) rhs[i] = F2[i] - e32 * (k2[i] - F1[i]) - 2 * (k1[i] - F0[i]) + h * d * dT[i];
          solve(rhs, k3);
          let err = 0;
          for (let i = 0; i < n; i++) {
            const scale = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(yNew[i]));
            err = Math.max(err, Math.abs((h / 6) * (k1[i] - 2 * k2[i] + k3[i])) / scale);
          }
          if (!Number.isFinite(err)) { h *= 0.25; stats.rejected++; continue; }
          const grow = Math.min(5, Math.max(0.2, 0.9 * Math.pow(Math.max(err, 1e-10), -1 / 3)));
          if (err > 1) { h *= grow; stats.rejected++; continue; }
          for (let i = 0; i < n; i++) { yPrev[i] = y[i]; y[i] = yNew[i]; }
          stats.steps++;
          const tEvent = hasEvents ? handleEvents(t, h) : t + h;
          if (tEvent < t + h) {
            t = tEvent;
            h *= 0.1;
            break;
          }
          if (shouldStop(t + h)) {
            record(locateStop(t, h));
            stopped = true;
          } else {
            t += h;
            record(t);
          }
          h = Math.min(hMax, h * grow);
          break;
        }
      }
    } else {
      const dt = model.dt;
      const steps = Math.ceil(model.tEnd / dt - 1e-9);
      if (steps > MAX_STEPS) throw new Error(`That is ${steps.toLocaleString()} steps — increase the time step or shorten the run`);
      const k1 = new Array<number>(n), k2 = new Array<number>(n), k3 = new Array<number>(n), k4 = new Array<number>(n);
      // Record a bounded number of samples so charts stay fast.
      const stride = Math.max(1, Math.ceil(steps / MAX_SAMPLES));
      // Time is base + k·dt so it does not drift; an event moves the base to the event time.
      let base = 0;
      let k = 0;
      for (;;) {
        const t = base + k * dt;
        const h = Math.min(dt, model.tEnd - t);
        if (!(h > model.tEnd * 1e-12)) break;
        if (stats.steps > MAX_STEPS) throw new Error('Too many steps — increase the time step or shorten the run');
        for (let i = 0; i < n; i++) yPrev[i] = y[i];
        f(t, y, k1);
        if (method === 'euler') {
          for (let i = 0; i < n; i++) y[i] += h * k1[i];
        } else {
          for (let i = 0; i < n; i++) tmp[i] = y[i] + (h / 2) * k1[i];
          f(t + h / 2, tmp, k2);
          for (let i = 0; i < n; i++) tmp[i] = y[i] + (h / 2) * k2[i];
          f(t + h / 2, tmp, k3);
          for (let i = 0; i < n; i++) tmp[i] = y[i] + h * k3[i];
          f(t + h, tmp, k4);
          for (let i = 0; i < n; i++) y[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
        }
        stats.steps++;
        if (y.some((v) => !Number.isFinite(v))) return blewUp(t + h);
        const tEvent = hasEvents ? handleEvents(t, h) : t + h;
        if (tEvent < t + h) {
          base = tEvent;
          k = 0;
          continue;
        }
        if (shouldStop(t + h)) {
          record(locateStop(t, h));
          break;
        }
        k++;
        const last = t + h >= model.tEnd * (1 - 1e-12);
        if (stats.steps % stride === 0 || last) record(last ? model.tEnd : base + k * dt);
      }
    }
  } catch (err) {
    return finish({ t: tOut, series, error: err instanceof Error ? err.message : String(err) });
  }

  // Thin very long adaptive runs, always keeping the final sample.
  if (tOut.length > MAX_SAMPLES * 1.5) {
    const stride = Math.ceil(tOut.length / MAX_SAMPLES);
    const keep = (arr: number[]) => arr.filter((_, i) => i % stride === 0 || i === arr.length - 1);
    const thinned: Record<string, number[]> = {};
    for (const key of Object.keys(series)) thinned[key] = keep(series[key]);
    return finish({ t: keep(tOut), series: thinned, eventTimes });
  }
  return finish({ t: tOut, series, eventTimes });
}

/** Index of the last recorded sample at or before time `t` (samples need not be evenly spaced). */
export function sampleIndex(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  if (hi < 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
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
