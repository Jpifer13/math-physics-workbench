/**
 * Desktop shell: owns the window, the native menu and all file access.
 * The UI (renderer) is sandboxed and can only reach the disk through the
 * narrow, dialog-gated API exposed in preload.cjs.
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { migrateUserData } = require('./migrate.cjs');

/** The program's name, from package.json (productName). */
const APP_NAME = app.getName();
// On Windows and Linux an ampersand in a menu label marks a keyboard shortcut; doubling it shows one.
const menuLabel = (text) => (process.platform === 'darwin' ? text : text.replace(/&/g, '&&'));

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const isMac = process.platform === 'darwin';
const DOC_TYPES = {
  physsim: { name: 'Physics simulation', extensions: ['physsim'] },
  physflow: { name: 'Physics equation flow', extensions: ['physflow'] },
  csv: { name: 'Comma-separated values', extensions: ['csv'] },
  json: { name: 'JSON', extensions: ['json'] },
  svg: { name: 'SVG vector image', extensions: ['svg'] },
  png: { name: 'PNG image', extensions: ['png'] },
  pdf: { name: 'PDF document', extensions: ['pdf'] },
  py: { name: 'Python script', extensions: ['py'] },
  m: { name: 'MATLAB / Octave script', extensions: ['m'] },
  wl: { name: 'Wolfram Language script', extensions: ['wl'] },
  jl: { name: 'Julia script', extensions: ['jl'] },
};
const OPEN_FILTERS = [
  { name: `${APP_NAME} documents`, extensions: ['physsim', 'physflow', 'json'] },
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
  if (!type || !['physsim', 'physflow'].includes(ext)) throw new Error('Unknown document type');
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
ipcMain.handle('export:save', async (_e, text, suggestedName, ext, encoding) => {
  if (typeof text !== 'string') throw new Error('Nothing to export');
  const type = DOC_TYPES[ext] ?? DOC_TYPES.csv;
  const r = await dialog.showSaveDialog(win, {
    title: 'Export',
    defaultPath: `${safeName(suggestedName, 'data')}.${type.extensions[0]}`,
    filters: [type],
  });
  if (r.canceled || !r.filePath) return null;
  await fs.promises.writeFile(r.filePath, text, encoding === 'base64' ? 'base64' : 'utf8');
  return r.filePath;
});

// A figure as a PDF: the SVG is laid on a page of exactly its own size in a hidden window and printed.
// The window runs no scripts and may load nothing but the images embedded in the figure.
ipcMain.handle('export:pdf', async (_e, svg, widthMm, heightMm, suggestedName) => {
  if (typeof svg !== 'string' || !(widthMm > 0) || !(heightMm > 0)) throw new Error('Nothing to export');
  const r = await dialog.showSaveDialog(win, {
    title: 'Export',
    defaultPath: `${safeName(suggestedName, 'figure')}.pdf`,
    filters: [DOC_TYPES.pdf],
  });
  if (r.canceled || !r.filePath) return null;
  const w = Number(widthMm).toFixed(3);
  const h = Number(heightMm).toFixed(3);
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<style>@page { size: ${w}mm ${h}mm; margin: 0 } html, body { margin: 0; width: ${w}mm; height: ${h}mm; overflow: hidden }
body > svg { display: block; width: ${w}mm; height: ${h}mm }</style></head><body>${svg}</body></html>`;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'math-physics-workbench-figure-'));
  const view = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    const page = path.join(dir, 'figure.html');
    await fs.promises.writeFile(page, html, 'utf8');
    await view.loadFile(page);
    const pdf = await view.webContents.printToPDF({
      preferCSSPageSize: true,
      printBackground: true,
      pageSize: { width: widthMm / 25.4, height: heightMm / 25.4 },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    await fs.promises.writeFile(r.filePath, pdf);
  } finally {
    view.destroy();
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
  return r.filePath;
});

// ------------------------------------------------- external engines
// Other scientific software the user has installed. The app never ships or
// requires any of these; it only runs a script it generated, in a scratch folder.
const ENGINES = {
  python: { name: 'Python', commands: ['python3', 'python'], script: 'physics_model.py', args: (f) => [f] },
  octave: { name: 'GNU Octave', commands: ['octave-cli', 'octave'], script: 'physics_model.m', args: (f) => ['--no-gui', '--quiet', f] },
  matlab: { name: 'MATLAB', commands: ['matlab'], script: 'physics_model.m', args: () => ['-batch', 'physics_model'] },
  mathematica: { name: 'Mathematica / Wolfram Engine', commands: ['wolframscript'], script: 'physics_model.wl', args: (f) => ['-file', f, 'result.csv'] },
  julia: { name: 'Julia', commands: ['julia'], script: 'physics_model.jl', args: (f) => [f] },
};
const enginesFile = () => path.join(app.getPath('userData'), 'engines.json');
function customEngines() {
  try {
    const v = JSON.parse(fs.readFileSync(enginesFile(), 'utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
/** Find a program on PATH (plus the usual install locations a GUI app's PATH can miss). */
function findOnPath(command) {
  const extra = process.platform === 'win32' ? [] : ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', path.join(os.homedir(), '.juliaup', 'bin')];
  const dirs = [...String(process.env.PATH || '').split(path.delimiter), ...extra].filter(Boolean);
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, command + ext);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        if (fs.statSync(full).isFile()) return full;
      } catch {
        /* not here */
      }
    }
  }
  return null;
}
function enginePath(id) {
  const custom = customEngines()[id];
  if (typeof custom === 'string' && fs.existsSync(custom)) return { path: custom, custom: true };
  for (const c of ENGINES[id].commands) {
    const found = findOnPath(c);
    if (found) return { path: found, custom: false };
  }
  return { path: null, custom: false };
}

ipcMain.handle('engine:list', () => Object.keys(ENGINES).map((id) => ({ id, name: ENGINES[id].name, ...enginePath(id) })));

ipcMain.handle('engine:locate', async (_e, id) => {
  if (!ENGINES[id]) throw new Error('Unknown program');
  const r = await dialog.showOpenDialog(win, { title: `Locate ${ENGINES[id].name}`, properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  fs.writeFileSync(enginesFile(), JSON.stringify({ ...customEngines(), [id]: r.filePaths[0] }, null, 2));
  return r.filePaths[0];
});

ipcMain.handle('engine:run', (_e, id, code) => new Promise((resolve) => {
  const engine = ENGINES[id];
  const exe = engine ? enginePath(id).path : null;
  if (!engine || typeof code !== 'string') return resolve({ ok: false, log: 'Unknown program' });
  if (!exe) return resolve({ ok: false, log: `${engine.name} was not found on this computer` });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'math-physics-workbench-'));
  const cleanup = () => fs.rm(dir, { recursive: true, force: true }, () => {});
  const started = Date.now();
  fs.writeFileSync(path.join(dir, engine.script), code, 'utf8');
  // No shell: the program is started directly with a fixed argument list.
  execFile(exe, engine.args(engine.script), { cwd: dir, timeout: 5 * 60 * 1000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
    const log = `${stdout || ''}${stderr || ''}`.trim().slice(-4000);
    let csv = null;
    try {
      csv = fs.readFileSync(path.join(dir, 'result.csv'), 'utf8');
    } catch {
      /* the script did not produce a result */
    }
    cleanup();
    if (err && !csv) return resolve({ ok: false, log: log || (err.killed ? 'Timed out after 5 minutes' : String(err.message)) });
    if (!csv) return resolve({ ok: false, log: log || 'The script finished without writing a result' });
    resolve({ ok: true, csv, log, ms: Date.now() - started, program: exe });
  });
}));

// Unsaved-changes guard: the UI reports which documents are dirty; closing asks first.
let dirtyDocs = [];
let closeConfirmed = false;
// Quitting (rather than closing the window) asked for the save prompt, so finish quitting once it is answered.
// Matters on macOS, where closing the last window does not quit the app.
let quitRequested = false;
let quitAfterClose = false;
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
        { label: 'Compare with File…', accelerator: 'CmdOrCtrl+Shift+D', click: send('compare') },
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
          label: menuLabel(`About ${APP_NAME}`),
          click: () =>
            dialog.showMessageBox(win, {
              type: 'info',
              title: `About ${APP_NAME}`,
              message: APP_NAME,
              detail: `Version ${app.getVersion()}\nFor learning and doing math and physics: graph functions, simulate differential equations, run numerical experiments, and fit models to data.\n\nFree software under the GNU Affero General Public License, version 3 or later.`,
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
    title: APP_NAME,
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
    if (!closeConfirmed) quitAfterClose = false;
    if (!closeConfirmed && dirtyDocs.length) {
      e.preventDefault();
      const quitting = quitRequested;
      quitRequested = false;
      const choice = dialog.showMessageBoxSync(win, {
        type: 'warning',
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        message: `Save changes to ${dirtyDocs.join(' and ')}?`,
        detail: "Your changes will be lost if you don't save them.",
      });
      // Cancel, or backing out of the Save dialog, leaves the app running.
      quitAfterClose = quitting && choice !== 2;
      if (choice === 0) win.webContents.send('menu', 'saveAllAndClose');
      else if (choice === 1) {
        closeConfirmed = true;
        win.close();
      }
      return;
    }
    saveWindowState();
  });
  win.on('closed', () => {
    win = null;
    dirtyDocs = [];
    if (quitAfterClose) app.quit();
  });

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

// Command-line mode: `<app> run model.physsim` and the like do their work without a window and exit.
// The commands live in the same bundle that `npm run cli` uses (src/cli); a document path is not a command.
const cliArgs = process.argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('--user-data-dir') && !a.startsWith('--no-sandbox'));
const CLI_COMMANDS = ['run', 'experiment', 'uncertainty', 'check', 'template', 'help', '--help', '--version'];

if (CLI_COMMANDS.includes(cliArgs[0])) {
  app.dock?.hide();
  const bundle = path.join(__dirname, '..', 'dist', 'cli', 'cli.mjs');
  import(require('node:url').pathToFileURL(bundle).href).then(
    (cli) => app.exit(cli.main(cliArgs)),
    (err) => {
      process.stderr.write(`The command-line mode could not start: ${err && err.message ? err.message : err}\n`);
      app.exit(1);
    },
  );
} else if (!app.requestSingleInstanceLock()) {
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
  // The app was renamed; on the first launch under the new name, bring saved state across from the old
  // data folder. Before anything is ready, so the window and its storage open on the migrated copy.
  // Skipped when a data folder was chosen on the command line (tests, portable use).
  if (!app.commandLine.hasSwitch('user-data-dir')) migrateUserData(app.getPath('userData'), app.getPath('appData'));

  app.whenReady().then(() => {
    pendingFile = pendingFile ?? docArg(process.argv) ?? null;
    buildMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('before-quit', () => { quitRequested = true; });
  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
}
