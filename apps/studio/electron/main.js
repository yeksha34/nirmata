// Electron shell for the Story Editor. Doesn't reimplement anything —
// spawns the same tools/story_editor/server.mjs as a child process and
// points a BrowserWindow at it, same as opening it in a normal browser
// tab. What this adds over that: a real window (no browser chrome/tabs to
// lose track of), a proper system-tray icon with Show/Quit (replacing the
// earlier PowerShell tray.ps1 hack), and closing the window doesn't leave
// the server running behind you — it's tied to app lifecycle.
const { app, BrowserWindow, Tray, Menu, shell, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');

const PORT = 8787;
const URL = `http://localhost:${PORT}/`;
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SERVER_SCRIPT = path.resolve(__dirname, '..', 'server.mjs');

let serverProc = null;
let mainWindow = null;
let tray = null;
let quitting = false;

function startServer() {
  serverProc = spawn(process.platform === 'win32' ? 'node.exe' : 'node', [SERVER_SCRIPT, '--port', String(PORT)], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
  });
  serverProc.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  serverProc.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  serverProc.on('exit', (code) => {
    if (!quitting) console.error(`Story Editor server exited unexpectedly (code ${code})`);
  });
}

function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(URL, (res) => { res.resume(); resolve(); });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) return reject(new Error('server did not come up in time'));
        setTimeout(tryOnce, 250);
      });
    };
    tryOnce();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Story Editor',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    // No native title bar/border at all -- the page draws its own header
    // (see index.html's <header>) and supplies its own drag region +
    // minimize/close buttons via the preload bridge below, so removing the
    // OS chrome doesn't leave the window unmovable or unclosable.
    frame: false,
    // A real straight rectangle is exactly what shouldn't be visible as
    // the window's edge -- the vine art (see #vine-frame in index.html) is
    // meant to *be* the frame, irregular gaps and all, with nothing behind
    // it. That only reads correctly if the window itself is transparent:
    // the page keeps its own opaque background on an inset content panel
    // (see index.html's body padding), and the margin around it -- where
    // the vine border-image actually lives -- is true window transparency,
    // not a dark rectangle with a vine drawn on top of it.
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow.loadURL(URL);
  // External links (e.g. anything that isn't localhost) open in the real
  // browser instead of navigating this window away from the tool.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(URL)) { shell.openExternal(url); return { action: 'deny' }; }
    // Same-origin popups (Storyboard/Read the story, both target="_blank")
    // get the frameless treatment too -- otherwise they'd pop up with a
    // native title bar despite the main window having none, which would
    // read as a bug rather than a deliberate choice.
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        icon: path.join(__dirname, 'icon.png'),
        webPreferences: { contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
      },
    };
  });
  mainWindow.on('close', (e) => {
    if (!quitting) {
      // Closing the window just hides it to tray (matches "hide to
      // notifications") -- Quit from the tray menu is what actually stops
      // the server and exits.
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'icon.png'));
  tray.setToolTip(`Story Editor (localhost:${PORT})`);
  const menu = Menu.buildFromTemplate([
    { label: 'Open Story Editor', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
}

// Window controls the OS title bar used to supply -- the page's own header
// buttons (see the preload bridge) call these over IPC instead. Resolved
// from the *sending* webContents, not the stored mainWindow, so a
// same-origin popup (storyboard/reader, also frameless — see
// setWindowOpenHandler) controls itself rather than the main window.
const windowOf = (event) => BrowserWindow.fromWebContents(event.sender);
ipcMain.on('window:minimize', (e) => windowOf(e)?.minimize());
ipcMain.on('window:close', (e) => windowOf(e)?.close());
ipcMain.handle('window:isMaximized', (e) => !!windowOf(e)?.isMaximized());
ipcMain.on('window:toggleMaximize', (e) => {
  const w = windowOf(e);
  if (!w) return;
  if (w.isMaximized()) w.unmaximize(); else w.maximize();
});

app.whenReady().then(async () => {
  startServer();
  try {
    await waitForServer();
  } catch (e) {
    console.error(e.message);
  }
  createWindow();
  createTray();
});

app.on('before-quit', () => {
  quitting = true;
  if (serverProc && !serverProc.killed) serverProc.kill();
});

app.on('window-all-closed', () => {
  // Tray-resident app -- don't quit just because the window closed (it's
  // hidden, not closed, per the close handler above, but keep this as a
  // safety net for platforms without a real tray).
});
