/** Numerical calculus helpers used by the math tools. */

export type Fn1 = (x: number) => number;

export function derivative(f: Fn1, x: number, h = 1e-5): number {
  const step = h * Math.max(1, Math.abs(x));
  return (f(x + step) - f(x - step)) / (2 * step);
}

/** Composite Simpson's rule. */
export function integrate(f: Fn1, a: number, b: number, n = 2000): number {
  if (a === b) return 0;
  const m = n % 2 === 0 ? n : n + 1;
  const h = (b - a) / m;
  let s = f(a) + f(b);
  for (let i = 1; i < m; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}

function bisect(f: Fn1, lo: number, hi: number): number {
  let flo = f(lo);
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (fm === 0) return mid;
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Roots of f in [a, b], found by scanning for sign changes then bisecting. */
export function findRoots(f: Fn1, a: number, b: number, samples = 2000): number[] {
  const roots: number[] = [];
  const push = (r: number) => {
    // Reject poles (sign change through infinity) and duplicates.
    if (Math.abs(f(r)) > 1e-6 * Math.max(1, Math.abs(f(r + 1e-3)), Math.abs(f(r - 1e-3)))) return;
    if (!roots.some((x) => Math.abs(x - r) < (b - a) * 1e-6)) roots.push(r);
  };
  let x0 = a;
  let f0 = f(a);
  for (let i = 1; i <= samples; i++) {
    const x1 = a + ((b - a) * i) / samples;
    const f1 = f(x1);
    if (Number.isFinite(f0) && Number.isFinite(f1)) {
      if (f0 === 0) push(x0);
      else if (f0 * f1 < 0) push(bisect(f, x0, x1));
    }
    x0 = x1;
    f0 = f1;
  }
  if (f0 === 0) push(x0);
  return roots;
}

export interface Extremum { x: number; y: number; kind: 'min' | 'max' }

/** Local extrema of f in [a, b]: roots of the numerical derivative. */
export function findExtrema(f: Fn1, a: number, b: number): Extremum[] {
  const df: Fn1 = (x) => derivative(f, x);
  return findRoots(df, a, b, 1000)
    .map((x) => {
      const curv = derivative(df, x, 1e-4);
      return { x, y: f(x), kind: curv > 0 ? ('min' as const) : ('max' as const) };
    })
    .filter((e) => Number.isFinite(e.y));
}
