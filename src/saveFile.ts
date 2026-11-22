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

/** Resolves to the saved file's name, or '' if the user cancelled. */
export async function saveFile(content: string, suggestedName: string, ext: ExportExt, encoding: 'utf8' | 'base64' = 'utf8'): Promise<string> {
  const name = tidy(suggestedName, ext);
  if (desktop) {
    const saved = await desktop.exportFile(content, name, ext, encoding);
    return saved ? saved.split(/[\\/]/).pop() ?? saved : '';
  }
  const a = document.createElement('a');
  a.href = encoding === 'base64'
    ? `data:${MIME[ext]};base64,${content}`
    : URL.createObjectURL(new Blob([content], { type: MIME[ext] }));
  a.download = `${name}.${ext}`;
  a.click();
  if (encoding !== 'base64') URL.revokeObjectURL(a.href);
  return a.download;
}
