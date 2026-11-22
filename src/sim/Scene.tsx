import { useEffect, useMemo, useRef } from 'react';
import { evalOverRun, type OdeModel, type SimResult } from '../core/ode';
import { useWidth } from '../components/useSize';

interface Props {
  model: OdeModel;
  run: SimResult;
  /** Index of the sample to draw. */
  frame: number;
  height?: number;
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Animated picture of the system: bodies, rods/springs and trails. */
export function Scene({ model, run, frame, height = 280 }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);

  const data = useMemo(() => {
    if (!model.scene || !run.t.length) return null;
    try {
      const bodies = model.scene.bodies.map((b) => ({
        def: b,
        x: evalOverRun(b.x, model, run),
        y: evalOverRun(b.y, model, run),
        lx: Array.isArray(b.link) ? evalOverRun(b.link[0], model, run) : null,
        ly: Array.isArray(b.link) ? evalOverRun(b.link[1], model, run) : null,
      }));
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      const grow = (x: number, y: number) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      };
      for (const b of bodies) {
        b.x.forEach((x, i) => grow(x, b.y[i]));
        if (b.def.link === 'origin') grow(0, 0);
        if (b.lx && b.ly) b.lx.forEach((x, i) => grow(x, b.ly![i]));
      }
      for (const [ax, ay] of model.scene.anchors ?? []) grow(ax, ay);
      if (!(x0 <= x1)) return null;
      return { bodies, bounds: { x0, x1, y0, y1 } };
    } catch {
      return null;
    }
  }, [model, run]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !data) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = height * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const { x0, x1, y0, y1 } = data.bounds;
    const pad = 28;
    const spanX = x1 - x0 || 1;
    const spanY = y1 - y0 || 1;
    const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / Math.max(spanY, spanX * 0.15));
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const X = (x: number) => width / 2 + (x - cx) * scale;
    const Y = (y: number) => height / 2 - (y - cy) * scale;

    const ink = css('--text-muted');
    const grid = css('--grid');
    const colors = [css('--series-1'), css('--series-2'), css('--series-3')];

    // Axes through the origin, when visible.
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (Y(0) > 0 && Y(0) < height) { ctx.moveTo(0, Y(0)); ctx.lineTo(width, Y(0)); }
    if (X(0) > 0 && X(0) < width) { ctx.moveTo(X(0), 0); ctx.lineTo(X(0), height); }
    ctx.stroke();

    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = ink;
    for (const [ax, ay, label] of model.scene?.anchors ?? []) {
      ctx.beginPath();
      ctx.arc(X(ax), Y(ay), 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(label, X(ax) - 10, Y(ay) + 26);
    }

    const i = Math.min(frame, run.t.length - 1);
    data.bodies.forEach((b, bi) => {
      const color = colors[bi % colors.length];
      if (b.def.trail) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let j = 0; j <= i; j++) (j ? ctx.lineTo : ctx.moveTo).call(ctx, X(b.x[j]), Y(b.y[j]));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const bx = X(b.x[i]);
      const by = Y(b.y[i]);
      const from = b.def.link === 'origin' ? [X(0), Y(0)] : b.lx && b.ly ? [X(b.lx[i]), Y(b.ly[i])] : null;
      if (from) {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (b.def.linkStyle === 'spring') {
          // Zig-zag coil between the two end points.
          const [fx, fy] = from;
          const len = Math.hypot(bx - fx, by - fy) || 1;
          const ux = (bx - fx) / len, uy = (by - fy) / len;
          const coils = 10;
          ctx.moveTo(fx, fy);
          for (let k = 1; k < coils * 2; k++) {
            const tt = k / (coils * 2);
            const side = k % 2 ? 7 : -7;
            ctx.lineTo(fx + ux * len * tt - uy * side, fy + uy * len * tt + ux * side);
          }
          ctx.lineTo(bx, by);
        } else {
          ctx.moveTo(from[0], from[1]);
          ctx.lineTo(bx, by);
        }
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.strokeStyle = css('--surface');
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bx, by, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (b.def.label) {
        ctx.fillStyle = ink;
        ctx.fillText(b.def.label, bx + 13, by - 10);
      }
    });
  }, [data, frame, width, height, model, run]);

  return (
    <div ref={ref} className="scene" style={{ height }}>
      {data ? <canvas ref={canvas} style={{ width, height }} aria-label={`Animation of ${model.name}`} /> : <p className="muted pad">This model has no picture — use the charts.</p>}
    </div>
  );
}
