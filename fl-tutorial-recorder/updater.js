// Self-update from the GitHub release "fl-recorder-latest".
// CI publishes latest.json ({ version, dmg, sha256 }) next to the DMG; the app downloads the DMG in
// the background, and on restart a small shell script swaps the .app bundle and relaunches it.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

const BASE = 'https://github.com/ayosavvageloops-create/workspace-master/releases/download/fl-recorder-latest/';

function newer(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { maxBuffer: 1 << 20 }, (err, stdout, stderr) => err ? reject(new Error(stderr || err.message)) : resolve(stdout));
});

// The running bundle: …/FL Tutorial Recorder.app/Contents/MacOS/<exe> → …/FL Tutorial Recorder.app
function bundlePath(execPath) {
  const p = path.resolve(execPath, '..', '..', '..');
  return p.endsWith('.app') ? p : null;
}

// Copy the app out of a DMG next to `dest` as `<dest>.update`; returns that path.
async function stageFromDmg(dmg, dest) {
  const mnt = fs.mkdtempSync(path.join(os.tmpdir(), 'fltr-mnt-'));
  await run('hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-mountpoint', mnt]);
  try {
    const app = fs.readdirSync(mnt).find(n => n.endsWith('.app'));
    if (!app) throw new Error('в DMG нет приложения');
    const staged = dest + '.update';
    fs.rmSync(staged, { recursive: true, force: true });
    await run('ditto', [path.join(mnt, app), staged]);
    await run('xattr', ['-cr', staged]).catch(() => {});
    return staged;
  } finally {
    await run('hdiutil', ['detach', mnt, '-force']).catch(() => {});
  }
}

// Waits for `pid` to exit, swaps the bundles, optionally relaunches. Runs detached from the app.
function swapScript() {
  return `#!/bin/bash
PID="$1"; STAGED="$2"; DEST="$3"; RELAUNCH="$4"
while kill -0 "$PID" 2>/dev/null; do sleep 0.3; done
rm -rf "$DEST.old"
if mv "$DEST" "$DEST.old" && mv "$STAGED" "$DEST"; then
  rm -rf "$DEST.old"
else
  [ -d "$DEST.old" ] && [ ! -d "$DEST" ] && mv "$DEST.old" "$DEST"
fi
xattr -cr "$DEST" 2>/dev/null
[ "$RELAUNCH" = "1" ] && open "$DEST"
exit 0
`;
}
function scheduleSwap(staged, dest, pid, relaunch = true) {
  const script = path.join(os.tmpdir(), `fltr-swap-${Date.now()}.sh`);
  fs.writeFileSync(script, swapScript(), { mode: 0o755 });
  const child = spawn('/bin/bash', [script, String(pid), staged, dest, relaunch ? '1' : '0'], { detached: true, stdio: 'ignore' });
  child.unref();
  return child;
}

function createUpdater({ app, net, onState }) {
  let state = { status: 'idle', current: app.getVersion() };
  let staged = null;
  const set = (patch) => { state = { ...state, ...patch }; onState && onState(state); };

  const supported = () => process.platform === 'darwin' && app.isPackaged && !!bundlePath(process.execPath);

  async function check() {
    if (!supported()) { set({ status: 'unsupported' }); return state; }
    if (['downloading', 'ready'].includes(state.status)) return state;
    try {
      set({ status: 'checking' });
      const res = await net.fetch(BASE + 'latest.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const info = await res.json();
      if (!newer(info.version, state.current)) { set({ status: 'current', latest: info.version, checkedAt: Date.now() }); return state; }
      await download(info);
    } catch (e) {
      set({ status: 'error', error: e.message });
    }
    return state;
  }

  async function download(info) {
    set({ status: 'downloading', latest: info.version, progress: 0 });
    const res = await net.fetch(BASE + (info.dmg || 'FL-Tutorial-Recorder-arm64.dmg'), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const total = +res.headers.get('content-length') || 0;
    const file = path.join(os.tmpdir(), `fltr-${info.version}.dmg`);
    const out = fs.createWriteStream(file);
    const hash = crypto.createHash('sha256');
    const reader = res.body.getReader();
    let got = 0, lastReport = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      if (!out.write(Buffer.from(value))) await new Promise(r => out.once('drain', r));
      got += value.length;
      if (total && Date.now() - lastReport > 250) { lastReport = Date.now(); set({ progress: got / total }); }
    }
    await new Promise((r, j) => out.end((e) => e ? j(e) : r()));
    if (info.sha256 && hash.digest('hex') !== info.sha256) throw new Error('файл обновления повреждён, попробую позже');
    staged = await stageFromDmg(file, bundlePath(process.execPath));
    fs.rmSync(file, { force: true });
    set({ status: 'ready', progress: 1 });
  }

  function installAndRestart() {
    if (state.status !== 'ready' || !staged) return false;
    set({ installing: true });
    scheduleSwap(staged, bundlePath(process.execPath), process.pid, true);
    app.quit();
    return true;
  }

  return { check, installAndRestart, get state() { return state; } };
}

module.exports = { createUpdater, newer, bundlePath, stageFromDmg, scheduleSwap };
