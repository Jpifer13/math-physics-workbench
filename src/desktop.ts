/** Typed view of the API the desktop shell injects (see electron/preload.cjs). */
export interface OpenedFile {
  path: string;
  text: string;
}
export type MenuAction = 'new:sim' | 'new:flow' | 'open' | 'save' | 'saveAs' | 'saveAllAndClose' | 'undo' | 'redo' | 'tab:sim' | 'tab:flow' | 'tab:math' | 'tab:scratch';
export type DocExt = 'physsim' | 'physflow';

export type ExportExt = 'csv' | 'json' | 'svg' | 'png' | 'py' | 'm' | 'wl' | 'jl';

/** A separately installed program that can run generated scripts. */
export interface EngineInfo {
  id: string;
  name: string;
  path: string | null;
  custom: boolean;
}

export interface DesktopApi {
  platform: string;
  openDocument(): Promise<OpenedFile | null>;
  saveDocument(text: string, filePath: string | null, suggestedName: string, ext: DocExt): Promise<string | null>;
  exportFile(text: string, suggestedName: string, ext: ExportExt, encoding?: 'utf8' | 'base64'): Promise<string | null>;
  listEngines(): Promise<EngineInfo[]>;
  locateEngine(id: string): Promise<string | null>;
  runEngine(id: string, code: string): Promise<{ ok: boolean; csv?: string; log: string; ms?: number; program?: string }>;
  importData(): Promise<OpenedFile | null>;
  setDirty(names: string[]): void;
  closeWindow(): void;
  onMenu(cb: (action: MenuAction) => void): () => void;
  onFileOpened(cb: (file: OpenedFile) => void): () => void;
  ready(): void;
}

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

/** Undefined when the UI is running in a plain browser during development. */
export const desktop: DesktopApi | undefined = typeof window !== 'undefined' ? window.desktop : undefined;
