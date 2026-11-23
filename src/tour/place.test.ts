import { describe, expect, it } from 'vitest';
import { placeCard, spotlight, type Box } from './place';
import { STEPS } from './steps';
import { TABS } from '../nav';

const view = { width: 1440, height: 900 };
const card = { width: 340, height: 200 };
const overlaps = (a: Box, b: Box) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
const onScreen = (p: { left: number; top: number }) => p.left >= 0 && p.top >= 0 && p.left + card.width <= view.width && p.top + card.height <= view.height;

describe('placing the walkthrough card', () => {
  it('centres it when there is nothing to point at', () => {
    expect(placeCard(null, card, view)).toEqual({ left: 550, top: 350, side: 'centre' });
  });

  it('goes beside a panel on the left edge, level with its top', () => {
    const panel = { left: 0, top: 44, width: 396, height: 856 };
    const p = placeCard(panel, card, view);
    expect(p.side).toBe('right');
    expect(p.left).toBeGreaterThan(panel.left + panel.width);
    expect(p.top).toBe(44);
  });

  it('goes to the left of something on the right edge', () => {
    const p = placeCard({ left: 1150, top: 60, width: 280, height: 700 }, card, view);
    expect(p.side).toBe('left');
    expect(p.left + card.width).toBeLessThan(1150);
  });

  it('goes below a bar across the top, and above one across the bottom', () => {
    expect(placeCard({ left: 0, top: 0, width: 1440, height: 44 }, card, view).side).toBe('below');
    expect(placeCard({ left: 0, top: 850, width: 1440, height: 50 }, card, view).side).toBe('above');
  });

  it('never covers the target when it fits beside it, and always stays on screen', () => {
    const targets: Box[] = [
      { left: 0, top: 44, width: 396, height: 856 }, { left: 412, top: 50, width: 1000, height: 34 }, { left: 188, top: 0, width: 520, height: 44 },
      { left: 600, top: 300, width: 200, height: 120 }, { left: 1300, top: 800, width: 120, height: 80 }, { left: 5, top: 5, width: 30, height: 30 },
    ];
    for (const t of targets) {
      const p = placeCard(t, card, view);
      expect(onScreen(p), JSON.stringify(t)).toBe(true);
      expect(p.side).not.toBe('inside');
      expect(overlaps({ ...p, ...card }, t), JSON.stringify(t)).toBe(false);
    }
  });

  it('sits inside the corner of a target that fills the window', () => {
    const p = placeCard({ left: 0, top: 44, width: 1440, height: 856 }, card, view);
    expect(p.side).toBe('inside');
    expect(onScreen(p)).toBe(true);
    expect(p.left).toBeGreaterThan(900);
    expect(p.top).toBeGreaterThan(500);
  });

  it('stays on a small screen even when the card barely fits', () => {
    const small = { width: 360, height: 240 };
    const p = placeCard({ left: 20, top: 20, width: 300, height: 180 }, card, small);
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.top).toBeGreaterThanOrEqual(0);
  });

  it('pads the highlight and keeps it within the window', () => {
    expect(spotlight({ left: 100, top: 100, width: 50, height: 20 }, view)).toEqual({ left: 94, top: 94, width: 62, height: 32 });
    expect(spotlight({ left: 0, top: 0, width: 1440, height: 44 }, view)).toEqual({ left: 0, top: 0, width: 1440, height: 50 });
  });
});

describe('the walkthrough itself', () => {
  it('opens and closes with a step that points at nothing', () => {
    expect(STEPS[0].target).toBeUndefined();
    expect(STEPS[STEPS.length - 1].target).toBeUndefined();
  });

  it('visits every workspace, and every view of Simulations', () => {
    const tabs = new Set(STEPS.map((s) => s.tab).filter(Boolean));
    for (const t of TABS) expect(tabs.has(t.id), t.name).toBe(true);
    const views = new Set(STEPS.map((s) => s.view).filter(Boolean));
    expect([...views].sort()).toEqual(['experiment', 'fit', 'run', 'tools', 'uncertainty']);
  });

  it('keeps every step short enough to read at a glance, with a title', () => {
    for (const s of STEPS) {
      expect(s.title.length, s.title).toBeGreaterThan(3);
      expect(s.title.length, s.title).toBeLessThan(50);
      expect(s.body.length, s.title).toBeGreaterThan(40);
      expect(s.body.length, s.title).toBeLessThan(420);
    }
    expect(new Set(STEPS.map((s) => s.title)).size).toBe(STEPS.length);
  });

  it('ends back where a new user should start', () => {
    const last = STEPS[STEPS.length - 1];
    expect(last.tab).toBe('sim');
    expect(last.view).toBe('run');
  });
});
