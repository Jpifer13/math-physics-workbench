import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

/**
 * The packaged app loads from disk and never needs the network, so lock it
 * down with a Content-Security-Policy. (Skipped in development, where Vite's
 * hot reload relies on inline scripts and a websocket.)
 */
function contentSecurityPolicy(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'none'",
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

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  // The app version, stamped into saved files and exports.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Relative asset paths so the build works when loaded from the app bundle (file://).
  base: './',
});
