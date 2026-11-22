// Development launcher: start the Vite dev server, then open it in Electron with hot reload.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const server = await createServer();
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error('Vite did not report a local URL');

const electron = createRequire(import.meta.url)('electron');
const child = spawn(electron, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
