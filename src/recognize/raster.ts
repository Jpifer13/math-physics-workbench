/** Drawing ink: on the page for the writer, and as a small picture for a recogniser. */
import { fitBox, strokeBox, unionBox, type Stroke } from '../core/ink';

export const INK = '#201f1e';
/** Pen width on the page, in CSS pixels, at middling pressure. */
export const PEN_WIDTH = 2.4;

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const pressure = (p: number): number => (p > 0 ? p : 0.5);

/** Draw one stroke. Width follows pressure; segments are joined through their midpoints so curves stay smooth. */
export function drawStroke(ctx: Ctx, pts: number[], width: number, from = 0): void {
  const n = pts.length / 3;
  if (!n) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (n === 1) {
    ctx.beginPath();
    ctx.arc(pts[0], pts[1], (width * (0.5 + pressure(pts[2]))) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (let i = Math.max(1, from); i < n; i++) {
    const x0 = pts[(i - 1) * 3];
    const y0 = pts[(i - 1) * 3 + 1];
    const x1 = pts[i * 3];
    const y1 = pts[i * 3 + 1];
    // From the midpoint of the previous segment to the midpoint of this one, curving through their shared point.
    const sx = i === 1 ? x0 : (pts[(i - 2) * 3] + x0) / 2;
    const sy = i === 1 ? y0 : (pts[(i - 2) * 3 + 1] + y0) / 2;
    const ex = i === n - 1 ? x1 : (x0 + x1) / 2;
    const ey = i === n - 1 ? y1 : (y0 + y1) / 2;
    ctx.lineWidth = width * (0.5 + (pressure(pts[(i - 1) * 3 + 2]) + pressure(pts[i * 3 + 2])) / 2);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    if (i === 1) ctx.lineTo(ex, ey);
    else ctx.quadraticCurveTo(x0, y0, ex, ey);
    ctx.stroke();
  }
}

export const MODEL_SIZE = 384;

function canvasOf(size: number): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: Ctx } {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as Ctx;
  return { canvas, ctx };
}

/**
 * A written line as the on-device model expects to see it: dark ink on white,
 * cropped to the writing, scaled to fit a 384-pixel square and centred on
 * black. Returns one grey value per pixel.
 */
export function rasterForModel(strokes: Stroke[]): Uint8Array {
  const S = MODEL_SIZE;
  const { ctx } = canvasOf(S);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  const ink = unionBox(strokes.map(strokeBox));
  // Room for the pen's own width, and never a sliver: a lone minus sign still gets a readable picture.
  const long = Math.max(ink.x1 - ink.x0, ink.y1 - ink.y0, 8);
  const grow = (lo: number, hi: number) => { const pad = Math.max(PEN_WIDTH, (long * 0.3 - (hi - lo)) / 2); return [lo - pad, hi + pad]; };
  const [x0, x1] = grow(ink.x0, ink.x1);
  const [y0, y1] = grow(ink.y0, ink.y1);
  const { scale, dx, dy } = fitBox({ x0, y0, x1, y1 }, S, S, 0, 64);
  ctx.fillStyle = '#fff';
  ctx.fillRect(Math.floor(x0 * scale + dx), Math.floor(y0 * scale + dy), Math.ceil((x1 - x0) * scale), Math.ceil((y1 - y0) * scale));
  ctx.setTransform(scale, 0, 0, scale, dx, dy);
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#000';
  // Small writing is drawn a little heavier so that a long line shrunk to fit does not fade away.
  const width = Math.max(PEN_WIDTH, 2.2 / scale);
  for (const s of strokes) drawStroke(ctx, s.pts, width);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const rgba = ctx.getImageData(0, 0, S, S).data;
  const grey = new Uint8Array(S * S);
  for (let i = 0; i < grey.length; i++) grey[i] = rgba[i * 4];
  return grey;
}

/** A written line as an ordinary picture — dark ink on white with a margin — for a recognition service. */
export async function rasterAsPng(strokes: Stroke[]): Promise<Blob> {
  const box = unionBox(strokes.map(strokeBox));
  const margin = 24;
  const scale = Math.min(3, 1600 / Math.max(1, box.x1 - box.x0));
  const w = Math.ceil((box.x1 - box.x0) * scale + 2 * margin);
  const h = Math.ceil((box.y1 - box.y0) * scale + 2 * margin);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(scale, 0, 0, scale, margin - box.x0 * scale, margin - box.y0 * scale);
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  for (const s of strokes) drawStroke(ctx, s.pts, PEN_WIDTH);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/png'));
}
