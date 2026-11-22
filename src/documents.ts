/**
 * Document commands shared by the toolbars and the native menu:
 * New, Open, Save, Save As for both document kinds, plus data export.
 */
import { desktop, type DocExt, type OpenedFile } from './desktop';
import { currentDoc, markSaved, useFlow } from './flow/store';
import type { FlowDoc } from './flow/types';
import { useNav } from './nav';
import { blankModel, isModel, markSimSaved, useSim } from './sim/store';

export type DocKind = 'sim' | 'flow';

const KINDS = {
  sim: {
    ext: 'physsim' as DocExt,
    noun: 'simulation',
    state: () => useSim.getState(),
    name: () => useSim.getState().model.name,
    hasContent: () => true,
    serialize: () => JSON.stringify(useSim.getState().model, null, 2),
    mark: markSimSaved,
    fail: (notice: string) => useSim.setState({ notice }),
  },
  flow: {
    ext: 'physflow' as DocExt,
    noun: 'flow',
    state: () => useFlow.getState(),
    name: () => useFlow.getState().name,
    hasContent: () => useFlow.getState().nodes.length > 0,
    serialize: () => JSON.stringify(currentDoc(), null, 2),
    mark: markSaved,
    fail: (notice: string) => useFlow.setState({ notice }),
  },
};

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Ask before throwing away unsaved work in a workspace. */
export function confirmDiscard(kind: DocKind): boolean {
  const k = KINDS[kind];
  return !k.state().dirty || !k.hasContent() || confirm(`This ${k.noun} has unsaved changes. Discard them?`);
}

/** Load a file's contents into whichever workspace it belongs to. */
export function loadOpened(file: OpenedFile) {
  const active: DocKind = useNav.getState().tab === 'flow' ? 'flow' : 'sim';
  let data: unknown;
  try {
    data = JSON.parse(file.text);
  } catch {
    return KINDS[active].fail(`“${baseName(file.path)}” is not a Physics Tooling document.`);
  }
  if (isModel(data)) {
    if (!confirmDiscard('sim')) return;
    useSim.getState().load(data);
    markSimSaved(file.path);
    useNav.getState().setTab('sim');
  } else if (data && Array.isArray((data as FlowDoc).nodes) && Array.isArray((data as FlowDoc).edges)) {
    if (!confirmDiscard('flow')) return;
    useFlow.getState().load(data as FlowDoc);
    markSaved(file.path);
    useNav.getState().setTab('flow');
  } else {
    KINDS[active].fail(`“${baseName(file.path)}” is not a Physics Tooling document.`);
  }
}

export function newDocument(kind: DocKind) {
  if (!confirmDiscard(kind)) return;
  if (kind === 'sim') useSim.getState().load(blankModel());
  else useFlow.getState().clear();
  KINDS[kind].mark(null);
  useNav.getState().setTab(kind);
}

export async function openDocument() {
  if (desktop) {
    try {
      const file = await desktop.openDocument();
      if (file) loadOpened(file);
    } catch (err) {
      KINDS.sim.fail(`Could not open the file: ${message(err)}`);
    }
    return;
  }
  // Browser fallback (development only): a file picker.
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.physsim,.physflow,.json,application/json';
  input.onchange = async () => {
    const f = input.files?.[0];
    if (f) loadOpened({ path: f.name, text: await f.text() });
  };
  input.click();
}

function download(text: string, fileName: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function saveDocument(kind: DocKind, saveAs = false) {
  const k = KINDS[kind];
  const text = k.serialize();
  const filePath = k.state().filePath;
  if (desktop) {
    try {
      const saved = await desktop.saveDocument(text, saveAs ? null : filePath, k.name() || 'untitled', k.ext);
      if (saved) k.mark(saved);
    } catch (err) {
      k.fail(`Could not save the file: ${message(err)}`);
    }
    return;
  }
  download(text, `${(k.name() || 'untitled').replace(/[^\w-]+/g, '-').toLowerCase()}.${k.ext}`, 'application/json');
  k.mark(filePath);
}

/** Export tabular data as CSV. Resolves to a short confirmation, or '' if cancelled. */
export async function exportCsv(text: string, suggestedName: string): Promise<string> {
  const name = suggestedName.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'data';
  if (desktop) {
    const saved = await desktop.exportFile(text, name, 'csv');
    return saved ? `Exported to ${baseName(saved)}` : '';
  }
  download(text, `${name}.csv`, 'text/csv');
  return 'Exported';
}

/** The document kind the File menu acts on for the current workspace. */
export const activeKind = (): DocKind | null => {
  const tab = useNav.getState().tab;
  return tab === 'math' ? null : tab;
};
