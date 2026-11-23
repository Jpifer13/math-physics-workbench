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

const width = (b: Box) => b.x1 - b.x0;
const height = (b: Box) => b.y1 - b.y0;
/** How far apart two ranges are; negative by the amount they overlap. */
const gap = (a0: number, a1: number, b0: number, b1: number) => Math.max(a0, b0) - Math.min(a1, b1);

/**
 * Split a page of strokes into written lines.
 *
 * Strokes on the same row join into a line: they share part of their height
 * and are not far apart sideways. Rows are then joined only where the writing
 * shows they are one expression: a fraction bar with ink above and below it,
 * or something small tucked against a line (an exponent, the limits of a sum,
 * the dot of an i). Two full lines written close together stay two lines,
 * however small the gap, and what is written elsewhere on the page has no say:
 * a tall fraction in the right-hand column does not weld together the lines
 * beside it on the left.
 */
export function groupLines(strokes: Stroke[]): InkLine[] {
  if (!strokes.length) return [];
  const size = writingSize(strokes);
  const hGap = 3 * size;
  const boxes = strokes.map(strokeBox);
  const n = strokes.length;

  // Union-find over strokes.
  const parent = strokes.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  const groups = () => {
    const by = new Map<number, number[]>();
    for (let i = 0; i < n; i++) { const r = find(i); const g = by.get(r); if (g) g.push(i); else by.set(r, [i]); }
    return [...by.values()].map((members) => ({ members, box: unionBox(members.map((i) => boxes[i])) }));
  };

  // 1. Rows. A flat stroke (a minus, a bar of "=") is given a little height so that it can share a row.
  const tall = (b: Box): [number, number] => {
    const pad = Math.max(0, (0.25 * size - height(b)) / 2);
    return [b.y0 - pad, b.y1 + pad];
  };
  for (let i = 0; i < n; i++) {
    const [i0, i1] = tall(boxes[i]);
    for (let j = i + 1; j < n; j++) {
      if (gap(boxes[i].x0, boxes[i].x1, boxes[j].x0, boxes[j].x1) > hGap) continue;
      const [j0, j1] = tall(boxes[j]);
      const shared = -gap(i0, i1, j0, j1);
      // Sharing a sliver of height is not sharing a row: an exponent's foot often dips to the top of its base.
      if (shared >= 0.3 * Math.min(i1 - i0, j1 - j0)) join(i, j);
    }
  }

  // 2. Fractions. A wide, flat stroke with ink directly above and directly below it is a fraction bar.
  const near = 0.6 * size;
  for (let i = 0; i < n; i++) {
    const bar = boxes[i];
    if (width(bar) < 0.8 * size || height(bar) > 0.35 * width(bar)) continue;
    const over = (b: Box) => -gap(bar.x0, bar.x1, b.x0, b.x1) >= 0.5 * Math.min(width(b), width(bar));
    const above: number[] = [], below: number[] = [];
    for (let j = 0; j < n; j++) {
      if (j === i || !over(boxes[j])) continue;
      const midY = (boxes[j].y0 + boxes[j].y1) / 2;
      const barY = (bar.y0 + bar.y1) / 2;
      if (midY < barY && bar.y0 - boxes[j].y1 <= near && boxes[j].y1 <= bar.y1) above.push(j);
      else if (midY > barY && boxes[j].y0 - bar.y1 <= near && boxes[j].y0 >= bar.y0) below.push(j);
    }
    if (above.length && below.length) for (const j of [...above, ...below]) join(i, j);
  }

  // 3. Attachments. Something much smaller than a line and right against it belongs to that line.
  for (let changed = true; changed;) {
    changed = false;
    const gs = groups();
    for (const small of gs) {
      let best: (typeof gs)[number] | null = null;
      let bestGap = Infinity;
      for (const big of gs) {
        if (big === small) continue;
        if (width(small.box) * Math.max(height(small.box), 1) > 0.45 * width(big.box) * Math.max(height(big.box), 1)) continue;
        const dx = gap(small.box.x0, small.box.x1, big.box.x0, big.box.x1);
        const dy = gap(small.box.y0, small.box.y1, big.box.y0, big.box.y1);
        if (dx > 0.5 * size || dy > 0.5 * size) continue;
        const d = Math.max(dx, 0) + Math.max(dy, 0);
        if (d < bestGap) { bestGap = d; best = big; }
      }
      if (best) { join(small.members[0], best.members[0]); changed = true; break; }
    }
  }

  const lines = groups().map((g): InkLine => {
    const run = g.members.map((i) => strokes[i]);
    const ids = run.map((s) => s.id).sort((a, b) => a - b);
    // Moving or redrawing any stroke changes the key, so stale results are never shown against new ink.
    const sum = [...run].sort((a, b) => a.id - b.id).reduce((h, s) => (h * 31 + s.pts.length * 7 + Math.round(s.pts[0] + s.pts[1])) | 0, 17);
    return { ids, box: g.box, key: `${ids.join('.')}:${sum}` };
  });
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
