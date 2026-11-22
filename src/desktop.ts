/** Typed view of the API the desktop shell injects (see electron/preload.cjs). */
export interface OpenedFile {
  path: string;
  text: string;
}
export type MenuAction = 'new' | 'open' | 'save' | 'saveAs' | 'tab:flow' | 'tab:sim' | 'tab:math';

export interface DesktopApi {
  platform: string;
  openFlow(): Promise<OpenedFile | null>;
  saveFlow(text: string, filePath: string | null, suggestedName: string): Promise<string | null>;
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
