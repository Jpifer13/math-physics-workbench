/** Typed view of the API the desktop shell injects (see electron/preload.cjs). */
export interface OpenedFile {
  path: string;
  text: string;
}
export type MenuAction = 'new:sim' | 'new:flow' | 'open' | 'save' | 'saveAs' | 'saveAllAndClose' | 'tab:sim' | 'tab:flow' | 'tab:math';
export type DocExt = 'physsim' | 'physflow';

export interface DesktopApi {
  platform: string;
  openDocument(): Promise<OpenedFile | null>;
  saveDocument(text: string, filePath: string | null, suggestedName: string, ext: DocExt): Promise<string | null>;
  exportFile(text: string, suggestedName: string, ext: 'csv'): Promise<string | null>;
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
