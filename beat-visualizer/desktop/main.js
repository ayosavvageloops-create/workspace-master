// Beat Visualizer desktop shell: one window running the web app from ./app.
const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron');
const fs = require('fs/promises');
const path = require('path');

let lastDir = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0d0d0f',
    title: 'Beat Visualizer',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // keep exporting at full speed when the window is in the background
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  // links to websites open in the normal browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); }
  });
}

ipcMain.handle('save-file', async (event, filename, data) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const ext = path.extname(filename).slice(1) || 'mp4';
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save video',
    defaultPath: path.join(lastDir || app.getPath('videos'), filename),
    filters: [{ name: 'Video', extensions: [ext] }],
  });
  if (canceled || !filePath) return null;
  await fs.writeFile(filePath, Buffer.from(data));
  lastDir = path.dirname(filePath);
  return filePath;
});
ipcMain.handle('reveal-file', (event, filePath) => shell.showItemInFolder(filePath));

if (process.platform === 'darwin') {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]));
} else {
  Menu.setApplicationMenu(null);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
