import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

/**
 * Builds the command-line mode as one self-contained file for Node: the
 * engine and the libraries it needs, no interface. It lands beside the
 * interface in dist/, so it ships inside the packaged app too.
 */
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // No icons or manifest: those belong to the interface.
  publicDir: false,
  build: {
    ssr: 'src/cli/main.ts',
    outDir: 'dist/cli',
    emptyOutDir: true,
    target: 'node20',
    rollupOptions: { output: { entryFileNames: 'cli.mjs' } },
  },
  // Bundle the dependencies in, so the file runs without node_modules.
  ssr: { noExternal: true },
});
