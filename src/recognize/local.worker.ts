/**
 * Runs the on-device handwriting model. It lives in a worker because reading a
 * line takes a noticeable moment and must not freeze the pen.
 *
 * Everything is loaded from the app's own files (see scripts/setup-handwriting.mjs);
 * nothing is requested from the network.
 */
import { env, PreTrainedTokenizer, Tensor, VisionEncoderDecoderModel } from '@huggingface/transformers';

export type WorkerRequest =
  | { type: 'load'; base: string }
  | { type: 'read'; id: number; grey: Uint8Array; size: number };
export type WorkerReply =
  | { type: 'ready' }
  | { type: 'failed'; reason: string }
  | { type: 'result'; id: number; latex: string }
  | { type: 'error'; id: number; reason: string };

// How the model's training pictures were normalised.
const MEAN = 0.7931;
const STD = 0.1738;
/** Longest answer, in tokens. A handwritten line is far shorter; the cap stops a runaway. */
const MAX_TOKENS = 200;

let model: VisionEncoderDecoderModel | undefined;
let tokenizer: PreTrainedTokenizer | undefined;

const post = (m: WorkerReply) => (self as unknown as { postMessage(m: WorkerReply): void }).postMessage(m);
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function load(base: string) {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useBrowserCache = false;
  env.localModelPath = new URL('models/', base).href;
  const wasm = env.backends.onnx.wasm!;
  wasm.wasmPaths = new URL('ort/', base).href;
  // One thread: more needs cross-origin isolation headers that a plain static host does not send.
  wasm.numThreads = 1;
  wasm.proxy = false;
  model = (await VisionEncoderDecoderModel.from_pretrained('formulanet', { dtype: 'fp32', device: 'wasm' })) as VisionEncoderDecoderModel;
  tokenizer = await PreTrainedTokenizer.from_pretrained('formulanet');
}

async function read(grey: Uint8Array, size: number): Promise<string> {
  const plane = size * size;
  const data = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) {
    const v = (grey[i] / 255 - MEAN) / STD;
    data[i] = v;
    data[plane + i] = v;
    data[2 * plane + i] = v;
  }
  const pixels = new Tensor('float32', data, [1, 3, size, size]);
  const out = await model!.generate({ inputs: pixels, max_new_tokens: MAX_TOKENS } as Parameters<VisionEncoderDecoderModel['generate']>[0]);
  return tokenizer!.batch_decode(out as Tensor, { skip_special_tokens: true })[0] ?? '';
}

// One job at a time: the model is not re-entrant.
let queue: Promise<unknown> = Promise.resolve();

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === 'load') {
    queue = queue.then(() => load(msg.base)).then(() => post({ type: 'ready' }), (e) => post({ type: 'failed', reason: reason(e) }));
    return;
  }
  queue = queue.then(async () => {
    try {
      if (!model) throw new Error('not loaded');
      post({ type: 'result', id: msg.id, latex: await read(msg.grey, msg.size) });
    } catch (e) {
      post({ type: 'error', id: msg.id, reason: reason(e) });
    }
  });
};
