/** File commands for flows: New, Open, Save, Save As. Shared by the toolbar and the native menu. */
import { desktop, type OpenedFile } from '../desktop';
import { currentDoc, markSaved, useFlow } from './store';
import type { FlowDoc } from './types';

const serialize = () => JSON.stringify(currentDoc(), null, 2);
const fail = (notice: string) => useFlow.setState({ notice });

function parse(text: string): FlowDoc {
  const doc = JSON.parse(text) as FlowDoc;
  if (!doc || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) throw new Error('not a flow');
  return doc;
}

/** Replace the current flow, asking first if there are unsaved changes. */
function confirmDiscard(): boolean {
  const { dirty, nodes } = useFlow.getState();
  return !dirty || !nodes.length || confirm('This flow has unsaved changes. Discard them?');
}

export function loadOpened(file: OpenedFile) {
  try {
    useFlow.getState().load(parse(file.text));
    markSaved(file.path);
  } catch {
    fail(`“${file.path.split(/[\\/]/).pop()}” is not a valid flow file.`);
  }
}

export function newFlow() {
  if (!confirmDiscard()) return;
  useFlow.getState().clear();
  markSaved(null);
}

export async function openFlow() {
  if (!confirmDiscard()) return;
  if (desktop) {
    try {
      const file = await desktop.openFlow();
      if (file) loadOpened(file);
    } catch (err) {
      fail(`Could not open the file: ${err instanceof Error ? err.message : err}`);
    }
    return;
  }
  // Browser fallback (development only): a file picker.
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.physflow,.json,application/json';
  input.onchange = async () => {
    const f = input.files?.[0];
    if (f) loadOpened({ path: f.name, text: await f.text() });
  };
  input.click();
}

export async function saveFlow(saveAs = false) {
  const { name, filePath } = useFlow.getState();
  const text = serialize();
  if (desktop) {
    try {
      const saved = await desktop.saveFlow(text, saveAs ? null : filePath, name || 'flow');
      if (saved) markSaved(saved);
    } catch (err) {
      fail(`Could not save the file: ${err instanceof Error ? err.message : err}`);
    }
    return;
  }
  // Browser fallback (development only): download the file.
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = `${(name || 'flow').replace(/[^\w-]+/g, '-').toLowerCase()}.physflow`;
  a.click();
  URL.revokeObjectURL(a.href);
  markSaved(filePath);
}
