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
  openFlow: () => ipcRenderer.invoke('flow:open'),
  /** Write a flow. With no path (or "Save As") the Save dialog is shown. Resolves to the path, or null if cancelled. */
  saveFlow: (text, filePath, suggestedName) => ipcRenderer.invoke('flow:save', text, filePath, suggestedName),
  /** Menu commands: 'new' | 'open' | 'save' | 'saveAs' | 'tab:flow' | 'tab:sim' | 'tab:math'. */
  onMenu: subscribe('menu'),
  /** A flow file opened from the operating system (double-click, "Open with"). */
  onFileOpened: subscribe('file:opened'),
  /** Tell the shell the UI is listening, so any pending file can be delivered. */
  ready: () => ipcRenderer.send('app:ready'),
});
