import { rm } from 'node:fs/promises';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

/**
 * Two builds come from this file:
 *
 *   npm run build       the desktop app's interface, into dist/
 *   npm run build:web   a static site for tablets and browsers, into dist-web/
 *
 * The web build is installable (Add to Home Screen) and works offline once
 * visited. See docs/tablet.md.
 */
const web = process.env.TARGET === 'web';

/**
 * Addresses the web build may send handwriting to, for people who choose a
 * recognition service of their own: RECOGNITION_ORIGINS="https://a.example https://b.example".
 * Empty by default — the app then talks to nothing but the site it is served from.
 */
const recognitionOrigins = (process.env.RECOGNITION_ORIGINS ?? '')
  .split(/[\s,]+/)
  .filter((o) => /^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(o));

/**
 * Lock the built app down with a Content-Security-Policy. (Skipped in
 * development, where Vite's hot reload relies on inline scripts and a websocket.)
 *
 * The desktop app loads from disk and needs no network at all. The web build
 * fetches its own files, and runs the handwriting model, which is WebAssembly.
 */
function contentSecurityPolicy(): Plugin {
  const policy = [
    "default-src 'self'",
    // 'wasm-unsafe-eval' permits compiling WebAssembly only; JavaScript eval stays forbidden.
    web ? "script-src 'self' 'wasm-unsafe-eval'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${web ? ["'self'", ...recognitionOrigins].join(' ') : "'none'"}`,
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

/**
 * The service worker that lets the installed web app open without a connection.
 * App files are cached per build; the handwriting model, which is large and
 * changes rarely, is cached once and kept across updates.
 */
const serviceWorker = (build: string) => `
const SHELL = 'physics-tooling-shell-${build}';
const MODEL = 'physics-tooling-model-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== SHELL && name !== MODEL) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const isPage = req.mode === 'navigate';
  const cacheName = url.pathname.includes('/models/') ? MODEL : SHELL;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(req, { ignoreSearch: isPage });
    // The page itself is fetched fresh when possible, so an update is picked up; everything else is served from the cache.
    if (hit && !isPage) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) await cache.put(req, res.clone());
      return res;
    } catch (err) {
      if (hit) return hit;
      throw err;
    }
  })());
});
`;

/** The desktop app cannot use the handwriting model yet, so its build leaves those files out. */
function withoutHandwritingFiles(): Plugin {
  return {
    name: 'without-handwriting-files',
    apply: 'build',
    async closeBundle() {
      for (const dir of ['dist/models', 'dist/ort']) await rm(dir, { recursive: true, force: true });
    },
  };
}

/**
 * The handwriting runtime is served from public/ort (see scripts/setup-handwriting.mjs).
 * The bundler would also copy its 21 MB WebAssembly file into assets/, where nothing loads it.
 */
function withoutDuplicateRuntime(): Plugin {
  return {
    name: 'without-duplicate-runtime',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const name of Object.keys(bundle)) if (/ort-wasm[^/]*\.wasm$/.test(name)) delete bundle[name];
    },
  };
}

/** What makes the web build installable on a tablet's home screen. */
function installable(): Plugin {
  const tags = [
    '<link rel="manifest" href="./manifest.webmanifest" />',
    '<link rel="apple-touch-icon" href="./apple-touch-icon.png" />',
    '<meta name="theme-color" content="#0f548c" />',
    '<meta name="mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-title" content="Physics Tooling" />',
    '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
  ].join('\n    ');
  return {
    name: 'installable',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('</head>', `    ${tags}\n  </head>`),
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorker(`${pkg.version}-${Date.now().toString(36)}`) });
    },
  };
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy(), withoutDuplicateRuntime(), web ? installable() : withoutHandwritingFiles()],
  // The same applies to the worker that runs the model.
  worker: { format: 'es', plugins: () => [withoutDuplicateRuntime()] },
  // The app version, stamped into saved files and exports; and which build this is.
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __WEB_BUILD__: JSON.stringify(web) },
  // Relative asset paths so the build works when loaded from the app bundle (file://) or from any folder of a site.
  base: './',
  build: { outDir: web ? 'dist-web' : 'dist' },
});
