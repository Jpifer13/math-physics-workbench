/**
 * Exporting a chart as a figure: a standalone SVG, a PNG or a PDF, at the
 * size on the page and the text size the user asks for. Every chart type
 * builds its own figure; the buttons, the size settings and the file formats
 * are shared here.
 */
import { forceLight } from '../theme';
import { readStored, storageKey } from '../core/brand';
import { useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { create } from 'zustand';
import { desktop } from '../desktop';
import { saveFile, tidy } from '../saveFile';
import { DEFAULT_ASPECT, pageSize, parseSize, rasterScale, type FigureSettings } from './figureSize';

const NS = 'http://www.w3.org/2000/svg';
const STORAGE = 'figure.v1';

function restore(): FigureSettings {
  try {
    const s = JSON.parse(readStored(localStorage, STORAGE) ?? 'null');
    if (s && typeof s === 'object') {
      const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null);
      return { widthMm: num(s.widthMm), heightMm: num(s.heightMm), fontPt: num(s.fontPt) };
    }
  } catch {
    /* fall through to the defaults */
  }
  return { widthMm: null, heightMm: null, fontPt: null };
}

/** One size setting for every chart, remembered between sessions: figures in a paper should match. */
export const useFigure = create<FigureSettings & { set: (s: Partial<FigureSettings>) => void }>((set, get) => ({
  ...restore(),
  set: (s) => {
    set(s);
    try {
      localStorage.setItem(storageKey(STORAGE), JSON.stringify({ widthMm: get().widthMm, heightMm: get().heightMm, fontPt: get().fontPt }));
    } catch {
      /* the setting still applies for this session */
    }
  },
}));

/** A chart ready to be written out, in layout pixels. */
export interface Figure {
  root: SVGSVGElement;
  width: number;
  height: number;
  /** The width the chart has on screen, which sets its page size when none is asked for. */
  shownPx: number;
}

export interface LegendEntry { name: string; color: string; dashed?: boolean; points?: boolean }
/** A bitmap drawn beneath the chart's own marks (a heat map's cells, a 3-D view). */
export interface Underlay { href: string; x: number; y: number; width: number; height: number; pixelated?: boolean }

const STYLE_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'font-size', 'font-family', 'font-weight', 'opacity', 'fill-opacity', 'paint-order'];

const LEGEND_ROW = 18;
/** Space the legend takes above a chart with this many series (one series needs none). */
export const legendHeight = (entries: number) => (entries > 1 ? entries * LEGEND_ROW + 6 : 0);

const image = (u: Underlay) => {
  const el = document.createElementNS(NS, 'image');
  el.setAttribute('href', u.href);
  el.setAttribute('x', String(u.x));
  el.setAttribute('y', String(u.y));
  el.setAttribute('width', String(u.width));
  el.setAttribute('height', String(u.height));
  el.setAttribute('preserveAspectRatio', 'none');
  if (u.pixelated) el.setAttribute('style', 'image-rendering: pixelated');
  return el;
};

/** An empty figure of the given layout size with a white background. */
function blank(width: number, height: number): SVGSVGElement {
  const root = document.createElementNS(NS, 'svg');
  root.setAttribute('xmlns', NS);
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  root.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', '#ffffff');
  root.appendChild(bg);
  return root;
}

/**
 * A standalone SVG of a chart: styles that live in the app's stylesheet are
 * written onto each element, a white background and the legend are added, so
 * the file looks the same in a paper, a slide or a vector editor.
 */
export function standaloneSvg(svg: SVGSVGElement, o: { legend?: LegendEntry[]; underlay?: Underlay } = {}): { root: SVGSVGElement; width: number; height: number } {
  const legend = o.legend ?? [];
  // A saved figure is the light one, on white, whatever appearance is on screen.
  const restore = forceLight();
  try {
    return build(svg, legend, o.underlay);
  } finally {
    restore();
  }
}

function build(svg: SVGSVGElement, legend: LegendEntry[], underlay: Underlay | undefined): { root: SVGSVGElement; width: number; height: number } {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const from = [svg, ...svg.querySelectorAll('*')];
  const to = [clone, ...clone.querySelectorAll('*')];
  from.forEach((el, i) => {
    const cs = getComputedStyle(el);
    for (const p of STYLE_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v) (to[i] as SVGElement).style.setProperty(p, v);
    }
    to[i].removeAttribute('class');
    // Colours given as stylesheet variables mean nothing outside the app; the resolved value is in the style.
    for (const a of ['fill', 'stroke']) if (to[i].getAttribute(a)?.includes('var(')) to[i].removeAttribute(a);
  });
  // The playback cursor and hover read-out belong to the moment, not to the figure.
  clone.querySelectorAll('[data-live]').forEach((el) => el.remove());
  const width = svg.width.baseVal.value;
  const rowH = LEGEND_ROW;
  const top = legendHeight(legend.length);
  const height = svg.height.baseVal.value + top;
  const root = blank(width, height);
  if (top) {
    const font = getComputedStyle(svg).fontFamily;
    legend.forEach((l, i) => {
      const y = 12 + i * rowH;
      const mark = document.createElementNS(NS, l.points ? 'circle' : 'line');
      if (l.points) { mark.setAttribute('cx', '74'); mark.setAttribute('cy', String(y)); mark.setAttribute('r', '3'); mark.setAttribute('fill', l.color); }
      else {
        mark.setAttribute('x1', '62'); mark.setAttribute('x2', '86'); mark.setAttribute('y1', String(y)); mark.setAttribute('y2', String(y));
        mark.setAttribute('stroke', l.color); mark.setAttribute('stroke-width', '2');
        if (l.dashed) mark.setAttribute('stroke-dasharray', '6 4');
      }
      const text = document.createElementNS(NS, 'text');
      text.setAttribute('x', '94'); text.setAttribute('y', String(y + 4));
      text.setAttribute('font-size', '12'); text.setAttribute('font-family', font); text.setAttribute('fill', '#484644');
      text.textContent = l.name;
      root.append(mark, text);
    });
  }
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('transform', `translate(0 ${top})`);
  if (underlay) g.appendChild(image(underlay));
  while (clone.firstChild) g.appendChild(clone.firstChild);
  root.appendChild(g);
  return { root, width, height };
}

/** A figure that is nothing but a bitmap (a 3-D view). */
export function bitmapFigure(href: string, width: number, height: number): { root: SVGSVGElement; width: number; height: number } {
  const root = blank(width, height);
  root.appendChild(image({ href, x: 0, y: 0, width, height }));
  return { root, width, height };
}

/** Rasterise an SVG at `scale` times its layout size. Resolves to base64 PNG data. */
function svgToPng(text: string, width: number, height: number, scale: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png').split(',')[1]);
    };
    img.onerror = () => reject(new Error('The chart could not be rendered as an image'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
  });
}

const frame = () => new Promise((r) => requestAnimationFrame(r));

/**
 * Render a chart out of sight at a chosen width, for a figure whose layout
 * differs from the one on screen. Call `dispose` when done with `el`.
 */
export async function offscreen(node: ReactNode, widthPx: number): Promise<{ el: HTMLElement; dispose: () => void }> {
  const el = document.createElement('div');
  el.style.cssText = `position: fixed; left: -100000px; top: 0; width: ${widthPx}px; pointer-events: none;`;
  document.body.appendChild(el);
  const root = createRoot(el);
  flushSync(() => root.render(node));
  // The chart measures its container, then draws; give both a turn.
  await frame();
  await frame();
  return { el, dispose: () => { root.unmount(); el.remove(); } };
}

type Format = 'svg' | 'png' | 'pdf';

/**
 * The export buttons shown on a chart, with the figure-size settings. `build`
 * produces the figure for the current settings; `vector` is false for charts
 * that are bitmaps anyway, where an SVG would only wrap a picture.
 */
export function FigureExport({ name, build, vector = true }: { name: string; build: (s: FigureSettings) => Promise<Figure | null>; vector?: boolean }) {
  const settings = useFigure();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');

  const save = async (format: Format) => {
    setNote('');
    try {
      const s = { widthMm: settings.widthMm, heightMm: settings.heightMm, fontPt: settings.fontPt };
      const figure = await build(s);
      if (!figure) return;
      const page = pageSize(figure.width, figure.height, figure.shownPx, s);
      // Physical units on the root are what make the file open at the right size elsewhere.
      if (s.widthMm !== null || s.heightMm !== null || s.fontPt !== null || format === 'pdf') {
        figure.root.setAttribute('width', `${page.widthMm.toFixed(3)}mm`);
        figure.root.setAttribute('height', `${page.heightMm.toFixed(3)}mm`);
      }
      const text = new XMLSerializer().serializeToString(figure.root);
      if (format === 'svg') await saveFile(text, name, 'svg');
      else if (format === 'png') await saveFile(await svgToPng(text, figure.width, figure.height, rasterScale(figure.width, figure.shownPx, s)), name, 'png', 'base64');
      else await desktop?.exportPdf(text, page.widthMm, page.heightMm, tidy(name, 'pdf'));
    } catch (err) {
      setNote(`The figure could not be saved: ${err instanceof Error ? err.message : err}`);
    }
  };

  const sized = settings.widthMm !== null || settings.heightMm !== null || settings.fontPt !== null;
  return (
    <div className={`plot-export${open || note ? ' open' : ''}`} role="group" aria-label="Export this chart">
      {vector && <button title="Save as a vector image (SVG) — scales cleanly in papers and slides" onClick={() => void save('svg')}>SVG</button>}
      <button title={settings.widthMm !== null ? 'Save as an image (PNG, 300 dpi at the set width)' : 'Save as a high-resolution image (PNG, 3×)'} onClick={() => void save('png')}>PNG</button>
      {desktop && <button title="Save as a PDF page the size of the figure" onClick={() => void save('pdf')}>PDF</button>}
      <button className={sized ? 'on' : ''} title="Figure size and text size for exported charts" aria-expanded={open} onClick={() => setOpen(!open)}>Size…</button>
      {open && (
        <div className="figure-size" role="dialog" aria-label="Figure size">
          <label>
            <span>Width</span>
            <input type="text" inputMode="decimal" placeholder="as shown" defaultValue={settings.widthMm ?? ''} aria-label="Figure width in millimetres"
              onChange={(e) => settings.set({ widthMm: parseSize(e.target.value, 20, 1000) })} onKeyDown={(e) => e.stopPropagation()} />
            <span>mm</span>
          </label>
          <label>
            <span>Height</span>
            <input type="text" inputMode="decimal" placeholder={settings.widthMm !== null ? `${Math.round(settings.widthMm * DEFAULT_ASPECT)} (standard shape)` : 'as shown'} defaultValue={settings.heightMm ?? ''} aria-label="Figure height in millimetres"
              onChange={(e) => settings.set({ heightMm: parseSize(e.target.value, 15, 1000) })} onKeyDown={(e) => e.stopPropagation()} />
            <span>mm</span>
          </label>
          <label>
            <span>Text</span>
            <input type="text" inputMode="decimal" placeholder="as shown" defaultValue={settings.fontPt ?? ''} aria-label="Tick label size in points"
              onChange={(e) => settings.set({ fontPt: parseSize(e.target.value, 4, 36) })} onKeyDown={(e) => e.stopPropagation()} />
            <span>pt</span>
          </label>
          <p>Applies to every exported chart. A journal column is about 85 mm wide, a full page about 170 mm. Leave every box empty to export what is on screen. Bar charts keep the height their rows need, and 3-D views shrink their text when it would not fit.</p>
        </div>
      )}
      {note && <div className="figure-size note" role="alert">{note}</div>}
    </div>
  );
}
