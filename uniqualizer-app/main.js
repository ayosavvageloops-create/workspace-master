'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const core = require('./core');

const unpacked = (p) => p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
const FFMPEG = process.env.UNIQ_FFMPEG || unpacked(require('ffmpeg-static'));
const FFPROBE = process.env.UNIQ_FFPROBE || unpacked(require('ffprobe-static').path);

const DEFAULT_OUT = path.join(os.homedir(), 'Movies', 'Uniq_Output');
const lutDir = () => path.join(app.getPath('userData'), 'luts');

let win = null;
let current = null; // активное задание: { cancel, stop }

function createWindow() {
  win = new BrowserWindow({
    width: 880,
    height: 780,
    minWidth: 760,
    minHeight: 640,
    backgroundColor: '#14161a',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => app.quit());

function expandInputs(paths) {
  const out = [];
  for (const p of paths) {
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      for (const f of fs.readdirSync(p).sort()) {
        if (!f.startsWith('.') && core.VIDEO_EXT.has(path.extname(f).toLowerCase())) {
          out.push(path.join(p, f));
        }
      }
    } else if (core.VIDEO_EXT.has(path.extname(p).toLowerCase())) {
      out.push(p);
    }
  }
  return out;
}

ipcMain.handle('defaults', () => ({ outDir: DEFAULT_OUT, lutDir: lutDir() }));

ipcMain.handle('pick-files', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [{ name: 'Видео', extensions: [...core.VIDEO_EXT].map((e) => e.slice(1)) }],
  });
  return r.canceled ? [] : expandInputs(r.filePaths);
});

ipcMain.handle('expand', (_e, paths) => expandInputs(paths));

ipcMain.handle('pick-output', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('open-path', (_e, p) => shell.openPath(p));
ipcMain.handle('show-file', (_e, p) => shell.showItemInFolder(p));

ipcMain.handle('luts-info', () => {
  fs.mkdirSync(lutDir(), { recursive: true });
  return { dir: lutDir(), count: core.loadLuts(lutDir()).length };
});

ipcMain.handle('gen-luts', (_e, n) => {
  core.generateLuts(lutDir(), Math.max(1, Math.min(100, n | 0)));
  return core.loadLuts(lutDir()).length;
});

ipcMain.handle('cancel', () => {
  if (current) current.stop();
});

ipcMain.handle('run', async (e, { files, outDir, copies, opts }) => {
  if (current) throw new Error('Уже идёт обработка');
  const send = (ch, payload) => { if (!e.sender.isDestroyed()) e.sender.send(ch, payload); };

  fs.mkdirSync(outDir, { recursive: true });
  if (opts.lutEnabled && core.loadLuts(lutDir()).length === 0) core.generateLuts(lutDir(), 12);
  const luts = core.loadLuts(lutDir());

  let stopped = false;
  let active = null;
  current = {
    stop() { stopped = true; if (active) active.cancel(); },
  };

  const usedDates = new Set();
  const results = { ok: 0, fail: 0 };
  const total = files.length * copies;
  let idx = 0;

  try {
    for (const src of files) {
      for (let c = 0; c < copies; c++) {
        if (stopped) break;
        const id = idx++;
        send('job', { id, total, name: path.basename(src), state: 'run', percent: 0 });
        active = core.processVideo({
          src, outDir, opts, ffmpeg: FFMPEG, ffprobe: FFPROBE, luts, usedDates,
          onProgress: (percent) => send('job', { id, total, name: path.basename(src), state: 'run', percent }),
        });
        try {
          const r = await active.promise;
          results.ok++;
          send('job', {
            id, total, name: path.basename(src), state: 'done', percent: 100,
            file: r.file, info: `×${r.speed} · LUT ${r.lut ? `${r.lut} (${r.strength})` : '—'} · ${r.date.slice(0, 10)}`,
          });
        } catch (err) {
          results.fail++;
          send('job', { id, total, name: path.basename(src), state: 'error', percent: 0, error: String(err.message || err) });
        }
        active = null;
      }
      if (stopped) break;
    }
  } finally {
    current = null;
  }
  return { ...results, stopped };
});
