import { describe, expect, it } from 'vitest';
import { layoutHeight, layoutWidth, pageSize, parseSize, ptToMm, pxToMm, rasterScale, TICK_PX } from './figureSize';

const asShown = { widthMm: null, heightMm: null, fontPt: null };

describe('figure size', () => {
  it('keeps the on-screen layout when nothing is asked for', () => {
    expect(layoutWidth(640, asShown)).toBe(640);
    expect(layoutWidth(640, { ...asShown, widthMm: 85 })).toBe(640);
    expect(layoutHeight(640, 200, asShown)).toBe(200);
    const page = pageSize(640, 320, 640, asShown);
    expect(page.widthMm).toBeCloseTo(pxToMm(640), 9);
    expect(page.heightMm).toBeCloseTo(page.widthMm / 2, 9);
    // The familiar 3× PNG.
    expect(rasterScale(640, 640, asShown)).toBe(3);
  });

  it('lays the chart out so tick labels come out at the requested size', () => {
    for (const s of [{ ...asShown, widthMm: 85, fontPt: 8 }, { ...asShown, widthMm: 170, fontPt: 8 }, { ...asShown, widthMm: 85, fontPt: 10 }]) {
      const w = layoutWidth(640, s);
      const { widthMm } = pageSize(w, w / 2, 640, s);
      expect(widthMm).toBe(s.widthMm);
      // One layout pixel is widthMm / w on the page, so the tick text is:
      const tickPt = ((TICK_PX * widthMm) / w / ptToMm(1));
      expect(tickPt).toBeCloseTo(s.fontPt, 1);
    }
    // Twice the page width at the same text size needs twice the layout width.
    expect(layoutWidth(640, { ...asShown, widthMm: 170, fontPt: 8 })).toBeCloseTo(2 * layoutWidth(640, { ...asShown, widthMm: 85, fontPt: 8 }), -1);
  });

  it('applies a text size to the on-screen width when no width is given', () => {
    const w = layoutWidth(640, { ...asShown, fontPt: 8 });
    expect(((TICK_PX * pxToMm(640)) / w / ptToMm(1))).toBeCloseTo(8, 1);
  });

  it('rasterises at 300 dpi when a width is set', () => {
    const s = { ...asShown, widthMm: 85, fontPt: 8 };
    const w = layoutWidth(640, s);
    expect(w * rasterScale(w, 640, s)).toBeCloseTo((85 / 25.4) * 300, 6);
    // A 3× image of the on-screen size whatever the layout width, when only the text size is set.
    const t = { ...asShown, fontPt: 8 };
    expect(layoutWidth(640, t) * rasterScale(layoutWidth(640, t), 640, t)).toBeCloseTo(1920, 6);
  });

  it('gives a figure a set height, a standard shape, or its on-screen shape', () => {
    // A chart shown 1000 × 250 is much too flat for a column: with only a width, it takes the standard shape.
    const column = { ...asShown, widthMm: 85, fontPt: 8 };
    const w = layoutWidth(1000, column);
    expect(layoutHeight(1000, 250, column) / w).toBeCloseTo(0.62, 2);
    // A set height is honoured exactly on the page.
    const tall = { ...column, heightMm: 100 };
    const h = layoutHeight(1000, 250, tall);
    expect(pageSize(w, h, 1000, tall).heightMm).toBeCloseTo(100, 0);
    // A height with no width applies to the width on screen.
    const onScreen = { ...asShown, heightMm: 50 };
    expect(pageSize(1000, layoutHeight(1000, 250, onScreen), 1000, onScreen).heightMm).toBeCloseTo(50, 0);
    // Only a text size: the on-screen shape, at the layout that gives that text.
    const text = { ...asShown, fontPt: 8 };
    expect(layoutHeight(1000, 250, text) / layoutWidth(1000, text)).toBeCloseTo(0.25, 2);
  });

  it('keeps layouts within workable limits and reads typed sizes', () => {
    expect(layoutWidth(640, { ...asShown, widthMm: 2000, fontPt: 4 })).toBe(3000);
    expect(layoutWidth(640, { ...asShown, widthMm: 20, fontPt: 40 })).toBe(160);
    expect(parseSize('85', 20, 500)).toBe(85);
    expect(parseSize('', 20, 500)).toBeNull();
    expect(parseSize('abc', 20, 500)).toBeNull();
    expect(parseSize('-3', 20, 500)).toBeNull();
    expect(parseSize('5', 20, 500)).toBe(20);
  });
});
