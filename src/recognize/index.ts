/**
 * Reading handwriting. Two ways, chosen by the user:
 *
 *  - On this device: a model shipped with the app, run locally. Nothing leaves
 *    the device. Present only in builds that were set up with it.
 *  - A service of the user's own choosing: the picture of a line is sent to an
 *    address they enter. Off unless they turn it on, and only reachable in a
 *    build whose security policy allows that address.
 *
 * With neither, lines are typed in by hand.
 */
import { readStored, storageKey } from '../core/brand';
import { repairReading } from '../core/latexMath';
import type { Stroke } from '../core/ink';
import { MODEL_SIZE, rasterAsPng, rasterForModel } from './raster';
import type { WorkerReply, WorkerRequest } from './local.worker';

export type RecognitionMode = 'device' | 'service' | 'off';

export interface RecognitionSettings {
  mode: RecognitionMode;
  /** Where to send pictures of lines when mode is 'service'. */
  serviceUrl: string;
  /** Sent as a bearer token, if the service needs one. Kept on this device only. */
  serviceKey: string;
}

const SETTINGS = 'recognition.v1';

export function loadSettings(): RecognitionSettings {
  const fallback: RecognitionSettings = { mode: 'device', serviceUrl: '', serviceKey: '' };
  try {
    const raw = JSON.parse(readStored(localStorage, SETTINGS) ?? 'null');
    if (raw && (raw.mode === 'device' || raw.mode === 'service' || raw.mode === 'off')) {
      return { mode: raw.mode, serviceUrl: String(raw.serviceUrl ?? ''), serviceKey: String(raw.serviceKey ?? '') };
    }
  } catch {
    /* use the defaults */
  }
  return fallback;
}

export function saveSettings(s: RecognitionSettings): void {
  try {
    localStorage.setItem(storageKey(SETTINGS), JSON.stringify(s));
  } catch {
    /* the choice simply is not remembered */
  }
}

/** What a recogniser said, tidied: spacing commands and aliases that mean nothing to the reader are removed. */
export function cleanLatex(s: string): string {
  return repairReading(s
    .replace(/\\infin\b/g, '\\infty')
    .replace(/~|\\!|\\,|\\;|\\:|\\quad\b|\\qquad\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

const base = (): string => new URL('.', document.baseURI).href;

let installed: Promise<boolean> | undefined;
/** Whether this build includes the on-device model. */
export function deviceModelInstalled(): Promise<boolean> {
  // The desktop app loads from disk, never ships the model, and may not fetch anything: do not ask.
  installed ??= location.protocol === 'file:'
    ? Promise.resolve(false)
    : fetch(new URL('models/formulanet/config.json', base()).href)
      .then((r) => r.ok && (r.headers.get('content-type') ?? '').includes('json'), () => false);
  return installed;
}

export type DeviceState = 'idle' | 'loading' | 'ready' | 'failed';

let worker: Worker | undefined;
let state: DeviceState = 'idle';
let ready: Promise<void> | undefined;
let nextId = 1;
const waiting = new Map<number, { resolve: (s: string) => void; reject: (e: Error) => void }>();
const listeners = new Set<(s: DeviceState) => void>();

const setState = (s: DeviceState) => { state = s; listeners.forEach((l) => l(s)); };
export const deviceState = (): DeviceState => state;
export function onDeviceState(l: (s: DeviceState) => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Start the on-device model, once. Loading it takes a few seconds the first time. */
export function startDeviceModel(): Promise<void> {
  if (ready) return ready;
  setState('loading');
  ready = new Promise<void>((resolve, reject) => {
    try {
      worker = new Worker(new URL('./local.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      setState('failed');
      reject(new Error('The handwriting model could not be started in this browser.'));
      return;
    }
    const fail = (why: string) => {
      setState('failed');
      const err = new Error(why);
      reject(err);
      waiting.forEach((w) => w.reject(err));
      waiting.clear();
    };
    worker.onerror = () => fail('The handwriting model stopped unexpectedly. Reload the page to try again.');
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const m = e.data;
      if (m.type === 'ready') { setState('ready'); resolve(); }
      else if (m.type === 'failed') fail('The handwriting model could not be loaded. This device may not have enough free memory for it.');
      else {
        const w = waiting.get(m.id);
        waiting.delete(m.id);
        if (m.type === 'result') w?.resolve(m.latex);
        else w?.reject(new Error('This line could not be read.'));
      }
    };
    worker.postMessage({ type: 'load', base: base() } satisfies WorkerRequest);
  });
  // A failed start may be retried by reloading; it is not retried on every line.
  ready.catch(() => undefined);
  return ready;
}

async function readOnDevice(strokes: Stroke[]): Promise<string> {
  await startDeviceModel();
  const grey = rasterForModel(strokes);
  return new Promise<string>((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    worker!.postMessage({ type: 'read', id, grey, size: MODEL_SIZE } satisfies WorkerRequest, [grey.buffer]);
  });
}

/**
 * Ask the user's chosen service. The contract is deliberately small so that a
 * few lines of glue can put any provider behind it:
 *
 *   POST <serviceUrl>     Content-Type: image/png     body: the picture
 *   Authorization: Bearer <key>                       (only if a key is set)
 *   → 200 with JSON {"latex": "..."}  (or the LaTeX as plain text)
 */
async function readByService(strokes: Stroke[], s: RecognitionSettings): Promise<string> {
  let url: URL;
  try {
    url = new URL(s.serviceUrl);
  } catch {
    throw new Error('The recognition service address is not a valid web address. Check it in the handwriting settings.');
  }
  const body = await rasterAsPng(strokes);
  let res: Response;
  try {
    res = await fetch(url.href, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', ...(s.serviceKey ? { Authorization: `Bearer ${s.serviceKey}` } : {}) },
      body,
    });
  } catch {
    throw new Error(`The recognition service at ${url.host} could not be reached. Either it is offline, or this build of the app does not permit connections to it.`);
  }
  if (!res.ok) throw new Error(`The recognition service answered with an error (${res.status}).`);
  const text = await res.text();
  try {
    const json = JSON.parse(text) as { latex?: unknown };
    if (typeof json.latex === 'string') return json.latex;
  } catch {
    /* plain text */
  }
  return text;
}

/** Read one written line. Rejects with a message fit to show. */
export async function readLine(strokes: Stroke[], settings: RecognitionSettings): Promise<string> {
  const raw = settings.mode === 'service' ? await readByService(strokes, settings) : await readOnDevice(strokes);
  return cleanLatex(raw);
}
