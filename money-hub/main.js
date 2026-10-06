'use strict';
const path = require('node:path');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { Store } = require('./core/store');
const { Hub } = require('./core/hub');

app.setName('Money Hub');

let win = null;
let hub = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 860,
    minHeight: 600,
    title: 'Money Hub',
    backgroundColor: '#0d1110',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
}

function notify(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

app.whenReady().then(() => {
  const store = new Store(path.join(app.getPath('userData'), 'settings.json'));
  hub = new Hub({ store });
  hub.on('change', () => notify('hub:change'));
  hub.on('log', (id) => notify('hub:log', id));

  const wrap = (fn) => async (_e, ...args) => {
    try { return { ok: true, value: await fn(...args) }; } catch (e) { return { ok: false, error: e.message }; }
  };
  ipcMain.handle('hub:snapshot', wrap(() => hub.snapshot()));
  ipcMain.handle('hub:action', wrap((id, act) => hub.action(id, act)));
  ipcMain.handle('hub:log', wrap((id) => hub.log(id)));
  ipcMain.handle('hub:scenario', wrap((id) => { hub.runScenario(id); return true; }));
  ipcMain.handle('hub:step', wrap((id, i, on) => hub.setStepEnabled(id, i, on)));
  ipcMain.handle('hub:settings', wrap((patch) => hub.saveSettings(patch)));
  ipcMain.handle('hub:pickDir', wrap(async (current) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: current || undefined });
    return r.canceled ? null : r.filePaths[0];
  }));

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Закрыли Money Hub — останавливаем то, что он сам запускал (Dolphin Anty и т.п. не трогаем).
app.on('before-quit', () => hub && hub.shutdown());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
