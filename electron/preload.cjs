/** The only bridge between the sandboxed UI and the desktop shell. */
const { contextBridge, ipcRenderer } = require('electron');

const subscribe = (channel) => (callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  /** Started with --skip-tour: the first-launch walkthrough stays closed (automated runs). */
  skipTour: process.argv.includes('--skip-tour'),
  /** Show the Open dialog. Resolves to { path, text } or null if cancelled. */
  openDocument: () => ipcRenderer.invoke('doc:open'),
  /** Write a document ('physsim' | 'physflow'). With no path the Save dialog is shown. Resolves to the path, or null. */
  saveDocument: (text, filePath, suggestedName, ext) => ipcRenderer.invoke('doc:save', text, filePath, suggestedName, ext),
  /** Export data (e.g. CSV) through a Save dialog. Resolves to the path, or null. */
  exportFile: (text, suggestedName, ext, encoding) => ipcRenderer.invoke('export:save', text, suggestedName, ext, encoding),
  /** Write an SVG figure as a one-page PDF of the given size (mm) through a Save dialog. Resolves to the path, or null. */
  exportPdf: (svg, widthMm, heightMm, suggestedName) => ipcRenderer.invoke('export:pdf', svg, widthMm, heightMm, suggestedName),
  /** Other scientific software installed on this computer: [{ id, name, path, custom }]. */
  listEngines: () => ipcRenderer.invoke('engine:list'),
  /** Ask the user where a program lives. Resolves to the chosen path, or null. */
  locateEngine: (id) => ipcRenderer.invoke('engine:locate', id),
  /** Run a generated script in an installed program. Resolves to { ok, csv?, log, ms? }. */
  runEngine: (id, code) => ipcRenderer.invoke('engine:run', id, code),
  /** Pick a data table (CSV etc.) to import. Resolves to { path, text } or null. */
  importData: () => ipcRenderer.invoke('import:open'),
  /** Report which documents have unsaved changes, so closing the window can ask first. */
  setDirty: (names) => ipcRenderer.send('doc:dirty', names),
  /** Have the title bar, menus and dialogs follow the appearance chosen in the app: 'system' | 'light' | 'dark'. */
  setTheme: (choice) => ipcRenderer.send('theme:set', choice),
  /** Close the window without asking again (after the user chose Save). */
  closeWindow: () => ipcRenderer.send('app:close'),
  /** Menu commands: 'new:sim' | 'new:flow' | 'open' | 'save' | 'saveAs' | 'compare' | 'tour' | 'saveAllAndClose' | 'undo' | 'redo' | 'tab:sim' | 'tab:flow' | 'tab:math'. */
  onMenu: subscribe('menu'),
  /** A document opened from the operating system (double-click, "Open with"). */
  onFileOpened: subscribe('file:opened'),
  /** Tell the shell the UI is listening, so any pending file can be delivered. */
  ready: () => ipcRenderer.send('app:ready'),
});
