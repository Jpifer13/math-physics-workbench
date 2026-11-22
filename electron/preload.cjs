/** The only bridge between the sandboxed UI and the desktop shell. */
const { contextBridge, ipcRenderer } = require('electron');

const subscribe = (channel) => (callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  /** Show the Open dialog. Resolves to { path, text } or null if cancelled. */
  openDocument: () => ipcRenderer.invoke('doc:open'),
  /** Write a document ('physsim' | 'physflow'). With no path the Save dialog is shown. Resolves to the path, or null. */
  saveDocument: (text, filePath, suggestedName, ext) => ipcRenderer.invoke('doc:save', text, filePath, suggestedName, ext),
  /** Export data (e.g. CSV) through a Save dialog. Resolves to the path, or null. */
  exportFile: (text, suggestedName, ext) => ipcRenderer.invoke('export:save', text, suggestedName, ext),
  /** Menu commands: 'new:sim' | 'new:flow' | 'open' | 'save' | 'saveAs' | 'tab:sim' | 'tab:flow' | 'tab:math'. */
  onMenu: subscribe('menu'),
  /** A document opened from the operating system (double-click, "Open with"). */
  onFileOpened: subscribe('file:opened'),
  /** Tell the shell the UI is listening, so any pending file can be delivered. */
  ready: () => ipcRenderer.send('app:ready'),
});
