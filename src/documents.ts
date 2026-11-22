/**
 * Document commands shared by the toolbars and the native menu:
 * New, Open, Save, Save As for both document kinds, plus data export.
 */
import { desktop, type DocExt, type OpenedFile } from './desktop';
import { currentDoc, markSaved, useFlow } from './flow/store';
import { createHistory, type History } from './history';
import type { FlowDoc } from './flow/types';
import { useNav } from './nav';
import { saveFile } from './saveFile';
import { APP_VERSION, FILE_FORMAT } from './version';
import { blankModel, isModel, markSimSaved, useSim } from './sim/store';

export type DocKind = 'sim' | 'flow';

const KINDS = {
  sim: {
    ext: 'physsim' as DocExt,
    noun: 'simulation',
    state: () => useSim.getState(),
    name: () => useSim.getState().model.name,
    hasContent: () => true,
    serialize: () => JSON.stringify({ format: FILE_FORMAT, app: APP_VERSION, ...useSim.getState().model }, null, 2),
    mark: markSimSaved,
    fail: (notice: string) => useSim.setState({ notice }),
  },
  flow: {
    ext: 'physflow' as DocExt,
    noun: 'flow',
    state: () => useFlow.getState(),
    name: () => useFlow.getState().name,
    hasContent: () => useFlow.getState().nodes.length > 0,
    serialize: () => JSON.stringify({ format: FILE_FORMAT, app: APP_VERSION, ...currentDoc() }, null, 2),
    mark: markSaved,
    fail: (notice: string) => useFlow.setState({ notice }),
  },
};

// Undo history per document. Selection and file state are deliberately not part of it.
const histories: Record<DocKind, History> = {
  sim: createHistory({
    id: 'sim',
    get: () => useSim.getState().model,
    set: (model) => useSim.setState({ model }),
    subscribe: (fn) => { useSim.subscribe((s, prev) => { if (s.model !== prev.model) fn(); }); },
  }),
  flow: createHistory({
    id: 'flow',
    get: currentDoc,
    set: (doc) => useFlow.setState({ name: doc.name, description: doc.description, nodes: doc.nodes, edges: doc.edges, model: doc.model, selectedId: null }),
    subscribe: (fn) => { useFlow.subscribe((s, prev) => { if (s.nodes !== prev.nodes || s.edges !== prev.edges || s.name !== prev.name || s.description !== prev.description || s.model !== prev.model) fn(); }); },
  }),
};
export const historyFor = (kind: DocKind): History => histories[kind];

/**
 * Undo or redo. While typing in a field the field's own undo applies (as users
 * expect); otherwise the command acts on the document in view.
 */
export function undoRedo(direction: 'undo' | 'redo') {
  const el = document.activeElement;
  if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && /^(text|search|)$/.test(el.type))) {
    document.execCommand(direction);
    return;
  }
  const kind = activeKind();
  if (kind) histories[kind][direction]();
}

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
  // Files record the format they were written in, so a newer file is refused clearly instead of half-loading.
  const format = (data as { format?: unknown })?.format;
  if (typeof format === 'number' && format > FILE_FORMAT) {
    return KINDS[active].fail(`“${baseName(file.path)}” was saved by a newer version of Physics Tooling (file format ${format}; this version reads up to ${FILE_FORMAT}). Update the app to open it.`);
  }
  // Migrations by format. 1 → 2: simulations gained an optional `uncertainty` analysis; older files load unchanged.
  if (isModel(data)) {
    if (!confirmDiscard('sim')) return;
    const { format: _f, app: _a, ...model } = data as typeof data & { format?: number; app?: string };
    useSim.getState().load(model as typeof data);
    markSimSaved(file.path);
    histories.sim.reset();
    useNav.getState().setTab('sim');
  } else if (data && Array.isArray((data as FlowDoc).nodes) && Array.isArray((data as FlowDoc).edges)) {
    if (!confirmDiscard('flow')) return;
    useFlow.getState().load(data as FlowDoc);
    markSaved(file.path);
    histories.flow.reset();
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
  histories[kind].reset();
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
  const saved = await saveFile(text, suggestedName, 'csv');
  return saved ? `Exported to ${saved}` : '';
}

/** Save a generated script through the Save dialog (or as a download in the browser). */
export async function exportScript(text: string, suggestedName: string, ext: 'py' | 'm' | 'wl' | 'jl'): Promise<string> {
  const saved = await saveFile(text, suggestedName, ext);
  return saved ? `Saved ${saved}` : '';
}

/** The document kind the File menu acts on for the current workspace. */
export const activeKind = (): DocKind | null => {
  const tab = useNav.getState().tab;
  return tab === 'math' ? null : tab;
};

/** Pick a data table to import. Resolves to its name and text, or null if cancelled. */
export async function importData(): Promise<OpenedFile | null> {
  if (desktop) return desktop.importData();
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.tsv,.txt,.dat,text/csv,text/plain';
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { path: f.name, text: await f.text() } : null);
    };
    input.click();
  });
}

/** Names of the documents with unsaved changes, for the close prompt. */
export const dirtyDocuments = (): { kind: DocKind; name: string }[] =>
  (['sim', 'flow'] as const)
    .filter((k) => KINDS[k].state().dirty && KINDS[k].hasContent())
    .map((kind) => ({ kind, name: `“${baseName(KINDS[kind].state().filePath ?? '') || KINDS[kind].name() || `untitled ${KINDS[kind].noun}`}”` }));

/** Save every dirty document; true when nothing is left unsaved (i.e. no dialog was cancelled). */
export async function saveAllDirty(): Promise<boolean> {
  for (const { kind } of dirtyDocuments()) {
    useNav.getState().setTab(kind);
    await saveDocument(kind);
    if (KINDS[kind].state().dirty) return false;
  }
  return true;
}
