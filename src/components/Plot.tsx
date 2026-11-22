import { useMemo, useState } from 'react';
import { fmtNum } from '../core/units';
import { FigureExport, legendHeight, offscreen, standaloneSvg, type Figure } from './figure';
import { layoutHeight, layoutWidth, type FigureSettings } from './figureSize';
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
/** A shaded region between two curves (an uncertainty band, the bars of a histogram). */
export interface Band {
  x: number[];
  lo: number[];
  hi: number[];
  slot?: number;
  opacity?: number;
}
export interface Marker {
  x: number;
  y: number;
  slot?: number;
  label?: string;
}

interface Props {
  series: Series[];
  /** Drawn beneath the series; gaps (non-finite values) split a band. */
  bands?: Band[];
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

const NO_BANDS: Band[] = [];
const M = { top: 12, right: 16, bottom: 40, left: 62 };
export const seriesColor = (slot: number) => `var(--series-${((slot - 1) % 8) + 1})`;

export function Plot(props: Props) {
  const {
    series, bands = NO_BANDS, xLabel, yLabel, logX = false, logY = false, height = 260, equal, markers = [], cursorX,
    hover = true, xDomain, yDomain, empty = 'Nothing to plot yet', exportName,
  } = props;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hoverX, setHoverX] = useState<number | null>(null);
  const iw = Math.max(40, width - M.left - M.right);
  const ih = Math.max(40, height - M.top - M.bottom);

  const { sx, sy } = useMemo(() => {
    let xe = xDomain ?? padExtent(robustExtent([...series.map((s) => s.x), ...bands.map((b) => b.x)], logX), logX, 0);
    let ye = yDomain ?? padExtent(robustExtent([...series.map((s) => s.y), ...bands.flatMap((b) => [b.lo, b.hi])], logY), logY);
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
  }, [series, bands, logX, logY, equal, iw, ih, xDomain, yDomain]);

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

  const bandPaths = useMemo(
    () =>
      bands.map((b) => {
        let d = '';
        let run: [number, number, number][] = [];
        const close = () => {
          if (run.length > 1) d += `M${run.map(([X, , H]) => `${X.toFixed(1)},${H.toFixed(1)}`).join('L')}L${run.reverse().map(([X, L]) => `${X.toFixed(1)},${L.toFixed(1)}`).join('L')}Z`;
          run = [];
        };
        for (let i = 0; i < b.x.length; i++) {
          const X = px(b.x[i]), L = py(b.lo[i]), H = py(b.hi[i]);
          if (Number.isFinite(X) && Number.isFinite(L) && Number.isFinite(H)) run.push([X, L, H]);
          else close();
        }
        close();
        return d;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bands, sx, sy, iw, ih],
  );

  const hasData = series.some((s) => s.y.some(Number.isFinite)) || bands.some((b) => b.hi.some(Number.isFinite));

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

  const figure = async (settings: FigureSettings): Promise<Figure | null> => {
    const host = ref.current;
    if (!host) return null;
    const sample = document.createElement('span');
    host.appendChild(sample);
    const legend = series.map((s, i) => {
      // Resolve the palette variable to the colour actually in use.
      sample.style.color = seriesColor(s.slot ?? i + 1);
      return { name: s.name, color: getComputedStyle(sample).color, dashed: s.dashed, points: s.points };
    });
    sample.remove();
    const lw = layoutWidth(width, settings);
    const live = host.querySelector('svg');
    // The legend is added above the chart, so the chart itself gets what is left of the figure's height.
    const top = legendHeight(legend.length);
    const lh = Math.max(80, layoutHeight(width, height + top, settings) - top);
    if (lw === width && lh === height) return live ? { ...standaloneSvg(live, { legend }), shownPx: width } : null;
    // A different size or text size means a different layout: draw the chart again, out of sight.
    const copy = await offscreen(<Plot {...props} height={lh} cursorX={undefined} />, lw);
    try {
      const svg = copy.el.querySelector('svg');
      return svg ? { ...standaloneSvg(svg, { legend }), shownPx: width } : null;
    } finally {
      copy.dispose();
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
      {hasData && <FigureExport name={exportName ?? ([yLabel, xLabel].filter(Boolean).join(' vs ') || 'chart')} build={figure} />}
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
          {bandPaths.map((d, i) => (
            <path key={`band${i}`} d={d} stroke="none" fill={seriesColor(bands[i].slot ?? i + 1)} fillOpacity={bands[i].opacity ?? 0.18} />
          ))}
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
