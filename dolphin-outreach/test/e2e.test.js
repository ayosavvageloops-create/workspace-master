// Сквозной тест: настоящий Chromium + фейковый локальный API Dolphin + макет IG Sender Pro.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, deepMerge } from '../src/config.js';
import { DB } from '../src/db.js';
import { createApp } from '../src/server.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.join(HERE, 'fixtures', 'test-extension');
const CHROME = process.env.CHROME_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const listen = (srv) => new Promise((res) => srv.listen(0, '127.0.0.1', () => res(srv.address().port)));

/** Фейковый Dolphin: /start поднимает Chromium с расширением и отдаёт port + wsEndpoint, как настоящий. */
function fakeDolphin() {
  const procs = new Map();
  const calls = [];
  const srv = http.createServer(async (req, res) => {
    calls.push(`${req.method} ${req.url.split('?')[0]}`);
    const send = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url.startsWith('/v1.0/auth/login-with-token')) return send({ success: true });
    const m = req.url.match(/^\/v1\.0\/browser_profiles\/([^/]+)\/(start|stop)/);
    if (!m) { res.writeHead(404); return res.end('{}'); }
    const [, id, action] = m;
    if (action === 'stop') {
      procs.get(id)?.kill('SIGKILL');
      procs.delete(id);
      return send({ success: true });
    }
    const port = await freePort();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `prof-${id}-`));
    const p = spawn(CHROME, [
      '--headless=new', '--no-sandbox', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--no-first-run', '--disable-gpu', `--user-data-dir=${dir}`,
      `--remote-debugging-port=${port}`, `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, 'about:blank',
    ], { stdio: 'ignore' });
    procs.set(id, p);
    for (let i = 0; i < 300; i++) {
      try {
        const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
        return send({ success: true, automation: { port, wsEndpoint: new URL(v.webSocketDebuggerUrl).pathname } });
      } catch { await sleep(100); }
    }
    send({ success: false, error: 'chrome did not start' });
  });
  return { srv, calls, killAll: () => procs.forEach((p) => p.kill('SIGKILL')) };
}

test('полный прогон: 3 профиля по 2 окна, статусы возвращаются в базу', { skip: !CHROME && 'нет Chromium', timeout: 120000 }, async () => {
  const ig = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<h1>fake instagram inbox</h1>'); });
  const igPort = await listen(ig);
  const dolphin = fakeDolphin();
  const dPort = await listen(dolphin.srv);

  const cfg = deepMerge(DEFAULTS, {
    dolphin: { localApi: `http://127.0.0.1:${dPort}`, token: 'test' },
    run: { concurrency: 2, artistsPerProfile: 4, dailyLimitPerProfile: 25, startStaggerSec: 0, pollSec: 0.3, profileTimeoutMin: 2 },
    extension: { openUrl: `http://127.0.0.1:${igPort}/ig` },
  });
  const db = new DB(fs.mkdtempSync(path.join(os.tmpdir(), 'do-e2e-')));
  db.addArtists(['a1', 'a2', 'skip3', 'fail4', 'a5', 'a6', 'a7', 'block8', 'a9', 'a10', 'a11'].map((u) => ({ username: u, name: u, fields: {} })));
  db.setProfiles([{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }, { id: 'p3', name: 'P3' }]);
  const app = createApp({ config: cfg, db });
  const logs = [];
  app.runner.on('log', (l) => logs.push(l.text));

  try {
    await app.runner.start({ profileIds: ['p1', 'p2', 'p3'] });
    await app.runner.wait();
    const by = Object.fromEntries(db.artists.map((a) => [a.username, a]));
    const slots = Object.fromEntries(app.runner.snapshot().slots.map((s) => [s.profileId, s]));

    // p1: a1,a2,skip3,fail4 → 2 отправлено, 1 пропуск, 1 ошибка
    assert.equal(slots.p1.phase, 'done', logs.join('\n'));
    assert.equal(slots.p1.sent, 2);
    assert.equal(by.skip3.status, 'skipped');
    assert.equal(by.fail4.status, 'failed');
    // p2: a5,a6,a7,block8 → ограничение IG: отправлено 3, профиль помечен
    assert.equal(slots.p2.phase, 'blocked');
    assert.equal(by.block8.status, 'failed');
    assert.ok(db.isProfileBlockedToday('p2'));
    // p3: остаток a9,a10,a11
    assert.equal(slots.p3.sent, 3);
    assert.equal(db.stats().sent, 8);
    assert.equal(db.stats().queued, 0);
    assert.equal(by.a1.profileName, 'P1');
    assert.equal(by.a9.profileName, 'P3');
    assert.equal(cfg.extension.knownIds.length, 1, 'ID расширения запомнен');
    assert.ok(dolphin.calls.filter((c) => c.endsWith('/stop')).length >= 3, 'профили закрыты');
  } finally {
    dolphin.killAll();
    dolphin.srv.close();
    ig.close();
  }
});
