/**
 * A second reader on an iPad: the system's own handwriting recogniser, which
 * works from the pen strokes on the device. It reads plain text, not layout,
 * so it is only ever used alongside the model (see core/combine).
 *
 * Present only in the iPad app, on a system recent enough to have it.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Stroke } from '../core/ink';

interface InkReader {
  read(options: { strokes: number[][] }): Promise<{ text: string }>;
}

const reader = registerPlugin<InkReader>('InkReader');

let unavailable = false;

/** What the system recogniser makes of a line, or nothing if it is not there or cannot say. */
export async function readStrokesAsText(strokes: Stroke[]): Promise<string> {
  if (unavailable || !Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return '';
  try {
    return (await reader.read({ strokes: strokes.map((s) => s.pts) })).text ?? '';
  } catch (err) {
    // An older system, or a build without the bridge: do not ask again for every line.
    if (/needs iPadOS|not implemented/i.test(err instanceof Error ? err.message : String(err))) unavailable = true;
    return '';
  }
}
