import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtNum } from '../core/units';
import { FigureExport, offscreen, standaloneSvg, type Figure } from './figure';
import { layoutHeight, layoutWidth, type FigureSettings } from './figureSize';
import { makeScale, tickLabel } from './scale';
import { useWidth } from './useSize';

interface Props {
  xs: number[];
  ys: number[];
  /** z[iy][ix] */
  z: number[][];
  xLabel: string;
  yLabel: string;
  zLabel: string;
  height?: number;
  marker?: { x: number; y: number };
  /** Base name for exported image files; defaults to the axis labels. */
  exportName?: string;
}

const M = { top: 12, right: 86, bottom: 40, left: 62 };
// Sequential ramp: one hue, light → dark.
const LO = [222, 235, 250];
const HI = [9, 48, 105];
const ramp = (u: number) => LO.map((c, i) => Math.round(c + (HI[i] - c) * u));

/** The cells as a PNG, enlarged without smoothing so every cell keeps hard edges wherever the figure ends up. */
function cellsImage(cells: HTMLCanvasElement): string {
  const k = Math.max(1, Math.ceil(1600 / Math.max(cells.width, cells.height)));
  const big = document.createElement('canvas');
  big.width = cells.width * k;
  big.height = cells.height * k;
  const ctx = big.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(cells, 0, 0, big.width, big.height);
  return big.toDataURL('image/png');
}

export function Heatmap(props: Props) {
  const { xs, ys, z, xLabel, yLabel, zLabel, height = 260, marker, exportName } = props;
  const [ref, width] = useWidth<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [tip, setTip] = useState<{ left: number; top: number; text: string[] } | null>(null);
  const iw = Math.max(40, width - M.left - M.right);
  const ih = Math.max(40, height - M.top - M.bottom);

  const [zmin, zmax] = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const row of z) for (const v of row) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    return lo <= hi ? [lo, hi] : [0, 1];
  }, [z]);

  const sx = makeScale(xs[0], xs[xs.length - 1], false, Math.max(3, Math.floor(iw / 90)));
  const sy = makeScale(ys[0], ys[ys.length - 1], false, Math.max(3, Math.floor(ih / 44)));

  useEffect(() => {
    const c = canvas.current;
    if (!c || !xs.length || !ys.length) return;
    c.width = xs.length;
    c.height = ys.length;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(xs.length, ys.length);
    const span = zmax - zmin || 1;
    for (let iy = 0; iy < ys.length; iy++) {
      for (let ix = 0; ix < xs.length; ix++) {
        const v = z[ys.length - 1 - iy]?.[ix];
        const o = (iy * xs.length + ix) * 4;
        if (Number.isFinite(v)) {
          const [r, g, b] = ramp((v - zmin) / span);
          img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
        } else img.data[o + 3] = 0;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [xs, ys, z, zmin, zmax]);

  const figure = async (settings: FigureSettings): Promise<Figure | null> => {
    const lw = layoutWidth(width, settings);
    const grab = (host: HTMLElement | null) => {
      const svg = host?.querySelector('svg');
      const cells = host?.querySelector('canvas');
      if (!svg || !cells || !cells.width) return null;
      const w = svg.width.baseVal.value, h = svg.height.baseVal.value;
      const underlay = { href: cellsImage(cells), x: M.left, y: M.top, width: Math.max(40, w - M.left - M.right), height: Math.max(40, h - M.top - M.bottom), pixelated: true };
      return { ...standaloneSvg(svg, { underlay }), shownPx: width };
    };
    const lh = layoutHeight(width, height, settings);
    if (lw === width && lh === height) return grab(ref.current);
    const copy = await offscreen(<Heatmap {...props} height={lh} />, lw);
    try {
      return grab(copy.el);
    } finally {
      copy.dispose();
    }
  };

  const zTicks = makeScale(zmin, zmax, false, 4).ticks.filter((t) => t >= zmin && t <= zmax);
  const gradId = useMemo(() => `grad-${Math.random().toString(36).slice(2)}`, []);

  return (
    <div className="plot viz-root" ref={ref} style={{ height }}>
      <FigureExport name={exportName ?? `${zLabel} over ${xLabel} and ${yLabel}`} build={figure} />
      <canvas
        ref={canvas}
        className="heatmap-canvas"
        style={{ left: M.left, top: M.top, width: iw, height: ih }}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const ix = Math.min(xs.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * xs.length)));
          const iy = Math.min(ys.length - 1, Math.max(0, Math.floor((1 - (e.clientY - r.top) / r.height) * ys.length)));
          setTip({
            left: e.clientX - r.left + M.left + 14,
            top: e.clientY - r.top + M.top,
            text: [`${xLabel}: ${fmtNum(xs[ix], 4)}`, `${yLabel}: ${fmtNum(ys[iy], 4)}`, `${zLabel}: ${fmtNum(z[iy][ix], 5)}`],
          });
        }}
        onMouseLeave={() => setTip(null)}
      />
      <svg width={width} height={height} className="heatmap-axes" role="img" aria-label={`${zLabel} over ${xLabel} and ${yLabel}`}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor={`rgb(${LO.join(',')})`} />
            <stop offset="1" stopColor={`rgb(${HI.join(',')})`} />
          </linearGradient>
        </defs>
        {sx.ticks.map((t) => (
          <text key={`x${t}`} className="plot-tick" x={M.left + sx.norm(t) * iw} y={M.top + ih + 16} textAnchor="middle">{tickLabel(t)}</text>
        ))}
        {sy.ticks.map((t) => (
          <text key={`y${t}`} className="plot-tick" x={M.left - 8} y={M.top + (1 - sy.norm(t)) * ih} textAnchor="end" dominantBaseline="middle">{tickLabel(t)}</text>
        ))}
        <rect className="plot-frame" x={M.left} y={M.top} width={iw} height={ih} />
        <text className="plot-label" x={M.left + iw / 2} y={height - 6} textAnchor="middle">{xLabel}</text>
        <text className="plot-label" transform={`translate(13 ${M.top + ih / 2}) rotate(-90)`} textAnchor="middle">{yLabel}</text>
        <rect x={M.left + iw + 14} y={M.top} width={12} height={ih} fill={`url(#${gradId})`} rx={2} />
        {zTicks.map((t) => (
          <text key={`z${t}`} className="plot-tick" x={M.left + iw + 31} y={M.top + (1 - (t - zmin) / (zmax - zmin || 1)) * ih} dominantBaseline="middle">{tickLabel(t)}</text>
        ))}
        {marker && (
          <circle className="plot-dot" cx={M.left + sx.norm(marker.x) * iw} cy={M.top + (1 - sy.norm(marker.y)) * ih} r={5.5} fill="var(--series-2)" />
        )}
      </svg>
      {tip && (
        <div className="plot-tip" style={{ left: Math.min(tip.left, width - 170), top: tip.top }}>
          {tip.text.map((t, i) => <div key={i} className={i === 2 ? 'plot-tip-x' : undefined}>{t}</div>)}
        </div>
      )}
    </div>
  );
}
