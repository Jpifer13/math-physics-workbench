import { describe, expect, it } from 'vitest';
import { fitBox, groupLines, strokeBox, strokesNear, thin, type Stroke } from './ink';

let next = 1;
/** A straight stroke between two points. */
const seg = (x0: number, y0: number, x1: number, y1: number): Stroke => ({ id: next++, pts: [x0, y0, 0.5, (x0 + x1) / 2, (y0 + y1) / 2, 0.5, x1, y1, 0.5] });
/** A symbol-sized scribble filling a box. */
const glyph = (x: number, y: number, size = 30): Stroke => ({ id: next++, pts: [x, y, 0.5, x + size, y + size, 0.5, x, y + size, 0.5, x + size, y, 0.5] });

describe('ink geometry', () => {
  it('measures a stroke', () => {
    expect(strokeBox(seg(10, 20, 40, 5))).toEqual({ x0: 10, y0: 5, x1: 40, y1: 20 });
  });

  it('separates lines written one under another', () => {
    const first = [glyph(20, 20), glyph(60, 22), glyph(100, 18)];
    const second = [glyph(20, 90), glyph(60, 92)];
    const lines = groupLines([...second, ...first]);
    expect(lines.map((l) => l.ids)).toEqual([first.map((s) => s.id), second.map((s) => s.id)]);
  });

  it('keeps a fraction and an equals sign together', () => {
    // numerator, bar, denominator, then "=" as two short strokes
    const parts = [glyph(40, 10), seg(30, 48, 80, 48), glyph(40, 56), seg(100, 44, 125, 44), seg(100, 54, 125, 54)];
    expect(groupLines(parts)).toHaveLength(1);
  });

  it('splits expressions written far apart on the same row', () => {
    const lines = groupLines([glyph(20, 20), glyph(60, 20), glyph(400, 20), glyph(440, 20)]);
    expect(lines).toHaveLength(2);
    expect(lines[0].box.x1).toBeLessThan(lines[1].box.x0);
  });

  it('gives a line a new key when its ink changes', () => {
    const a = glyph(20, 20);
    const b = glyph(60, 20);
    const before = groupLines([a, b])[0].key;
    expect(groupLines([a, b])[0].key).toBe(before);
    expect(groupLines([a, { ...b, pts: b.pts.map((v, i) => (i % 3 === 0 ? v + 9 : v)) }])[0].key).not.toBe(before);
    expect(groupLines([a])[0].key).not.toBe(before);
  });

  it('finds the strokes a rubber touches', () => {
    const a = seg(0, 0, 100, 0);
    const b = seg(0, 50, 100, 50);
    expect(strokesNear([a, b], 50, 4, 6)).toEqual([a.id]);
    expect(strokesNear([a, b], 50, 25, 6)).toEqual([]);
    expect(strokesNear([{ id: 99, pts: [5, 5, 1] }], 6, 6, 3)).toEqual([99]);
  });

  it('thins crowded points but keeps the ends', () => {
    const pts: number[] = [];
    for (let i = 0; i <= 100; i++) pts.push(i * 0.1, 0, 0.5);
    const out = thin(pts, 1);
    expect(out.length).toBeLessThan(pts.length / 5);
    expect(out.slice(0, 2)).toEqual([0, 0]);
    expect(out.slice(-3, -1)).toEqual([10, 0]);
  });

  it('fits a line into a picture without enlarging it too far', () => {
    const f = fitBox({ x0: 100, y0: 50, x1: 300, y1: 150 }, 400, 400, 20);
    expect(f.scale).toBeCloseTo(1.8, 6);
    expect(100 * f.scale + f.dx).toBeCloseTo(20, 6);
    expect(fitBox({ x0: 0, y0: 0, x1: 4, y1: 4 }, 400, 400, 20).scale).toBe(4);
  });
});
