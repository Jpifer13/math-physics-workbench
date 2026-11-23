#!/usr/bin/env node
// Command-line mode of Math & Physics Workbench. Build it first: npm run build:cli
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const bundle = fileURLToPath(new URL('../dist/cli/cli.mjs', import.meta.url));
if (!existsSync(bundle)) {
  process.stderr.write('The command-line mode has not been built yet. Run: npm run build:cli\n');
  process.exit(2);
}
const { main } = await import(new URL('../dist/cli/cli.mjs', import.meta.url).href);
process.exitCode = main(process.argv.slice(2));
