import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { strokesNear, thin, type Stroke } from '../core/ink';
import { INK, PEN_WIDTH, drawStroke } from '../recognize/raster';
import { useScratch } from './store';

export type Tool = 'pen' | 'rubber';

const RULE = 44;
const RUBBER = 9;
/** For this long after the pen was last seen, a touch is taken to be the writing hand's palm (milliseconds). */
const PALM_MS = 1200;

interface Props {
  strokes: Stroke[];
  tool: Tool;
  /** Whether a finger writes. When it does not, a finger scrolls the page. */
  fingerDraws: boolean;
  scrollY: number;
  onScroll: (y: number) => void;
  /** A pen has touched the page — from then on fingers can be left to scroll. */
  onPen: () => void;
  /** Positioned over the page, in page coordinates. */
  children?: ReactNode;
}

interface Active {
  pointer: number;
  pts: number[];
  rubber: boolean;
  touch: boolean;
  drawn: number;
}

/**
 * The page: a sheet that takes pen strokes. A pen or mouse always writes; a
 * finger writes or scrolls according to `fingerDraws`, and two fingers always
 * scroll. The sheet is as tall as it needs to be — only the part in view is drawn.
 */
export function InkCanvas({ strokes, tool, fingerDraws, scrollY, onScroll, onPen, children }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const live = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const active = useRef<Active | null>(null);
  const fingers = useRef(new Map<number, number>());
  const panning = useRef(false);
  // Handlers read these through refs so they always see the latest values.
  const scroll = useRef(scrollY);
  scroll.current = scrollY;
  const page = useRef(strokes);
  page.current = strokes;

  useLayoutEffect(() => {
    const el = wrap.current!;
    const update = () => setSize({ w: Math.max(120, Math.floor(el.clientWidth)), h: Math.max(120, Math.floor(el.clientHeight)) });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dpr = typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1;

  // Size both layers to the device's pixels.
  useLayoutEffect(() => {
    for (const c of [base.current!, live.current!]) {
      c.width = Math.round(size.w * dpr);
      c.height = Math.round(size.h * dpr);
    }
  }, [size, dpr]);

  // The settled ink, redrawn when it changes or the page moves.
  useLayoutEffect(() => {
    const ctx = base.current!.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.strokeStyle = getComputedStyle(wrap.current!).getPropertyValue('--grid').trim() || '#e9e7e5';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = RULE - (scrollY % RULE); y < size.h; y += RULE) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(size.w, Math.round(y) + 0.5);
    }
    ctx.stroke();
    ctx.translate(0, -scrollY);
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    for (const s of strokes) {
      // Skip what is out of view.
      let top = Infinity, bottom = -Infinity;
      for (let i = 1; i < s.pts.length; i += 3) { if (s.pts[i] < top) top = s.pts[i]; if (s.pts[i] > bottom) bottom = s.pts[i]; }
      if (bottom < scrollY - 10 || top > scrollY + size.h + 10) continue;
      drawStroke(ctx, s.pts, PEN_WIDTH);
    }
  }, [strokes, scrollY, size, dpr]);

  const liveCtx = () => {
    const ctx = live.current!.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, -scroll.current * dpr);
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    return ctx;
  };
  const clearLive = () => {
    const ctx = live.current!.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, live.current!.width, live.current!.height);
  };

  const at = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top + scroll.current };
  };
  const rub = (x: number, y: number) => useScratch.getState().erase(strokesNear(page.current, x, y, RUBBER));
  const fingerMid = () => { let s = 0; fingers.current.forEach((y) => { s += y; }); return s / Math.max(1, fingers.current.size); };

  // When the pen was last on or near the page. A hand resting beside it is a palm, not a finger gesture.
  const penAt = useRef(-Infinity);
  const penNear = () => performance.now() - penAt.current < PALM_MS;

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'pen') {
      penAt.current = performance.now();
      onPen();
      // The palm usually lands before the nib. Whatever a touch had begun gives way to the pen;
      // without this the palm's "stroke" held the page and the pen was ignored altogether.
      if (active.current?.touch) { active.current = null; clearLive(); }
      panning.current = false;
    }
    if (e.pointerType === 'touch') {
      // A touch while the pen is writing or hovering is the writing hand. It neither draws nor scrolls.
      if (penNear()) return;
      fingers.current.set(e.pointerId, e.clientY);
      const penBusy = active.current && !active.current.touch;
      if (!fingerDraws || fingers.current.size >= 2 || penBusy) {
        // A second finger turns a finger stroke into a scroll; a resting palm while the pen writes is ignored.
        if (active.current?.touch) { active.current = null; clearLive(); }
        panning.current = !penBusy;
        return;
      }
    }
    if (active.current) return;
    const { x, y } = at(e);
    // The far end of a stylus, or its barrel button, rubs out.
    const rubber = tool === 'rubber' || e.button === 5 || (e.buttons & 32) !== 0;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable; moves still arrive while over the page */ }
    active.current = { pointer: e.pointerId, pts: [x, y, e.pressure], rubber, touch: e.pointerType === 'touch', drawn: 0 };
    if (rubber) { useScratch.getState().beginErase(); rub(x, y); }
  };

  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    // A pen that hovers reports moves before it touches: enough to know a pen is in use.
    if (e.pointerType === 'pen') { penAt.current = performance.now(); if (!active.current) onPen(); }
    if (e.pointerType === 'touch' && panning.current && fingers.current.has(e.pointerId)) {
      const before = fingerMid();
      fingers.current.set(e.pointerId, e.clientY);
      onScroll(scroll.current - (fingerMid() - before));
      return;
    }
    const a = active.current;
    if (!a || a.pointer !== e.pointerId) return;
    // The browser batches fast pen movement; the batch holds every sample.
    const native = e.nativeEvent;
    const batch = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    for (const ev of batch.length ? batch : [native]) {
      const { x, y } = at(ev);
      if (a.rubber) { rub(x, y); continue; }
      const n = a.pts.length;
      if (x === a.pts[n - 3] && y === a.pts[n - 2]) continue;
      a.pts.push(x, y, ev.pressure);
    }
    if (a.rubber) return;
    const count = a.pts.length / 3;
    // Redraw from one point back so the join with what is already on screen stays smooth.
    drawStroke(liveCtx(), a.pts, PEN_WIDTH, Math.max(1, a.drawn - 1));
    a.drawn = count - 1;
  };

  const up = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (e.pointerType === 'touch') {
      fingers.current.delete(e.pointerId);
      if (!fingers.current.size) panning.current = false;
    }
    if (e.pointerType === 'pen') penAt.current = performance.now();
    const a = active.current;
    if (!a || a.pointer !== e.pointerId) return;
    active.current = null;
    clearLive();
    // A cancelled finger stroke was the start of a gesture, not writing. A pen stroke is always kept.
    if (a.rubber || (cancelled && a.touch)) return;
    const pts = thin(a.pts).map((v, i) => (i % 3 === 2 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10));
    useScratch.getState().addStroke(pts);
  };

  // Stop the browser's own reactions to touching the page: scrolling, zooming, the selection loupe.
  useEffect(() => {
    const el = wrap.current!;
    const stop = (ev: Event) => ev.preventDefault();
    const opts = { passive: false } as const;
    for (const name of ['touchstart', 'touchmove', 'gesturestart', 'contextmenu', 'selectstart']) el.addEventListener(name, stop, opts);
    const wheel = (ev: WheelEvent) => { ev.preventDefault(); onScrollRef.current(scroll.current + ev.deltaY); };
    el.addEventListener('wheel', wheel, opts);
    return () => {
      for (const name of ['touchstart', 'touchmove', 'gesturestart', 'contextmenu', 'selectstart']) el.removeEventListener(name, stop);
      el.removeEventListener('wheel', wheel);
    };
  }, []);
  const onScrollRef = useRef(onScroll);
  onScrollRef.current = onScroll;

  return (
    <div
      ref={wrap}
      className={`ink-page ${tool === 'rubber' ? 'rubbing' : ''}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={(e) => up(e, false)}
      onPointerCancel={(e) => up(e, true)}
    >
      <canvas ref={base} style={{ width: size.w, height: size.h }} />
      <canvas ref={live} style={{ width: size.w, height: size.h }} />
      <div className="ink-over" style={{ transform: `translateY(${-scrollY}px)` }}>{children}</div>
    </div>
  );
}
