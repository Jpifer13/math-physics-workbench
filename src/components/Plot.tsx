import { useMemo, useState } from 'react';
import { saveFile } from '../saveFile';
import { fmtNum } from '../core/units';
import { makeScale, padExtent, robustExtent, tickLabel } from './scale';
import { useWidth } from './useSize';

export interface Series {
  name: string;
  x: number[];
  y: number[];
  /** Palette slot 1–8; defaults to the series' position. */
  slot?: number;
  dashed?: boolean;
  /** Draw individual samples as dots instead of a line (measured data). */
  points?: boolean;
}
export interface Marker {
  x: number;
  y: number;
  slot?: number;
  label?: string;
}

interface Props {
  series: Series[];
  xLabel?: string;
  yLabel?: string;
  logX?: boolean;
  logY?: boolean;
  height?: number;
  /** Same scale on both axes (trajectories, phase portraits). */
  equal?: boolean;
  markers?: Marker[];
  /** Vertical guide line at this x (e.g. the current time). */
  cursorX?: number;
  /** Crosshair + tooltip keyed on x. Disable for parametric curves. */
  hover?: boolean;
  xDomain?: [number, number];
  yDomain?: [number, number];
  empty?: string;
  /** Base name for exported image files; defaults to the axis labels. */
  exportName?: string;
}

const M = { top: 12, right: 16, bottom: 40, left: 62 };
export const seriesColor = (slot: number) => `var(--series-${((slot - 1) % 8) + 1})`;

const STYLE_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'font-size', 'font-family', 'font-weight', 'opacity', 'fill-opacity', 'paint-order'];

/**
 * A standalone SVG of a chart: styles that live in the app's stylesheet are
 * written onto each element, a white background and the legend are added, so
 * the file looks the same in a paper, a slide or a vector editor.
 */
function standaloneSvg(svg: SVGSVGElement, legend: { name: string; color: string; dashed?: boolean; points?: boolean }[]): { text: string; width: number; height: number } {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const from = [svg, ...svg.querySelectorAll('*')];
  const to = [clone, ...clone.querySelectorAll('*')];
  from.forEach((el, i) => {
    const cs = getComputedStyle(el);
    for (const p of STYLE_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v) (to[i] as SVGElement).style.setProperty(p, v);
    }
    to[i].removeAttribute('class');
    // Colours given as stylesheet variables mean nothing outside the app; the resolved value is in the style.
    for (const a of ['fill', 'stroke']) if (to[i].getAttribute(a)?.includes('var(')) to[i].removeAttribute(a);
  });
  // The playback cursor and hover read-out belong to the moment, not to the figure.
  clone.querySelectorAll('[data-live]').forEach((el) => el.remove());
  const width = svg.width.baseVal.value;
  const rowH = 18;
  const top = legend.length > 1 ? legend.length * rowH + 6 : 0;
  const height = svg.height.baseVal.value + top;
  const ns = 'http://www.w3.org/2000/svg';
  const root = document.createElementNS(ns, 'svg');
  root.setAttribute('xmlns', ns);
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  root.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', '#ffffff');
  root.appendChild(bg);
  if (top) {
    const font = getComputedStyle(svg).fontFamily;
    legend.forEach((l, i) => {
      const y = 12 + i * rowH;
      const mark = document.createElementNS(ns, l.points ? 'circle' : 'line');
      if (l.points) { mark.setAttribute('cx', '74'); mark.setAttribute('cy', String(y)); mark.setAttribute('r', '3'); mark.setAttribute('fill', l.color); }
      else {
        mark.setAttribute('x1', '62'); mark.setAttribute('x2', '86'); mark.setAttribute('y1', String(y)); mark.setAttribute('y2', String(y));
        mark.setAttribute('stroke', l.color); mark.setAttribute('stroke-width', '2');
        if (l.dashed) mark.setAttribute('stroke-dasharray', '6 4');
      }
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('x', '94'); text.setAttribute('y', String(y + 4));
      text.setAttribute('font-size', '12'); text.setAttribute('font-family', font); text.setAttribute('fill', '#484644');
      text.textContent = l.name;
      root.append(mark, text);
    });
  }
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('transform', `translate(0 ${top})`);
  while (clone.firstChild) g.appendChild(clone.firstChild);
  root.appendChild(g);
  return { text: new XMLSerializer().serializeToString(root), width, height };
}

/** Rasterise an SVG at `scale` times its size (3 ≈ 300 dpi at typical figure widths). */
function svgToPng(svg: { text: string; width: number; height: number }, scale: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(svg.width * scale);
      canvas.height = Math.round(svg.height * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png').split(',')[1]);
    };
    img.onerror = () => reject(new Error('The chart could not be rendered as an image'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.text)}`;
  });
}

export function Plot({
  series, xLabel, yLabel, logX = false, logY = false, height = 260, equal, markers = [], cursorX,
  hover = true, xDomain, yDomain, empty = 'Nothing to plot yet', exportName,
}: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hoverX, setHoverX] = useState<number | null>(null);
  const iw = Math.max(40, width - M.left - M.right);
  const ih = Math.max(40, height - M.top - M.bottom);

  const { sx, sy } = useMemo(() => {
    let xe = xDomain ?? padExtent(robustExtent(series.map((s) => s.x), logX), logX, 0);
    let ye = yDomain ?? padExtent(robustExtent(series.map((s) => s.y), logY), logY);
    if (equal && !logX && !logY) {
      // Grow the tighter axis so one data unit is the same length on both.
      xe = padExtent(xe, false);
      const perPx = Math.max((xe[1] - xe[0]) / iw, (ye[1] - ye[0]) / ih) || 1;
      const cx = (xe[0] + xe[1]) / 2;
      const cy = (ye[0] + ye[1]) / 2;
      xe = [cx - (perPx * iw) / 2, cx + (perPx * iw) / 2];
      ye = [cy - (perPx * ih) / 2, cy + (perPx * ih) / 2];
    }
    return {
      sx: makeScale(xe[0], xe[1], logX, Math.max(3, Math.floor(iw / 90))),
      sy: makeScale(ye[0], ye[1], logY, Math.max(3, Math.floor(ih / 34))),
    };
  }, [series, logX, logY, equal, iw, ih, xDomain, yDomain]);

  const px = (v: number) => M.left + sx.norm(v) * iw;
  const py = (v: number) => M.top + (1 - sy.norm(v)) * ih;

  const paths = useMemo(
    () =>
      series.map((s) => {
        if (s.points) return '';
        let d = '';
        let pen = false;
        const n = Math.min(s.x.length, s.y.length);
        for (let i = 0; i < n; i++) {
          const X = px(s.x[i]);
          const Y = py(s.y[i]);
          // Break the line at gaps and at values far outside the frame (asymptotes).
          if (!Number.isFinite(X) || !Number.isFinite(Y) || Y < -4 * height || Y > 5 * height) {
            pen = false;
            continue;
          }
          d += `${pen ? 'L' : 'M'}${X.toFixed(1)},${Y.toFixed(1)}`;
          pen = true;
        }
        return d;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, sx, sy, iw, ih],
  );

  const hasData = series.some((s) => s.y.some(Number.isFinite));

  // Nearest sample to the hovered x, per series.
  const hoverPts = useMemo(() => {
    if (hoverX === null || !hover) return [];
    return series.map((s) => {
      let best = -1;
      let bd = Infinity;
      for (let i = 0; i < s.x.length; i++) {
        const dd = Math.abs((sx.log ? Math.log10(s.x[i]) : s.x[i]) - (sx.log ? Math.log10(hoverX) : hoverX));
        if (dd < bd) { bd = dd; best = i; }
      }
      return best >= 0 && Number.isFinite(s.y[best]) ? { x: s.x[best], y: s.y[best] } : null;
    });
  }, [hoverX, hover, series, sx]);
  const anchor = hoverPts.find(Boolean) ?? null;

  const exportImage = async (kind: 'svg' | 'png') => {
    const svg = ref.current?.querySelector('svg');
    if (!svg) return;
    const sample = document.createElement('span');
    ref.current!.appendChild(sample);
    const legend = series.map((s, i) => {
      // Resolve the palette variable to the colour actually in use.
      sample.style.color = seriesColor(s.slot ?? i + 1);
      return { name: s.name, color: getComputedStyle(sample).color, dashed: s.dashed, points: s.points };
    });
    sample.remove();
    const image = standaloneSvg(svg, legend);
    const name = exportName ?? ([yLabel, xLabel].filter(Boolean).join(' vs ') || 'chart');
    try {
      if (kind === 'svg') await saveFile(image.text, name, 'svg');
      else await saveFile(await svgToPng(image, 3), name, 'png', 'base64');
    } catch {
      /* cancelled or failed; nothing to clean up */
    }
  };

  const clipId = useMemo(() => `clip-${Math.random().toString(36).slice(2)}`, []);
  const tipLeft = anchor ? px(anchor.x) : 0;

  return (
    <div className="plot-wrap viz-root" ref={ref}>
      {series.length > 1 && (
        <div className="plot-legend">
          {series.map((s, i) => (
            <span key={s.name + i}><span className={`swatch ${s.points ? 'dot' : `line${s.dashed ? ' dashed' : ''}`}`} style={{ color: seriesColor(s.slot ?? i + 1) }} />{s.name}</span>
          ))}
        </div>
      )}
      <div className="plot" style={{ height }}>
      {hasData && (
        <div className="plot-export" role="group" aria-label="Export this chart">
          <button title="Save as a vector image (SVG) — scales cleanly in papers and slides" onClick={() => void exportImage('svg')}>SVG</button>
          <button title="Save as a high-resolution image (PNG, 3×)" onClick={() => void exportImage('png')}>PNG</button>
        </div>
      )}
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${yLabel ?? 'y'} versus ${xLabel ?? 'x'}`}
        onMouseMove={(e) => {
          if (!hover) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const u = (e.clientX - rect.left - M.left) / iw;
          setHoverX(u >= 0 && u <= 1 ? sx.invert(u) : null);
        }}
        onMouseLeave={() => setHoverX(null)}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={M.left} y={M.top} width={iw} height={ih} />
          </clipPath>
        </defs>
        {sy.ticks.map((t) => (
          <g key={`y${t}`}>
            <line className="plot-grid" x1={M.left} x2={M.left + iw} y1={py(t)} y2={py(t)} />
            <text className="plot-tick" x={M.left - 8} y={py(t)} textAnchor="end" dominantBaseline="middle">{tickLabel(t)}</text>
          </g>
        ))}
        {sx.ticks.map((t) => (
          <g key={`x${t}`}>
            <line className="plot-grid" x1={px(t)} x2={px(t)} y1={M.top} y2={M.top + ih} />
            <text className="plot-tick" x={px(t)} y={M.top + ih + 16} textAnchor="middle">{tickLabel(t)}</text>
          </g>
        ))}
        {/* Zero lines read as the axes when they are inside the frame. */}
        {!sy.log && sy.min < 0 && sy.max > 0 && <line className="plot-zero" x1={M.left} x2={M.left + iw} y1={py(0)} y2={py(0)} />}
        {!sx.log && sx.min < 0 && sx.max > 0 && <line className="plot-zero" x1={px(0)} x2={px(0)} y1={M.top} y2={M.top + ih} />}
        <rect className="plot-frame" x={M.left} y={M.top} width={iw} height={ih} />
        {xLabel && <text className="plot-label" x={M.left + iw / 2} y={height - 6} textAnchor="middle">{xLabel}</text>}
        {yLabel && (
          <text className="plot-label" transform={`translate(13 ${M.top + ih / 2}) rotate(-90)`} textAnchor="middle">{yLabel}</text>
        )}
        <g clipPath={`url(#${clipId})`}>
          {paths.map((d, i) => (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={seriesColor(series[i].slot ?? i + 1)}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={series[i].dashed ? '6 4' : undefined}
            />
          ))}
          {series.map((s, i) => {
            if (!s.points) return null;
            // Thin very large data sets so the chart stays responsive.
            const stride = Math.max(1, Math.ceil(s.x.length / 1500));
            const dots = [];
            for (let k = 0; k < s.x.length; k += stride) {
              const X = px(s.x[k]), Y = py(s.y[k]);
              if (Number.isFinite(X) && Number.isFinite(Y)) dots.push(<circle key={k} cx={X} cy={Y} r={2.6} />);
            }
            return <g key={`pts${i}`} fill={seriesColor(s.slot ?? i + 1)} fillOpacity={0.75}>{dots}</g>;
          })}
          {cursorX !== undefined && Number.isFinite(px(cursorX)) && (
            <line className="plot-cursor" data-live x1={px(cursorX)} x2={px(cursorX)} y1={M.top} y2={M.top + ih} />
          )}
          {anchor && <line className="plot-cursor" data-live x1={px(anchor.x)} x2={px(anchor.x)} y1={M.top} y2={M.top + ih} />}
          {hoverPts.map((p, i) =>
            p ? <circle key={i} data-live cx={px(p.x)} cy={py(p.y)} r={4.5} fill={seriesColor(series[i].slot ?? i + 1)} className="plot-dot" /> : null,
          )}
          {markers.map((m, i) =>
            Number.isFinite(px(m.x)) && Number.isFinite(py(m.y)) ? (
              <g key={i}>
                <circle cx={px(m.x)} cy={py(m.y)} r={5.5} fill={seriesColor(m.slot ?? 1)} className="plot-dot" />
                {m.label && (
                  <text className="plot-marker-label" x={px(m.x) + (px(m.x) > M.left + iw * 0.7 ? -10 : 10)} y={py(m.y) - 9}
                    textAnchor={px(m.x) > M.left + iw * 0.7 ? 'end' : 'start'}>{m.label}</text>
                )}
              </g>
            ) : null,
          )}
        </g>
        {!hasData && <text className="plot-empty" x={M.left + iw / 2} y={M.top + ih / 2} textAnchor="middle">{empty}</text>}
      </svg>
      {anchor && (
        <div className="plot-tip" style={tipLeft > width * 0.6 ? { right: width - tipLeft + 12, top: M.top + 6 } : { left: tipLeft + 12, top: M.top + 6 }}>
          <div className="plot-tip-x">{xLabel ? `${xLabel}: ` : ''}{fmtNum(anchor.x, 4)}</div>
          {hoverPts.map((p, i) =>
            p ? (
              <div key={i} className="plot-tip-row">
                <span className="swatch" style={{ background: seriesColor(series[i].slot ?? i + 1) }} />
                {series.length > 1 && <span className="plot-tip-name">{series[i].name}</span>}
                <b>{fmtNum(p.y, 5)}</b>
              </div>
            ) : null,
          )}
        </div>
      )}
      </div>
    </div>
  );
}
