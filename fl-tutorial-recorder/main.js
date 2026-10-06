const { app, BrowserWindow, desktopCapturer, session, ipcMain, globalShortcut, dialog, shell, screen, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { createBridge, installScript, scriptDir } = require('./fl-bridge');

// ffmpeg-static lives outside the asar archive once packaged.
const FFMPEG = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
const PROJECTS_DIR = () => path.join(app.getPath('videos'), 'FL Tutorial Recorder');

// macOS 13+: let ScreenCaptureKit hand over system audio together with the window.
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride');
}

let mainWin = null;
let hudWin = null;
let sourceCache = new Map(); // desktopCapturer source id -> source
let selectedSourceId = null;

function createMain() {
  mainWin = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1100, minHeight: 700,
    backgroundColor: '#101018',
    title: 'FL Tutorial Recorder',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  // macOS needs an Edit menu for Cmd+C / Cmd+V to work in text fields.
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
  } else {
    mainWin.removeMenu();
  }
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWin.on('closed', () => { mainWin = null; if (hudWin) hudWin.close(); });
}

// getDisplayMedia() in the renderer is answered with whatever source the user picked.
// The system mix ("loopback") comes along on Windows and macOS 13+, which is how FL Studio's sound gets in.
function installDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const src = sourceCache.get(selectedSourceId);
    if (!src) return callback({});
    const streams = { video: src };
    if (request.audioRequested && (process.platform === 'win32' || process.platform === 'darwin')) streams.audio = 'loopback';
    callback(streams);
  });
}

ipcMain.handle('sources:list', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 320, height: 200 },
  });
  sourceCache = new Map(sources.map(s => [s.id, s]));
  return sources.map(s => ({
    id: s.id,
    name: s.name,
    kind: s.id.startsWith('screen') ? 'screen' : 'window',
    thumb: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
  }));
});
ipcMain.handle('sources:select', (_e, id) => { selectedSourceId = id; return sourceCache.has(id); });
ipcMain.handle('platform', () => process.platform);

// ---------- projects on disk ----------
function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
ipcMain.handle('project:create', () => {
  const dir = path.join(PROJECTS_DIR(), stamp());
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  return dir;
});
ipcMain.handle('project:save', (_e, dir, data) => {
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(data, null, 2));
  return true;
});
ipcMain.handle('project:load', (_e, dir) => JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')));
ipcMain.handle('project:list', () => {
  const root = PROJECTS_DIR();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .map(name => path.join(root, name))
    .filter(dir => fs.existsSync(path.join(dir, 'project.json')))
    .map(dir => {
      let title = path.basename(dir);
      try { title = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')).title || title; } catch (e) {}
      return { dir, title, mtime: fs.statSync(path.join(dir, 'project.json')).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 20);
});
ipcMain.handle('project:reveal', (_e, dir) => shell.openPath(dir));
ipcMain.handle('file:url', (_e, p) => pathToFileURL(p).href);
ipcMain.handle('file:importBytes', (_e, dir, name, buf) => {
  const dest = path.join(dir, 'assets', `${Date.now()}-${name.replace(/[^\w.-]+/g, '_')}`);
  fs.writeFileSync(dest, Buffer.from(buf));
  return dest;
});
ipcMain.handle('file:import', (_e, dir, src) => {
  const dest = path.join(dir, 'assets', `${Date.now()}-${path.basename(src)}`);
  fs.copyFileSync(src, dest);
  return dest;
});

// ---------- streamed writes (recording and export) ----------
const streams = new Map();
let streamSeq = 0;
ipcMain.handle('stream:open', (_e, file) => {
  const id = ++streamSeq;
  streams.set(id, fs.createWriteStream(file));
  return id;
});
ipcMain.handle('stream:write', (_e, id, buf) => new Promise((res, rej) => {
  const s = streams.get(id);
  if (!s) return rej(new Error('stream closed'));
  s.write(Buffer.from(buf), (err) => err ? rej(err) : res(true));
}));
ipcMain.handle('stream:close', (_e, id) => new Promise((res) => {
  const s = streams.get(id);
  streams.delete(id);
  if (!s) return res(false);
  s.end(() => res(true));
}));

// ---------- ffmpeg ----------
function runFfmpeg(args, durationSec, onProgress) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-y', ...args]);
    let log = '';
    p.stderr.on('data', (d) => {
      const s = d.toString();
      log = (log + s).slice(-4000);
      const m = /time=(\d+):(\d+):([\d.]+)/.exec(s);
      if (m && durationSec && onProgress) onProgress(Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / durationSec));
    });
    p.on('error', reject);
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error(log)));
  });
}
const progressTo = (e, channel) => (f) => { if (!e.sender.isDestroyed()) e.sender.send(channel, f); };

// MediaRecorder WebM has no seek index and sparse keyframes. Re-encode to H.264 with a keyframe
// every half second so the editor can jump around the recording instantly.
ipcMain.handle('recording:finalize', async (e, dir, durationSec) => {
  const raw = path.join(dir, 'recording.webm');
  const out = path.join(dir, 'recording.mp4');
  await runFfmpeg([
    '-i', raw,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-g', '15', '-pix_fmt', 'yuv420p',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-r', '30', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out,
  ], durationSec, progressTo(e, 'progress:finalize'));
  fs.rmSync(raw, { force: true });
  return out;
});

// Export arrives as whatever MediaRecorder produced; normalise to a TikTok-friendly MP4.
ipcMain.handle('export:finish', async (e, dir, tmpFile, durationSec) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWin, {
    title: 'Сохранить видео',
    defaultPath: path.join(app.getPath('videos'), `tutorial-${stamp()}.mp4`),
    filters: [{ name: 'MP4', extensions: ['mp4'] }],
  });
  if (canceled || !filePath) { fs.rmSync(tmpFile, { force: true }); return null; }
  await runFfmpeg([
    '-i', tmpFile,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-r', '30', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', filePath,
  ], durationSec, progressTo(e, 'progress:export'));
  fs.rmSync(tmpFile, { force: true });
  shell.showItemInFolder(filePath);
  return filePath;
});

// ---------- hotkeys + HUD ----------
// While recording FL Studio has focus, so markers come from global shortcuts.
function sendAll(channel, payload) {
  for (const w of [mainWin, hudWin]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}
ipcMain.handle('hotkeys:enable', () => {
  globalShortcut.unregisterAll();
  for (let k = 0; k <= 9; k++) {
    globalShortcut.register(`Control+Shift+${k}`, () => sendAll('hotkey', { key: k }));
  }
  globalShortcut.register('Control+Shift+R', () => sendAll('hotkey', { key: 'stop' }));
  globalShortcut.register('Control+Shift+Z', () => sendAll('hotkey', { key: 'undo' }));
  return true;
});
ipcMain.handle('hotkeys:disable', () => { globalShortcut.unregisterAll(); return true; });

ipcMain.handle('hud:show', () => {
  if (hudWin && !hudWin.isDestroyed()) { hudWin.showInactive(); return; }
  const { workArea } = screen.getPrimaryDisplay();
  const w = 460, h = 64;
  hudWin = new BrowserWindow({
    width: w, height: h, x: Math.round(workArea.x + (workArea.width - w) / 2), y: workArea.y + 12,
    frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true,
    focusable: false, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  hudWin.setAlwaysOnTop(true, 'screen-saver');
  hudWin.setContentProtection(true); // keep the HUD out of screen captures
  hudWin.setIgnoreMouseEvents(true);
  hudWin.loadFile(path.join(__dirname, 'hud.html'));
  hudWin.once('ready-to-show', () => hudWin.showInactive());
  hudWin.on('closed', () => { hudWin = null; });
});
ipcMain.handle('hud:hide', () => { if (hudWin && !hudWin.isDestroyed()) hudWin.close(); });
ipcMain.on('hud:update', (_e, state) => { if (hudWin && !hudWin.isDestroyed()) hudWin.webContents.send('hud:state', state); });

// ---------- FL Studio bridge ----------
let lastFlStatus = null;
const fl = createBridge({
  onStatus: (s) => {
    const key = JSON.stringify(s);
    if (key === lastFlStatus) return;
    lastFlStatus = key;
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('fl:status', s);
  },
});
const flCall = (fn) => async (...args) => {
  try { return { ok: true, value: await fn(...args) }; } catch (e) { return { ok: false, error: e.message }; }
};
ipcMain.handle('fl:status', () => fl.status());
ipcMain.handle('fl:reconnect', () => { fl.open(); return fl.status(); });
ipcMain.handle('fl:list', flCall(() => fl.list()));
ipcMain.handle('fl:play', flCall((_e, pattern, view, channel) => fl.play(pattern, view, channel)));
ipcMain.handle('fl:song', flCall((_e, view) => fl.song(view)));
ipcMain.handle('fl:stop', flCall(() => fl.stop()));
ipcMain.handle('fl:install', flCall(() => installScript(app.getPath('documents'))));
ipcMain.handle('fl:scriptDir', () => scriptDir(app.getPath('documents')));
ipcMain.handle('fl:revealScript', () => {
  const dir = scriptDir(app.getPath('documents'));
  return shell.openPath(fs.existsSync(dir) ? dir : path.dirname(dir));
});

app.whenReady().then(() => {
  installDisplayMediaHandler();
  fl.open();
  createMain();
  app.on('activate', () => { if (!mainWin) createMain(); });
});
app.on('will-quit', () => { globalShortcut.unregisterAll(); fl.close(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
