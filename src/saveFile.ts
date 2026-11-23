/** Saving an exported file: through the native Save dialog in the desktop app, or as a download in a browser. */
import { desktop, type ExportExt } from './desktop';

const MIME: Record<ExportExt, string> = {
  csv: 'text/csv', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', pdf: 'application/pdf',
  py: 'text/plain', m: 'text/plain', wl: 'text/plain', jl: 'text/plain',
};

// Script file names double as identifiers in some languages (MATLAB), so those use underscores.
const SCRIPTS = new Set<ExportExt>(['py', 'm', 'wl', 'jl']);
/** A file-system-friendly base name for an export. */
export const tidy = (name: string, ext: ExportExt) => {
  const sep = SCRIPTS.has(ext) ? '_' : '-';
  return name.replace(/[^A-Za-z0-9]+/g, sep).replace(/^[-_]+|[-_]+$/g, '').toLowerCase() || 'export';
};

/** True inside the native tablet app, where the interface runs in a web view rather than a browser. */
const inNativeApp = (): boolean =>
  !!(globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

/**
 * Hand a file to the user outside the desktop app: as a download in a browser,
 * or through the share sheet ("Save to Files") in the tablet app, whose web
 * view has no downloads. Resolves to false if the user cancelled.
 */
export async function deliver(blob: Blob, fileName: string): Promise<boolean> {
  if (inNativeApp() && typeof navigator.share === 'function') {
    // Shared as plain text unless it is an image: the share sheet refuses types it does not know.
    const type = blob.type.startsWith('image/') ? blob.type : 'text/plain';
    const file = new File([blob], fileName, { type });
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch {
      return false;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}

/** Resolves to the saved file's name, or '' if the user cancelled. */
export async function saveFile(content: string, suggestedName: string, ext: ExportExt, encoding: 'utf8' | 'base64' = 'utf8'): Promise<string> {
  const name = tidy(suggestedName, ext);
  if (desktop) {
    const saved = await desktop.exportFile(content, name, ext, encoding);
    return saved ? saved.split(/[\\/]/).pop() ?? saved : '';
  }
  const blob = encoding === 'base64'
    ? new Blob([Uint8Array.from(atob(content), (c) => c.charCodeAt(0))], { type: MIME[ext] })
    : new Blob([content], { type: MIME[ext] });
  return (await deliver(blob, `${name}.${ext}`)) ? `${name}.${ext}` : '';
}
