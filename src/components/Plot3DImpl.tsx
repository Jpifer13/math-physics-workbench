import { forceLight, useTheme } from '../theme';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { fmtNum } from '../core/units';
import { bitmapFigure, FigureExport, type Figure } from './figure';
import { layoutHeight, layoutWidth, rasterScale, type FigureSettings } from './figureSize';
import { makeScale, tickLabel } from './scale';
import { useWidth } from './useSize';

export type Vec3 = [number, number, number];

export interface Surface3D {
  xs: number[];
  ys: number[];
  /** z[iy][ix] */
  z: number[][];
}
export interface Line3D {
  points: Vec3[];
  /** Palette slot 1–8. */
  slot?: number;
}
export interface Marker3D {
  p: Vec3;
  slot?: number;
}

export interface Plot3DProps {
  surface?: Surface3D;
  lines?: Line3D[];
  markers?: Marker3D[];
  /** With lines: draw the path solid up to this sample and faint beyond it. */
  progress?: number;
  labels: [string, string, string];
  height?: number;
  /** Same scale on all three axes (for paths through real space). */
  equal?: boolean;
  /** Pin the vertical range, e.g. while a surface animates. */
  zDomain?: [number, number];
  /** Base name for exported image files; defaults to the axis labels. */
  exportName?: string;
}

// Sequential ramp shared with the 2-D heat map: one hue, light → dark.
const LO = new THREE.Color('rgb(222,235,250)');
const HI = new THREE.Color('rgb(9,48,105)');

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function extent(values: Iterable<number>): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!(lo <= hi)) return [0, 1];
  if (lo === hi) { const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1; return [lo - pad, hi + pad]; }
  return [lo, hi];
}

function textSprite(text: string, color: string, bold: boolean, viewHeight: number): THREE.Sprite {
  const c = document.createElement('canvas');
  // Drawn large so the text stays sharp in a figure exported at print resolution.
  c.width = 768;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.font = `${bold ? '600 ' : ''}60px "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 384, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  // Without size attenuation a sprite is sized as a fraction of the view, so this keeps text at ~12px
  // whatever the panel height, zoom level or distance from the camera.
  const h = 17.5 / viewHeight;
  sprite.scale.set(h * 6, h, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function dispose(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      (mat as THREE.SpriteMaterial).map?.dispose();
      mat.dispose();
    }
  });
}

interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  frame: THREE.Group;
  content: THREE.Group;
  markers: THREE.Group;
  frameKey: string;
  solid: Line2[];
  render: () => void;
  /** Rebuild the box, grid and labels for a view of the given height (text is sized against it). */
  buildFrame: (viewHeight: number) => void;
}

/**
 * Interactive 3-D chart (drag to orbit, scroll to zoom). Data axes are x, y
 * horizontal and z up; everything is scaled into a fixed box so any units fit.
 */
export default function Plot3DImpl({ surface, lines, markers, progress, labels, height = 300, equal, zDomain, exportName }: Plot3DProps) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const mapRef = useRef<(p: Vec3) => THREE.Vector3>(() => new THREE.Vector3());
  // For hover readouts: scene → data coordinates, the surface mesh, and the path samples.
  const unmapRef = useRef<(v: THREE.Vector3) => Vec3>(() => [0, 0, 0]);
  const surfaceRef = useRef<THREE.Mesh | null>(null);
  const pathRef = useRef<{ data: Vec3; at: THREE.Vector3 }[]>([]);
  const [tip, setTip] = useState<{ left: number; top: number; lines: string[] } | null>(null);

  const onHover = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = stage.current;
    // No readout while orbiting.
    if (!s || e.buttons !== 0) return setTip(null);
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    let hit: Vec3 | null = null;
    if (surfaceRef.current) {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1), s.camera);
      const found = ray.intersectObject(surfaceRef.current, false)[0];
      if (found) hit = unmapRef.current(found.point);
    } else {
      // Nearest path sample on screen, within a small radius.
      let best = 14 * 14;
      const v = new THREE.Vector3();
      for (const p of pathRef.current) {
        v.copy(p.at).project(s.camera);
        const dx = ((v.x + 1) / 2) * rect.width - px;
        const dy = ((1 - v.y) / 2) * rect.height - py;
        const d2 = dx * dx + dy * dy;
        if (d2 < best && v.z < 1) { best = d2; hit = p.data; }
      }
    }
    setTip(hit ? { left: px, top: py, lines: hit.map((val, i) => `${labels[i]}: ${fmtNum(val, 5)}`) } : null);
  };

  const theme = useTheme((t) => t.theme);

  // One-time scene setup.
  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      el.textContent = '3-D graphics (WebGL) are not available in this browser.';
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 50);
    // Short panels need the camera further back so the axis labels stay in frame.
    camera.position.set(2.7, 1.75, 3.35).multiplyScalar(height < 300 ? 1.3 : 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, -0.2, 0);
    controls.minDistance = 1.8;
    controls.maxDistance = 10;
    controls.enablePan = false;
    controls.update();
    scene.add(new THREE.AmbientLight(0xffffff, 2.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(1.5, 4, 2.5);
    scene.add(sun);
    const frame = new THREE.Group();
    const content = new THREE.Group();
    const markerGroup = new THREE.Group();
    scene.add(frame, content, markerGroup);
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);
    stage.current = { renderer, scene, camera, controls, frame, content, markers: markerGroup, frameKey: '', solid: [], render, buildFrame: () => {} };
    return () => {
      controls.dispose();
      dispose(scene);
      renderer.dispose();
      renderer.domElement.remove();
      stage.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    s.renderer.setSize(width, height);
    s.camera.aspect = width / height;
    s.camera.updateProjectionMatrix();
    for (const l of s.solid) (l.material as LineMaterial).resolution.set(width, height);
    s.content.traverse((o) => {
      const mat = (o as Line2).material as LineMaterial | undefined;
      if (mat && (mat as LineMaterial).isLineMaterial) mat.resolution.set(width, height);
    });
    s.render();
  }, [width, height]);

  // Axes, surface and paths.
  useEffect(() => {
    const s = stage.current;
    if (!s) return;

    const pts = (lines ?? []).flatMap((l) => l.points);
    let dx = extent(surface ? surface.xs : pts.map((p) => p[0]));
    let dy = extent(surface ? surface.ys : pts.map((p) => p[1]));
    let dz = zDomain ?? extent(surface ? surface.z.flat() : pts.map((p) => p[2]));
    let half: Vec3 = [1, 1, 0.62];
    if (equal) {
      const span = Math.max(dx[1] - dx[0], dy[1] - dy[0], dz[1] - dz[0]);
      half = [(dx[1] - dx[0]) / span, (dy[1] - dy[0]) / span, (dz[1] - dz[0]) / span].map((h) => Math.max(h, 0.12)) as Vec3;
    }
    const [hx, hy, hz] = half;
    // Data (x, y, z-up) → scene (x, y-up, z towards the viewer).
    const map = (p: Vec3) =>
      new THREE.Vector3(
        (((p[0] - dx[0]) / (dx[1] - dx[0])) * 2 - 1) * hx,
        (((p[2] - dz[0]) / (dz[1] - dz[0])) * 2 - 1) * hz,
        -(((p[1] - dy[0]) / (dy[1] - dy[0])) * 2 - 1) * hy,
      );
    mapRef.current = map;
    unmapRef.current = (v) => [
      dx[0] + ((v.x / hx + 1) / 2) * (dx[1] - dx[0]),
      dy[0] + ((-v.z / hy + 1) / 2) * (dy[1] - dy[0]),
      dz[0] + ((v.y / hz + 1) / 2) * (dz[1] - dz[0]),
    ];

    // The frame (box, grid, tick labels) is rebuilt only when the ranges change.
    // Label offsets are in scene units, so push them further out in short panels where text is relatively larger.
    s.buildFrame = (viewHeight: number) => {
      const textSize = Math.min(2, Math.max(1, 500 / viewHeight));
      dispose(s.frame);
      s.frame.clear();
      const ink = cssVar('--text-muted') || '#605e5c';
      const strong = cssVar('--text-secondary') || '#484644';
      const gridColor = new THREE.Color(cssVar('--border-strong') || '#c8c6c4');
      const box = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * hx, 2 * hz, 2 * hy)),
        new THREE.LineBasicMaterial({ color: gridColor }),
      );
      s.frame.add(box);

      const sx = makeScale(dx[0], dx[1], false, 4);
      const sy = makeScale(dy[0], dy[1], false, 4);
      const sz = makeScale(dz[0], dz[1], false, 4);
      const seg: number[] = [];
      const line = (a: THREE.Vector3, b: THREE.Vector3) => seg.push(a.x, a.y, a.z, b.x, b.y, b.z);
      const label = (text: string, at: THREE.Vector3, bold = false) => {
        const sp = textSprite(text, bold ? strong : ink, bold, viewHeight);
        sp.position.copy(at);
        s.frame.add(sp);
      };
      const inside = (t: number, d: [number, number]) => t >= d[0] && t <= d[1];
      for (const t of sx.ticks.filter((v) => inside(v, dx))) {
        line(map([t, dy[0], dz[0]]), map([t, dy[1], dz[0]]));
        label(tickLabel(t), map([t, dy[0], dz[0]]).add(new THREE.Vector3(0, -0.09 * textSize, 0.13 * textSize)));
      }
      for (const t of sy.ticks.filter((v) => inside(v, dy))) {
        line(map([dx[0], t, dz[0]]), map([dx[1], t, dz[0]]));
        label(tickLabel(t), map([dx[1], t, dz[0]]).add(new THREE.Vector3(0.2 * textSize, -0.09 * textSize, 0)));
      }
      for (const t of sz.ticks.filter((v) => inside(v, dz))) {
        line(map([dx[0], dy[1], t]), map([dx[1], dy[1], t]));
        line(map([dx[0], dy[0], t]), map([dx[0], dy[1], t]));
        label(tickLabel(t), map([dx[0], dy[0], t]).add(new THREE.Vector3(-0.22 * textSize, 0, 0.06)));
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
      s.frame.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: gridColor, transparent: true, opacity: 0.5 })));
      label(labels[0], new THREE.Vector3(0, -hz - 0.24 * textSize, hy + 0.3 * textSize), true);
      label(labels[1], new THREE.Vector3(hx + 0.5 * textSize, -hz - 0.24 * textSize, 0), true);
      label(labels[2], new THREE.Vector3(-hx - 0.3, hz + 0.16 * textSize, hy + 0.06), true);
    };
    const frameKey = JSON.stringify([dx, dy, dz, half, labels, height]);
    if (frameKey !== s.frameKey) {
      s.frameKey = frameKey;
      s.buildFrame(height);
    }

    dispose(s.content);
    s.content.clear();
    s.solid = [];
    surfaceRef.current = null;
    pathRef.current = [];

    if (surface && surface.xs.length > 1 && surface.ys.length > 1) {
      const nx = surface.xs.length;
      const ny = surface.ys.length;
      const pos = new Float32Array(nx * ny * 3);
      const col = new Float32Array(nx * ny * 3);
      const ok = new Uint8Array(nx * ny);
      const c = new THREE.Color();
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          const zv = surface.z[j]?.[i];
          const fin = Number.isFinite(zv);
          ok[k] = fin ? 1 : 0;
          // Values beyond a pinned range are clamped to the box.
          const zc = fin ? Math.min(dz[1], Math.max(dz[0], zv)) : dz[0];
          const v = map([surface.xs[i], surface.ys[j], zc]);
          pos.set([v.x, v.y, v.z], k * 3);
          c.lerpColors(LO, HI, (zc - dz[0]) / (dz[1] - dz[0]));
          col.set([c.r, c.g, c.b], k * 3);
        }
      }
      const index: number[] = [];
      for (let j = 0; j < ny - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
          const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1;
          if (ok[a] && ok[b] && ok[d] && ok[e]) index.push(a, b, d, b, e, d);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setIndex(index);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      s.content.add(mesh);
      surfaceRef.current = mesh;

      // A sparse mesh of grid lines makes the shape readable from any angle.
      const wire: number[] = [];
      const stepX = Math.max(1, Math.round(nx / 16));
      const stepY = Math.max(1, Math.round(ny / 16));
      const P = (i: number, j: number) => [pos[(j * nx + i) * 3], pos[(j * nx + i) * 3 + 1] + 0.003, pos[(j * nx + i) * 3 + 2]];
      for (let j = 0; j < ny; j += stepY) for (let i = 0; i < nx - 1; i++) if (ok[j * nx + i] && ok[j * nx + i + 1]) wire.push(...P(i, j), ...P(i + 1, j));
      for (let i = 0; i < nx; i += stepX) for (let j = 0; j < ny - 1; j++) if (ok[j * nx + i] && ok[(j + 1) * nx + i]) wire.push(...P(i, j), ...P(i, j + 1));
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
      s.content.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 })));
    }

    for (const [li, l] of (lines ?? []).entries()) {
      const flat: number[] = [];
      for (const p of l.points) {
        if (!p.every(Number.isFinite)) continue;
        const v = map(p);
        flat.push(v.x, v.y, v.z);
        pathRef.current.push({ data: p, at: v });
      }
      if (flat.length < 6) continue;
      const color = new THREE.Color(cssVar(`--series-${((l.slot ?? li + 1) - 1) % 8 + 1}`) || '#2a78d6');
      const make = (opacity: number, w: number) => {
        const geo = new LineGeometry();
        geo.setPositions(flat);
        const mat = new LineMaterial({ color, linewidth: w, transparent: opacity < 1, opacity });
        mat.resolution.set(width, height);
        return new Line2(geo, mat);
      };
      if (progress !== undefined) s.content.add(make(0.22, 1.5));
      const solid = make(1, 2.2);
      s.content.add(solid);
      s.solid.push(solid);
    }
    s.render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface, lines, equal, height, zDomain?.[0], zDomain?.[1], labels[0], labels[1], labels[2], theme]);

  // Cheap per-frame updates: playback position and markers.
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    if (progress !== undefined) {
      for (const l of s.solid) (l.geometry as LineGeometry).instanceCount = Math.max(0, Math.floor(progress));
    }
    const list = (markers ?? []).filter((m) => m.p.every(Number.isFinite));
    // Reuse the marker meshes between frames; only their positions change during playback.
    if (s.markers.children.length !== list.length) {
      dispose(s.markers);
      s.markers.clear();
      for (const [i, m] of list.entries()) {
        s.markers.add(new THREE.Mesh(
          new THREE.SphereGeometry(0.045, 20, 14),
          new THREE.MeshLambertMaterial({ color: new THREE.Color(cssVar(`--series-${((m.slot ?? i + 1) - 1) % 8 + 1}`) || '#eb6834') }),
        ));
      }
    }
    list.forEach((m, i) => s.markers.children[i].position.copy(mapRef.current(m.p)));
    s.render();
  });

  /** The view as it stands (same angle and zoom), re-rendered at the figure's size and resolution. */
  const figure = async (settings: FigureSettings): Promise<Figure | null> => {
    const s = stage.current;
    if (!s) return null;
    // A 3-D view needs room around the box for its labels. Below about 300 layout pixels of height they collide,
    // so a small figure is laid out larger and its text comes out smaller than asked rather than overlapping.
    const fit = Math.max(1, 300 / layoutHeight(width, height, settings));
    const lw = Math.round(layoutWidth(width, settings) * fit);
    const lh = Math.round(layoutHeight(width, height, settings) * fit);
    const limit = Math.min(8192, s.renderer.capabilities.maxTextureSize);
    const ratio = Math.min(rasterScale(lw, width, settings), limit / Math.max(lw, lh));
    const resize = (w: number, h: number) => s.scene.traverse((o) => {
      const mat = (o as Line2).material as LineMaterial | undefined;
      if (mat && mat.isLineMaterial) mat.resolution.set(w, h);
    });
    // Text is sized against the view, so the labels are laid out again for the figure's height, and the camera
    // sits where it would for a panel of that height on screen.
    const back = (lh < 300 ? 1.3 : 1) / (height < 300 ? 1.3 : 1);
    const eye = s.camera.position.clone();
    const before = s.renderer.getPixelRatio();
    // A figure shows the whole path, not the moment playback happens to be at.
    const playing = progress !== undefined;
    // A saved figure is the light one, on white: its frame and labels are drawn in the light colours.
    const restore = forceLight();
    const relabel = lh !== height || theme === 'dark';
    try {
      if (relabel) s.buildFrame(lh);
      s.camera.position.copy(s.controls.target).add(eye.clone().sub(s.controls.target).multiplyScalar(back));
      if (playing) {
        for (const l of s.solid) (l.geometry as LineGeometry).instanceCount = Infinity;
        s.markers.visible = false;
      }
      s.renderer.setPixelRatio(ratio);
      s.renderer.setSize(lw, lh, false);
      s.camera.aspect = lw / lh;
      s.camera.updateProjectionMatrix();
      resize(lw, lh);
      s.render();
      // Read the picture back before the browser clears the drawing buffer.
      const href = s.renderer.domElement.toDataURL('image/png');
      return { ...bitmapFigure(href, lw, lh), shownPx: width };
    } finally {
      restore();
      if (relabel) s.buildFrame(height);
      s.camera.position.copy(eye);
      if (playing) {
        for (const l of s.solid) (l.geometry as LineGeometry).instanceCount = Math.max(0, Math.floor(progress));
        s.markers.visible = true;
      }
      s.renderer.setPixelRatio(before);
      s.renderer.setSize(width, height);
      s.camera.aspect = width / height;
      s.camera.updateProjectionMatrix();
      resize(width, height);
      s.render();
    }
  };

  return (
    <div ref={wrap} className="plot3d" style={{ height }} onPointerMove={onHover} onPointerLeave={() => setTip(null)}>
      <div ref={host} className="plot3d-host" role="img" aria-label={`3-D chart of ${labels[2]} over ${labels[0]} and ${labels[1]}`} />
      <FigureExport name={exportName ?? `${labels[2]} over ${labels[0]} and ${labels[1]}`} build={figure} vector={false} />
      <span className="plot3d-hint">Drag to rotate · scroll to zoom · hover to read values</span>
      {tip && (
        <div className="plot-tip" style={tip.left > width * 0.6 ? { right: width - tip.left + 14, top: tip.top + 10 } : { left: tip.left + 14, top: tip.top + 10 }}>
          {tip.lines.map((l, i) => <div key={i} className={i === 2 ? 'plot-tip-strong' : undefined}>{l}</div>)}
        </div>
      )}
    </div>
  );
}
