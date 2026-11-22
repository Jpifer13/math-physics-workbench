/**
 * Desktop shell: owns the window, the native menu and all file access.
 * The UI (renderer) is sandboxed and can only reach the disk through the
 * narrow, dialog-gated API exposed in preload.cjs.
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const isMac = process.platform === 'darwin';
const DOC_TYPES = {
  physsim: { name: 'Physics simulation', extensions: ['physsim'] },
  physflow: { name: 'Physics equation flow', extensions: ['physflow'] },
  csv: { name: 'Comma-separated values', extensions: ['csv'] },
};
const OPEN_FILTERS = [
  { name: 'Physics Tooling documents', extensions: ['physsim', 'physflow', 'json'] },
  { name: 'All files', extensions: ['*'] },
];
const safeName = (name, fallback) => String(name || fallback).replace(/[\\/:*?"<>|]+/g, '-');

/** @type {BrowserWindow | null} */
let win = null;
let rendererReady = false;
/** A flow file the OS asked us to open before the window was ready. */
let pendingFile = null;
/** Only paths the user picked in a dialog (or opened from the OS) may be written. */
const approvedPaths = new Set();

// ------------------------------------------------------------ window state
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (Number.isFinite(s.width) && Number.isFinite(s.height)) return s;
  } catch {
    /* first launch */
  }
  return { width: 1440, height: 900 };
}
function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  try {
    fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch {
    /* not worth interrupting quit for */
  }
}

// ------------------------------------------------------------------- files
function readDoc(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  approvedPaths.add(filePath);
  app.addRecentDocument(filePath);
  return { path: filePath, text };
}

function deliverFile(filePath) {
  if (!win || !rendererReady) {
    pendingFile = filePath;
    return;
  }
  try {
    win.webContents.send('file:opened', readDoc(filePath));
  } catch (err) {
    dialog.showErrorBox('Could not open file', String(err.message || err));
  }
}

const docArg = (argv) => argv.slice(1).find((a) => /\.(physsim|physflow|json)$/i.test(a) && fs.existsSync(a));

ipcMain.handle('doc:open', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Open', properties: ['openFile'], filters: OPEN_FILTERS });
  if (r.canceled || !r.filePaths[0]) return null;
  return readDoc(r.filePaths[0]);
});

ipcMain.handle('doc:save', async (_e, text, filePath, suggestedName, ext) => {
  if (typeof text !== 'string') throw new Error('Nothing to save');
  const type = DOC_TYPES[ext];
  if (!type || ext === 'csv') throw new Error('Unknown document type');
  let target = typeof filePath === 'string' && approvedPaths.has(filePath) ? filePath : null;
  if (!target) {
    const r = await dialog.showSaveDialog(win, {
      title: 'Save',
      defaultPath: `${safeName(suggestedName, 'untitled')}.${ext}`,
      filters: [type, { name: 'All files', extensions: ['*'] }],
    });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
  }
  await fs.promises.writeFile(target, text, 'utf8');
  approvedPaths.add(target);
  app.addRecentDocument(target);
  return target;
});

// Measured data to compare a model against. Read-only: the path is never written to.
ipcMain.handle('import:open', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Import data',
    properties: ['openFile'],
    filters: [{ name: 'Data tables', extensions: ['csv', 'tsv', 'txt', 'dat'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const stat = fs.statSync(r.filePaths[0]);
  if (stat.size > 50 * 1024 * 1024) throw new Error('That file is larger than 50 MB');
  return { path: r.filePaths[0], text: fs.readFileSync(r.filePaths[0], 'utf8') };
});

// Data exports always go through a Save dialog; they are never tied to an open document.
ipcMain.handle('export:save', async (_e, text, suggestedName, ext) => {
  if (typeof text !== 'string') throw new Error('Nothing to export');
  const type = DOC_TYPES[ext] ?? DOC_TYPES.csv;
  const r = await dialog.showSaveDialog(win, {
    title: 'Export data',
    defaultPath: `${safeName(suggestedName, 'data')}.${type.extensions[0]}`,
    filters: [type],
  });
  if (r.canceled || !r.filePath) return null;
  await fs.promises.writeFile(r.filePath, text, 'utf8');
  return r.filePath;
});

// Unsaved-changes guard: the UI reports which documents are dirty; closing asks first.
let dirtyDocs = [];
let closeConfirmed = false;
ipcMain.on('doc:dirty', (_e, names) => { dirtyDocs = Array.isArray(names) ? names.map(String) : []; });
ipcMain.on('app:close', () => {
  closeConfirmed = true;
  win?.close();
});

ipcMain.on('app:ready', () => {
  rendererReady = true;
  if (pendingFile) {
    const f = pendingFile;
    pendingFile = null;
    deliverFile(f);
  }
});

// -------------------------------------------------------------------- menu
const send = (action) => () => win?.webContents.send('menu', action);

function buildMenu() {
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '&File',
      submenu: [
        { label: 'New Simulation', accelerator: 'CmdOrCtrl+N', click: send('new:sim') },
        { label: 'New Equation Flow', accelerator: 'CmdOrCtrl+Shift+N', click: send('new:flow') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: send('open') },
        ...(isMac ? [{ role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] }] : []),
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: send('saveAs') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        // Routed through the UI: it undoes text while typing in a field, and the document otherwise.
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
        { label: 'Redo', accelerator: isMac ? 'Shift+Cmd+Z' : 'CmdOrCtrl+Y', click: send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '&View',
      submenu: [
        { label: 'Simulations', accelerator: 'CmdOrCtrl+1', click: send('tab:sim') },
        { label: 'Equation Flows', accelerator: 'CmdOrCtrl+2', click: send('tab:flow') },
        { label: 'Math Tools', accelerator: 'CmdOrCtrl+3', click: send('tab:math') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(DEV_URL ? [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] : []),
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'About Physics Tooling',
          click: () =>
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'About Physics Tooling',
              message: 'Physics Tooling',
              detail: `Version ${app.getVersion()}\nA virtual laboratory for building simulations and running numerical experiments.`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ------------------------------------------------------------------ window
function createWindow() {
  const state = loadWindowState();
  rendererReady = false;
  win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: '#f3f2f1',
    title: 'Physics Tooling',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  closeConfirmed = false;
  win.on('close', (e) => {
    if (!closeConfirmed && dirtyDocs.length) {
      e.preventDefault();
      const choice = dialog.showMessageBoxSync(win, {
        type: 'warning',
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        message: `Save changes to ${dirtyDocs.join(' and ')}?`,
        detail: "Your changes will be lost if you don't save them.",
      });
      if (choice === 0) win.webContents.send('menu', 'saveAllAndClose');
      else if (choice === 1) {
        closeConfirmed = true;
        win.close();
      }
      return;
    }
    saveWindowState();
  });
  win.on('closed', () => { win = null; dirtyDocs = []; });

  // The window only ever shows the app itself; links open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (DEV_URL ? !url.startsWith(DEV_URL) : !url.startsWith('file:')) e.preventDefault();
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const f = docArg(argv);
    if (f) deliverFile(f);
  });
  // macOS: a flow file was double-clicked or dropped on the dock icon.
  app.on('open-file', (e, filePath) => {
    e.preventDefault();
    if (app.isReady() && !win) createWindow();
    deliverFile(filePath);
  });
  app.whenReady().then(() => {
    pendingFile = pendingFile ?? docArg(process.argv) ?? null;
    buildMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
}
