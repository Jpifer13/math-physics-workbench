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

  describe('a real page (measured from handwriting on an iPad)', () => {
    /** A stroke filling the given box, as a scribble through its corners. */
    const ink = (x0: number, x1: number, y0: number, y1: number): Stroke => ({ id: next++, pts: [x0, y0, 0.5, x1, y1, 0.5, x0, y1, 0.5, x1, y0, 0.5] });
    const flat = (x0: number, x1: number, y: number): Stroke => ({ id: next++, pts: [x0, y, 0.5, (x0 + x1) / 2, y + 1, 0.5, x1, y, 0.5] });
    const page = () => {
      const xEq4 = [ink(97, 120, 150, 181), flat(127, 153, 155), flat(127, 153, 168), ink(168, 190, 142, 182)];
      // Written directly underneath, 8 pixels below: a separate line, not part of the first.
      const yEq7 = [ink(92, 115, 205, 249), flat(124, 148, 204), flat(124, 148, 213), ink(159, 186, 190, 225)];
      const sum = [ink(108, 137, 279, 319), ink(165, 179, 278, 306), ink(196, 216, 290, 341), flat(231, 252, 286), flat(231, 252, 304)];
      // A sum with "x → ∞" written above it and an exponent on the term.
      const sigma = [ink(85, 100, 378, 395), flat(108, 128, 386), ink(135, 155, 380, 394), ink(82, 118, 400, 448), ink(168, 190, 415, 450), ink(188, 202, 401, 420)];
      // In the right-hand column, a fraction tall enough to stand beside both of the first two lines.
      const fraction = [ink(475, 516, 141, 176), flat(473, 519, 180), ink(478, 495, 186, 217), ink(497, 513, 186, 217)];
      const root = [ink(462, 554, 264, 305), ink(501, 511, 279, 306), ink(513, 524, 279, 306)];
      const theta = [ink(389, 427, 585, 616), flat(444, 468, 597), flat(444, 468, 608), ink(485, 509, 585, 617)];
      // An integral started four pixels below the line above, its exponent level with that gap.
      const integral = [ink(372, 396, 623, 671), ink(409, 430, 637, 664), ink(428, 440, 621, 638)];
      return { xEq4, yEq7, sum, sigma, fraction, root, theta, integral };
    };
    const idsOf = (group: Stroke[]) => group.map((s) => s.id).sort((a, b) => a - b);

    it('finds each expression as one line and no two as one', () => {
      const p = page();
      const lines = groupLines(Object.values(p).flat());
      const found = lines.map((l) => l.ids.join(','));
      for (const [name, group] of Object.entries(p)) expect(found, name).toContain(idsOf(group).join(','));
      expect(lines).toHaveLength(8);
    });

    it('does not depend on the order the strokes were written in', () => {
      const all = Object.values(page()).flat();
      const forwards = groupLines(all).map((l) => l.key);
      expect(groupLines([...all].reverse()).map((l) => l.key)).toEqual(forwards);
    });

    it('leaves lines already on the page alone when more is written beside them', () => {
      // This is what went wrong: writing the fraction on the right merged "x = 4" and "y = 7" on the left,
      // and their readings, and the values of x and y, were lost.
      const p = page();
      const before = groupLines([...p.xEq4, ...p.yEq7, ...p.sum]);
      const after = groupLines(Object.values(p).flat());
      for (const line of before) expect(after.map((l) => l.key)).toContain(line.key);
    });

    it('still keeps two full lines apart when they nearly touch', () => {
      const first = [ink(20, 45, 100, 140), ink(55, 80, 100, 140), ink(90, 115, 100, 140)];
      const second = [ink(20, 45, 142, 182), ink(55, 80, 142, 182), ink(90, 115, 142, 182)];
      expect(groupLines([...first, ...second])).toHaveLength(2);
    });

    it('joins what is small and tucked in: an exponent, a dot, limits above and below', () => {
      const base = ink(100, 130, 100, 140);
      expect(groupLines([base, ink(132, 144, 84, 102)])).toHaveLength(1); // exponent, just above the base's top
      const stem = ink(200, 206, 110, 140);
      expect(groupLines([stem, ink(201, 205, 98, 102)])).toHaveLength(1); // the dot of an i
      const sigmaSign = ink(300, 340, 100, 150);
      const term = ink(355, 380, 110, 145);
      expect(groupLines([sigmaSign, term, ink(305, 335, 82, 96), ink(305, 335, 154, 168)])).toHaveLength(1);
    });

    it('keeps the limits written above and below an integral sign with it', () => {
      // Measured from the page: ∞ above the sign with an ordinary gap, 0 below, then x² dx.
      const upper = ink(144, 172, 241, 262);
      const integral = [ink(148, 165, 275, 313), ink(150, 164, 324, 348), ink(196, 213, 286, 313), ink(217, 230, 275, 289), ink(237, 255, 282, 312), ink(255, 272, 293, 313)];
      const lines = groupLines([upper, ...integral]);
      expect(lines).toHaveLength(1);
      expect(lines[0].ids).toHaveLength(7);
    });

    it('does not swallow a short line written under a long one', () => {
      const long = [ink(100, 125, 100, 130), ink(135, 160, 100, 130), ink(170, 195, 100, 130), ink(205, 230, 100, 130), ink(240, 265, 100, 130)];
      const short = [ink(100, 125, 146, 176)];
      expect(groupLines([...long, ...short])).toHaveLength(2);
    });

    it('does not take a minus sign for a fraction bar', () => {
      // "a − b" on one row, with other lines above and below it at ordinary spacing.
      const above = [ink(100, 130, 40, 80), ink(140, 170, 40, 80)];
      const row = [ink(100, 130, 110, 150), flat(140, 170, 130), ink(180, 210, 110, 150)];
      const below = [ink(100, 130, 180, 220), ink(140, 170, 180, 220)];
      expect(groupLines([...above, ...row, ...below])).toHaveLength(3);
    });
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
