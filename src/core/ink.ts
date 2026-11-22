/**
 * Handwriting as geometry: pen strokes, which strokes belong to the same
 * written line, and which a rubber touches. No drawing happens here.
 */

export interface Stroke {
  id: number;
  /** Points as x, y, pressure triples, in page coordinates (CSS pixels). */
  pts: number[];
}

export interface Box { x0: number; y0: number; x1: number; y1: number }

export function strokeBox(s: Stroke): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < s.pts.length; i += 3) {
    const x = s.pts[i];
    const y = s.pts[i + 1];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

export const unionBox = (boxes: Box[]): Box => ({
  x0: Math.min(...boxes.map((b) => b.x0)), y0: Math.min(...boxes.map((b) => b.y0)),
  x1: Math.max(...boxes.map((b) => b.x1)), y1: Math.max(...boxes.map((b) => b.y1)),
});

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** The typical height of a written symbol on the page, used as the unit for "near" and "far". */
export function writingSize(strokes: Stroke[]): number {
  const sizes = strokes.map(strokeBox).map((b) => Math.max(b.x1 - b.x0, b.y1 - b.y0)).filter((s) => s > 6);
  return sizes.length ? Math.max(12, median(sizes)) : 30;
}

export interface InkLine {
  /** Ids of the strokes in the line, in the order they were written. */
  ids: number[];
  box: Box;
  /** Stable while the line's strokes are unchanged; a recognition result can be kept against it. */
  key: string;
}

/**
 * Split a page of strokes into written lines.
 *
 * Strokes that overlap vertically, or nearly do, belong to one line — which
 * keeps a fraction's numerator, bar and denominator together — and a clear
 * vertical gap starts a new line. Within a band, a wide horizontal gap splits
 * expressions written side by side.
 */
export function groupLines(strokes: Stroke[]): InkLine[] {
  if (!strokes.length) return [];
  const size = writingSize(strokes);
  const vGap = 0.3 * size;
  const hGap = 3 * size;
  const items = strokes.map((s) => ({ s, b: strokeBox(s) })).sort((a, b) => a.b.y0 - b.b.y0);

  const bands: (typeof items)[] = [];
  let bottom = -Infinity;
  for (const it of items) {
    if (!bands.length || it.b.y0 > bottom + vGap) { bands.push([it]); bottom = it.b.y1; }
    else { bands[bands.length - 1].push(it); bottom = Math.max(bottom, it.b.y1); }
  }

  const lines: InkLine[] = [];
  for (const band of bands) {
    band.sort((a, b) => a.b.x0 - b.b.x0);
    let run = [band[0]];
    let right = band[0].b.x1;
    const flush = () => {
      const ids = run.map((r) => r.s.id).sort((a, b) => a - b);
      // Moving or redrawing any stroke changes the key, so stale results are never shown against new ink.
      const sum = run.reduce((h, r) => (h * 31 + r.s.pts.length * 7 + Math.round(r.s.pts[0] + r.s.pts[1])) | 0, 17);
      lines.push({ ids, box: unionBox(run.map((r) => r.b)), key: `${ids.join('.')}:${sum}` });
    };
    for (const it of band.slice(1)) {
      if (it.b.x0 > right + hGap) { flush(); run = [it]; right = it.b.x1; }
      else { run.push(it); right = Math.max(right, it.b.x1); }
    }
    flush();
  }
  return lines.sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
}

/** Distance from a point to a line segment. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Ids of the strokes that pass within `radius` of a point — what a rubber held there removes. */
export function strokesNear(strokes: Stroke[], x: number, y: number, radius: number): number[] {
  const hit: number[] = [];
  for (const s of strokes) {
    const p = s.pts;
    if (p.length === 3) { if (Math.hypot(p[0] - x, p[1] - y) <= radius) hit.push(s.id); continue; }
    for (let i = 3; i < p.length; i += 3) {
      if (segDist(x, y, p[i - 3], p[i - 2], p[i], p[i + 1]) <= radius) { hit.push(s.id); break; }
    }
  }
  return hit;
}

/** Drop points closer together than `step`, keeping the ends: lighter to store and smoother to draw. */
export function thin(pts: number[], step = 0.7): number[] {
  if (pts.length <= 6) return pts.slice();
  const out = [pts[0], pts[1], pts[2]];
  for (let i = 3; i < pts.length - 3; i += 3) {
    if (Math.hypot(pts[i] - out[out.length - 3], pts[i + 1] - out[out.length - 2]) >= step) out.push(pts[i], pts[i + 1], pts[i + 2]);
  }
  out.push(pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1]);
  return out;
}

/**
 * Where a line's strokes go in a picture of the given size: scaled to fit
 * inside the margin, centred, never enlarged beyond `maxScale`.
 */
export function fitBox(box: Box, width: number, height: number, margin: number, maxScale = 4): { scale: number; dx: number; dy: number } {
  const w = Math.max(1, box.x1 - box.x0);
  const h = Math.max(1, box.y1 - box.y0);
  const scale = Math.min((width - 2 * margin) / w, (height - 2 * margin) / h, maxScale);
  return { scale, dx: (width - w * scale) / 2 - box.x0 * scale, dy: (height - h * scale) / 2 - box.y0 * scale };
}
