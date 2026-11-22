/**
 * Fetch what on-device handwriting recognition needs, into public/ so that
 * the next build includes it:
 *
 *   public/models/formulanet/   the recognition model (about 80 MB)
 *   public/ort/                 the WebAssembly runtime that executes it
 *
 * Neither is kept in the repository. Without them the scratchpad still works;
 * it just asks you to type what a line says instead of reading it.
 *
 *   npm run setup:handwriting
 *
 * The model is FormulaNet from the Texo project (AGPL-3.0). Read
 * docs/tablet.md before redistributing a build that includes it.
 */
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = process.env.HANDWRITING_MODEL_URL ?? 'https://huggingface.co/alephpi/FormulaNet/resolve/main/onnx';
const FILES = [
  ['config.json', 'config.json'],
  ['generation_config.json', 'generation_config.json'],
  ['tokenizer.json', 'tokenizer.json'],
  ['tokenizer_config.json', 'tokenizer_config.json'],
  ['encoder_model.onnx', 'onnx/encoder_model.onnx'],
  ['decoder_model_merged.onnx', 'onnx/decoder_model_merged.onnx'],
];

const exists = (p) => stat(p).then((s) => s.size > 0, () => false);

async function download(url, to) {
  if (await exists(to)) return console.log(`  have   ${to.slice(root.length + 1)}`);
  await mkdir(dirname(to), { recursive: true });
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url} answered ${res.status}`);
  // Write beside the target and rename, so an interrupted download is never mistaken for a whole file.
  await pipeline(Readable.fromWeb(res.body), createWriteStream(`${to}.part`));
  await rename(`${to}.part`, to);
  console.log(`  fetched ${to.slice(root.length + 1)} (${((await stat(to)).size / 1e6).toFixed(1)} MB)`);
}

console.log('Handwriting model');
for (const [from, to] of FILES) await download(`${SOURCE}/${from}`, join(root, 'public/models/formulanet', to));

console.log('WebAssembly runtime');
const ortDist = join(root, 'node_modules/onnxruntime-web/dist');
const ortOut = join(root, 'public/ort');
await mkdir(ortOut, { recursive: true });
for (const f of await readdir(ortDist)) {
  // The library asks for this variant by name.
  if (!/^ort-wasm-simd-threaded\.jsep\.(wasm|mjs)$/.test(f)) continue;
  await copyFile(join(ortDist, f), join(ortOut, f));
  console.log(`  copied ${f}`);
}
console.log('Done. Build or run the app as usual; the scratchpad will now read handwriting.');
