// Seed Finder desktop app: serves web/ through a privileged app:// scheme
// (so WebAssembly + module workers work) and checks GitHub Releases for
// updates every time it starts.
const { app, BrowserWindow, protocol, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

const WEB = path.join(__dirname, '..', 'web');
const SMOKE = !!process.env.SF_SMOKE_TEST; // CI/dev: load, report errors, quit

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

if (!SMOKE && !app.requestSingleInstanceLock()) app.quit();

let win = null;
let updateStatus = { state: 'idle' };

function setStatus(s) {
  updateStatus = s;
  if (win && !win.isDestroyed()) win.webContents.send('sf:update', s);
  if (SMOKE || !app.isPackaged) console.log('[update]', JSON.stringify(s));
}

function registerAppProtocol() {
  protocol.handle('app', async (req) => {
    const url = new URL(req.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(WEB, rel));
    if (!file.startsWith(WEB)) return new Response('Forbidden', { status: 403 });
    try {
      const data = await fs.promises.readFile(file);
      return new Response(data, { headers: { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 950, minWidth: 900, minHeight: 600,
    backgroundColor: '#121417', title: 'Seed Finder', autoHideMenuBar: true, show: !SMOKE,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
    },
  });
  win.removeMenu();
  // Links (e.g. the cubiomes credit) open in the user's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); }
  });
  if (SMOKE) {
    win.webContents.on('console-message', (e) => {
      const { level, message } = e;
      console.log(`[renderer:${level}] ${message}`);
    });
  }
  win.loadURL('app://seed-finder/index.html');
}

function checkForUpdates() {
  if (!app.isPackaged && !process.env.SF_FORCE_UPDATES) {
    setStatus({ state: 'dev' });
    return;
  }
  setStatus({ state: 'checking' });
  autoUpdater.checkForUpdates().catch((err) => setStatus({ state: 'error', message: String(err && err.message || err) }));
}

function setupUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = !SMOKE; // smoke tests must never install anything
  if (process.env.SF_FORCE_UPDATES) autoUpdater.forceDevUpdateConfig = true;
  autoUpdater.on('update-available', (info) => setStatus({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => setStatus({ state: 'latest' }));
  autoUpdater.on('download-progress', (p) => setStatus({ state: 'downloading', version: updateStatus.version, percent: Math.round(p.percent) }));
  autoUpdater.on('error', (err) => setStatus({ state: 'error', message: String(err && err.message || err) }));
  autoUpdater.on('update-downloaded', async (info) => {
    setStatus({ state: 'ready', version: info.version });
    if (!win || win.isDestroyed()) return;
    const r = await dialog.showMessageBox(win, {
      type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1,
      title: 'Update ready',
      message: `Seed Finder ${info.version} has been downloaded.`,
      detail: 'Restart now to update, or it will install the next time you close the app.',
    });
    if (r.response === 0) autoUpdater.quitAndInstall();
  });

  ipcMain.handle('sf:version', () => app.getVersion());
  ipcMain.handle('sf:update-status', () => updateStatus);
  ipcMain.handle('sf:check-updates', () => { checkForUpdates(); return true; });
  ipcMain.handle('sf:install-update', () => { if (updateStatus.state === 'ready') autoUpdater.quitAndInstall(); });
}

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(() => {
  registerAppProtocol();
  setupUpdater();
  createWindow();
  win.webContents.once('did-finish-load', checkForUpdates);
  // smoke tests can drive the page (e.g. start a search before the screenshot)
  if (SMOKE && process.env.SF_SMOKE_JS) win.webContents.once('did-finish-load', () => setTimeout(() => win.webContents.executeJavaScript(process.env.SF_SMOKE_JS).catch(() => {}), 2500));
  if (SMOKE && process.env.SF_SMOKE_SCREENSHOT) {
    setTimeout(async () => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.SF_SMOKE_SCREENSHOT, img.toPNG());
      console.log('[smoke] screenshot saved');
    }, (+process.env.SF_SMOKE_TEST || 15000) - 3000);
  }
  if (SMOKE) setTimeout(() => app.quit(), +process.env.SF_SMOKE_TEST || 15000);
});

app.on('window-all-closed', () => app.quit());
