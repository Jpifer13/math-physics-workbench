/**
 * Where the walkthrough's card goes: beside the thing it is describing,
 * wherever there is room, and never off the screen or over the thing itself
 * if that can be helped.
 */

export interface Box { left: number; top: number; width: number; height: number }
export interface Size { width: number; height: number }
export type Side = 'right' | 'left' | 'below' | 'above' | 'inside' | 'centre';

const GAP = 14;
const MARGIN = 10;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(Math.max(lo, hi), v));

/** The highlighted area: the target with a little breathing room, kept on screen. */
export function spotlight(target: Box, view: Size, pad = 6): Box {
  const left = Math.max(0, target.left - pad);
  const top = Math.max(0, target.top - pad);
  const right = Math.min(view.width, target.left + target.width + pad);
  const bottom = Math.min(view.height, target.top + target.height + pad);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * Position a card of the given size for a target (or for nothing: centred).
 * Tries the side with the most room first; if the card fits nowhere beside the
 * target, it goes inside the target's lower right corner, which for a large
 * panel hides the least.
 */
export function placeCard(target: Box | null, card: Size, view: Size): { left: number; top: number; side: Side } {
  const maxLeft = view.width - card.width - MARGIN;
  const maxTop = view.height - card.height - MARGIN;
  if (!target) return { left: clamp((view.width - card.width) / 2, MARGIN, maxLeft), top: clamp((view.height - card.height) / 2, MARGIN, maxTop), side: 'centre' };

  const room = {
    right: view.width - (target.left + target.width) - GAP - MARGIN,
    left: target.left - GAP - MARGIN,
    below: view.height - (target.top + target.height) - GAP - MARGIN,
    above: target.top - GAP - MARGIN,
  };
  const fits: Record<Exclude<Side, 'inside' | 'centre'>, boolean> = {
    right: room.right >= card.width, left: room.left >= card.width, below: room.below >= card.height, above: room.above >= card.height,
  };
  // Beside is easier to read across to than above or below; among those that fit, take the roomiest.
  const order = (['right', 'left', 'below', 'above'] as const).filter((s) => fits[s])
    .sort((a, b) => (room[b] - (b === 'right' || b === 'left' ? card.width : card.height)) - (room[a] - (a === 'right' || a === 'left' ? card.width : card.height)));
  const side = order[0];
  const alongY = clamp(target.top, MARGIN, maxTop);
  const alongX = clamp(target.left + (target.width - card.width) / 2, MARGIN, maxLeft);
  if (side === 'right') return { left: target.left + target.width + GAP, top: alongY, side };
  if (side === 'left') return { left: target.left - GAP - card.width, top: alongY, side };
  if (side === 'below') return { left: alongX, top: target.top + target.height + GAP, side };
  if (side === 'above') return { left: alongX, top: target.top - GAP - card.height, side };
  return {
    left: clamp(target.left + target.width - card.width - GAP, MARGIN, maxLeft),
    top: clamp(target.top + target.height - card.height - GAP, MARGIN, maxTop),
    side: 'inside',
  };
}
