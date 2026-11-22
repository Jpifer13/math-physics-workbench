/**
 * Document commands shared by the toolbars and the native menu:
 * New, Open, Save, Save As for both document kinds, plus data export.
 */
import { APP_NAME } from './core/brand';
import { create } from 'zustand';
import { diffFlow, diffSim, flowFile, readDocument, simFile, type Change, type FlowFile } from './core/docfile';
import { simulate, type OdeModel } from './core/ode';
import { desktop, type DocExt, type OpenedFile } from './desktop';
import { currentDoc, markSaved, useFlow } from './flow/store';
import { createHistory, type History } from './history';
import type { FlowDoc } from './flow/types';
import { useNav } from './nav';
import { saveFile } from './saveFile';
import { APP_VERSION, FILE_FORMAT } from './version';
import { blankModel, markSimSaved, normalizeModel, useSim } from './sim/store';

export type DocKind = 'sim' | 'flow';

const KINDS = {
  sim: {
    ext: 'physsim' as DocExt,
    noun: 'simulation',
    state: () => useSim.getState(),
    name: () => useSim.getState().model.name,
    hasContent: () => true,
    serialize: () => simFile(useSim.getState().model, FILE_FORMAT, APP_VERSION),
    mark: markSimSaved,
    fail: (notice: string) => useSim.setState({ notice }),
  },
  flow: {
    ext: 'physflow' as DocExt,
    noun: 'flow',
    state: () => useFlow.getState(),
    name: () => useFlow.getState().name,
    hasContent: () => useFlow.getState().nodes.length > 0,
    serialize: () => flowFile(currentDoc(), FILE_FORMAT, APP_VERSION),
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

/** Why a file could not be read, in the user's terms; '' when it could. */
function unreadable(file: OpenedFile, r: ReturnType<typeof readDocument>): string {
  if (r.kind === 'newer') return `“${baseName(file.path)}” was saved by a newer version of ${APP_NAME} (file format ${r.format}; this version reads up to ${FILE_FORMAT}). Update the app to open it.`;
  return r.kind === 'unknown' ? `“${baseName(file.path)}” is not a ${APP_NAME} document.` : '';
}

/** Load a file's contents into whichever workspace it belongs to. */
export function loadOpened(file: OpenedFile) {
  const active: DocKind = useNav.getState().tab === 'flow' ? 'flow' : 'sim';
  const r = readDocument(file.text, FILE_FORMAT);
  if (r.kind === 'sim') {
    if (!confirmDiscard('sim')) return;
    useSim.getState().load(r.model);
    markSimSaved(file.path);
    histories.sim.reset();
    useNav.getState().setTab('sim');
  } else if (r.kind === 'flow') {
    if (!confirmDiscard('flow')) return;
    useFlow.getState().load(r.flow as FlowDoc);
    markSaved(file.path);
    histories.flow.reset();
    useNav.getState().setTab('flow');
  } else {
    KINDS[active].fail(unreadable(file, r));
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

/** Ask for a document file without loading it. Resolves to null if the user cancels. */
async function pickDocument(): Promise<OpenedFile | null> {
  if (desktop) return desktop.openDocument();
  // Browser fallback (development only): a file picker.
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.physsim,.physflow,.json,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { path: f.name, text: await f.text() } : null);
    };
    input.click();
  });
}

export async function openDocument() {
  try {
    const file = await pickDocument();
    if (file) loadOpened(file);
  } catch (err) {
    KINDS.sim.fail(`Could not open the file: ${message(err)}`);
  }
}

// ---------------------------------------------------------------- comparing

export interface Comparison {
  kind: DocKind;
  /** Name of the file the open document is compared with. */
  fileName: string;
  /** From the file to the open document. */
  changes: Change[];
  /** The file's simulation, so its run can be held as a reference. */
  model?: OdeModel;
}

/** The comparison on show, if any. */
export const useCompare = create<{ comparison: Comparison | null; close: () => void }>((set) => ({
  comparison: null,
  close: () => set({ comparison: null }),
}));

/** Pick a file and list what differs between it and the open document of the same kind. */
export async function compareWithFile() {
  const active: DocKind = useNav.getState().tab === 'flow' ? 'flow' : 'sim';
  try {
    const file = await pickDocument();
    if (!file) return;
    const r = readDocument(file.text, FILE_FORMAT);
    const fileName = baseName(file.path);
    if (r.kind === 'sim') {
      const model = normalizeModel(r.model);
      useNav.getState().setTab('sim');
      useCompare.setState({ comparison: { kind: 'sim', fileName, changes: diffSim(model, useSim.getState().model), model } });
    } else if (r.kind === 'flow') {
      useNav.getState().setTab('flow');
      useCompare.setState({ comparison: { kind: 'flow', fileName, changes: diffFlow(r.flow, currentDoc() as FlowFile) } });
    } else {
      KINDS[active].fail(unreadable(file, r));
    }
  } catch (err) {
    KINDS[active].fail(`Could not open the file: ${message(err)}`);
  }
}

/** Show the compared file's run as the dashed reference on every chart of the Run view. */
export function holdComparedRun() {
  const c = useCompare.getState().comparison;
  if (c?.model) useSim.getState().setReference({ run: simulate(c.model), label: `from ${c.fileName}` });
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
