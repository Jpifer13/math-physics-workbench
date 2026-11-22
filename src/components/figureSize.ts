/**
 * Physical size of an exported figure. A chart is laid out in CSS pixels; the
 * requested width fixes how large one of those pixels is on the page, and the
 * requested text size fixes how many of them the chart must be laid out at.
 */

export interface FigureSettings {
  /** Width on the page in millimetres; null keeps the size shown on screen. */
  widthMm: number | null;
  /** Height on the page in millimetres; null picks one (see `layoutHeight`). */
  heightMm: number | null;
  /** Size of the tick labels in points; null keeps the proportions shown on screen. */
  fontPt: number | null;
}

/** Tick labels are drawn at this size in layout pixels (see `.plot-tick` in styles.css). */
export const TICK_PX = 11;
const MM_PER_INCH = 25.4;
const CSS_DPI = 96;
/** Resolution of raster output when a physical width is set. */
export const PRINT_DPI = 300;

export const pxToMm = (px: number) => (px * MM_PER_INCH) / CSS_DPI;
export const ptToMm = (pt: number) => (pt * MM_PER_INCH) / 72;

/** Width on the page of a chart shown `shownPx` wide. */
export const pageWidthMm = (shownPx: number, s: FigureSettings) => s.widthMm ?? pxToMm(shownPx);

/**
 * The pixel width to lay the chart out at so that, scaled to its page width,
 * the tick labels come out at the requested size. A wide figure with small
 * text needs many layout pixels; a narrow one with large text needs few.
 */
export function layoutWidth(shownPx: number, s: FigureSettings): number {
  if (!s.fontPt) return shownPx;
  const px = (pageWidthMm(shownPx, s) * TICK_PX) / ptToMm(s.fontPt);
  return Math.round(Math.min(3000, Math.max(160, px)));
}

/** Height as a fraction of width when a width is set and no height: close to the golden ratio, the usual shape of a figure. */
export const DEFAULT_ASPECT = 0.62;

/**
 * The pixel height to go with `layoutWidth`. A set height is honoured. With
 * only a width set the figure takes a standard shape, because a chart that
 * fills a wide window is far too flat for a column. With neither, it keeps
 * the shape it has on screen.
 */
export function layoutHeight(shownPx: number, shownHeightPx: number, s: FigureSettings): number {
  const w = layoutWidth(shownPx, s);
  const h = s.heightMm !== null ? (w * s.heightMm) / pageWidthMm(shownPx, s) : s.widthMm !== null ? w * DEFAULT_ASPECT : (shownHeightPx * w) / shownPx;
  return Math.round(Math.min(3000, Math.max(100, h)));
}

/** Page size of a figure whose layout is `width` × `height` pixels and was shown `shownPx` wide. */
export function pageSize(width: number, height: number, shownPx: number, s: FigureSettings): { widthMm: number; heightMm: number } {
  // Without a text size the layout is the on-screen one, so `width` is `shownPx` (plus nothing); with one, the
  // layout was chosen to fill the page width. Either way the layout maps onto the page width.
  const widthMm = pageWidthMm(shownPx, s);
  return { widthMm, heightMm: (widthMm * height) / width };
}

/** Pixels per layout pixel for raster output: 3× on screen proportions, or 300 dpi at a set width. */
export function rasterScale(width: number, shownPx: number, s: FigureSettings): number {
  if (s.widthMm === null) return (3 * shownPx) / width;
  return ((s.widthMm / MM_PER_INCH) * PRINT_DPI) / width;
}

/** Read a typed size: a positive number within sensible limits, or null for "as shown". */
export function parseSize(text: string, min: number, max: number): number | null {
  const v = Number(text);
  return text.trim() !== '' && Number.isFinite(v) && v > 0 ? Math.min(max, Math.max(min, v)) : null;
}
