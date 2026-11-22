import { FigureExport, offscreen, standaloneSvg, type Figure } from './figure';
import { layoutWidth, type FigureSettings } from './figureSize';
import { seriesColor } from './Plot';
import { useWidth } from './useSize';

export interface BarValue {
  value: number;
  /** Interval drawn as a whisker. */
  lo?: number;
  hi?: number;
}
export interface BarRow {
  label: string;
  /** One bar per entry of `series`. */
  values: BarValue[];
}

const ROW = 15;
const GAP = 12;
const M = { top: 6, right: 44, bottom: 26, left: 120 };

/** Horizontal grouped bars of shares between 0 and 1, labelled as percentages. */
export function Bars(props: { rows: BarRow[]; series: string[]; label: string }) {
  const { rows, series, label } = props;
  const [ref, width] = useWidth<HTMLDivElement>();
  const group = series.length * ROW;
  const ih = rows.length * (group + GAP);
  const height = M.top + ih + M.bottom;
  const iw = Math.max(40, width - M.left - M.right);
  // Estimates can stray a little outside 0…1; keep the axis honest but bounded.
  const top = Math.max(1, ...rows.flatMap((r) => r.values.map((v) => Math.min(1.5, v.hi ?? v.value))));
  const px = (v: number) => M.left + (Math.min(top, Math.max(0, v)) / top) * iw;
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  const figure = async (settings: FigureSettings): Promise<Figure | null> => {
    const host = ref.current;
    if (!host) return null;
    const legend = [...host.querySelectorAll<HTMLElement>('.plot-legend .swatch')].map((el, k) => ({ name: series[k], color: getComputedStyle(el).color }));
    const lw = layoutWidth(width, settings);
    const live = host.querySelector('svg');
    if (lw === width) return live ? { ...standaloneSvg(live, { legend }), shownPx: width } : null;
    const copy = await offscreen(<Bars {...props} />, lw);
    try {
      const svg = copy.el.querySelector('svg');
      return svg ? { ...standaloneSvg(svg, { legend }), shownPx: width } : null;
    } finally {
      copy.dispose();
    }
  };

  return (
    <div className="plot-wrap viz-root" ref={ref}>
      <div className="plot-legend">
        {series.map((name, k) => (
          <span key={name}><span className="swatch bar" style={{ color: seriesColor(k + 1) }} />{name}</span>
        ))}
      </div>
      <div className="plot">
      <FigureExport name={label} build={figure} />
      <svg width={width} height={height} role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="plot-grid" x1={px(t)} x2={px(t)} y1={M.top} y2={M.top + ih} />
            <text className="plot-tick" x={px(t)} y={M.top + ih + 16} textAnchor="middle">{t * 100}%</text>
          </g>
        ))}
        {rows.map((row, i) => {
          const y0 = M.top + i * (group + GAP) + GAP / 2;
          return (
            <g key={row.label}>
              <text className="plot-tick bar-label" x={M.left - 8} y={y0 + group / 2} textAnchor="end" dominantBaseline="middle">{row.label}</text>
              {row.values.map((v, k) => {
                const y = y0 + k * ROW;
                const mid = y + (ROW - 2) / 2;
                const end = Math.max(px(v.value), px(v.hi ?? v.value));
                return (
                  <g key={k}>
                    <rect x={px(0)} y={y} width={Math.max(0, px(v.value) - px(0))} height={ROW - 2} fill={seriesColor(k + 1)} rx={1.5} />
                    {v.lo !== undefined && v.hi !== undefined && (
                      <path className="bar-whisker" d={`M${px(v.lo)},${mid}H${px(v.hi)}M${px(v.lo)},${mid - 3}v6M${px(v.hi)},${mid - 3}v6`} />
                    )}
                    <text className="plot-tick" x={end + 5} y={mid} dominantBaseline="middle">{Math.round(Math.max(0, v.value) * 100)}%</text>
                  </g>
                );
              })}
            </g>
          );
        })}
        <line className="plot-zero" x1={px(0)} x2={px(0)} y1={M.top} y2={M.top + ih} />
      </svg>
      </div>
    </div>
  );
}
