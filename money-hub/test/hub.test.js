'use strict';
// Сценарий «Утренняя рассылка» целиком: Money Hub сам поднимает (поддельный) Dolphin Outreach
// через `npm start`, переносит лиды из «Загрузок» и запускает рассылку.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Hub } = require('../core/hub');
const { Store } = require('../core/store');
const { parseCsv } = require('../core/csv');
const leads = require('../core/leads');

const PORT = 47470 + Math.floor(Math.random() * 20);

const MOCK_SERVER = `
const http = require('node:http');
const fs = require('node:fs');
const state = { imported: [], started: null, running: false };
const save = () => fs.writeFileSync(process.env.MOCK_OUT, JSON.stringify(state));
http.createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : {};
  const json = (o) => { res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify(o)); };
  if (req.url === '/api/state') return json({
    selected: ['p1', 'p2'],
    profiles: [{ id: 'p1', sentToday: 3 }, { id: 'p2', sentToday: 0, blockedToday: true }, { id: 'p3', sentToday: 9 }],
    stats: { new: state.imported.length, sent: 3 },
    run: { running: state.running, slots: [] },
    log: [{ text: 'готов' }],
  });
  if (req.url === '/api/artists/import') { state.imported.push(body.text); save(); return json({ added: 2, duplicates: 0 }); }
  if (req.url === '/api/config') { state.config = body; save(); return json({ ok: true }); }
  if (req.url === '/api/run/start') { state.started = body; state.running = true; save(); return json({ ok: true }); }
  res.writeHead(404); res.end('{}');
}).listen(Number(process.env.PORT), '127.0.0.1');
`;

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'money-hub-'));
  const ws = path.join(root, 'ws');
  const dl = path.join(root, 'Downloads');
  const out = path.join(root, 'mock.json');
  fs.mkdirSync(path.join(ws, 'dolphin-outreach'), { recursive: true });
  fs.mkdirSync(dl);
  fs.writeFileSync(path.join(ws, 'dolphin-outreach', 'server.js'), MOCK_SERVER);
  fs.writeFileSync(path.join(ws, 'dolphin-outreach', 'package.json'), JSON.stringify({
    scripts: { start: `PORT=${PORT} MOCK_OUT=${out} node server.js` },
  }));
  fs.writeFileSync(path.join(dl, 'type-beat-leads-2026-10-06.csv'), '﻿' + [
    'priority,username,profile_url,full_name,followers,is_artist,producers,best_comment',
    'hot,@Lil.Wave,https://instagram.com/lil.wave,Jay Wave,1200,true,prodx,"how much for this, bro?"',
    'warm,rnb.mia,https://instagram.com/rnb.mia,Mia 🎤,800,true,prodx prody,',
    'not_artist,beatshop,https://instagram.com/beatshop,Beat Shop,9000,false,prodx,',
    'hot,lil.wave,https://instagram.com/lil.wave,Jay Wave,1200,true,prodx,dup',
  ].join('\n'));
  const store = new Store(path.join(root, 'settings.json'));
  store.set({ workspaceDir: ws, downloadsDir: dl, outreachPort: PORT });
  return { root, out, store };
}

test('лиды: берутся только горячие и тёплые, без дублей, с именем', () => {
  const rows = leads.toOutreachRows(parseCsv(fs.readFileSync(path.join(setup().root, 'Downloads', 'type-beat-leads-2026-10-06.csv'), 'utf8')));
  assert.deepStrictEqual(rows.map((r) => [r.username, r.name, r.priority]), [['lil.wave', 'Jay', 'hot'], ['rnb.mia', 'Mia', 'warm']]);
  assert.strictEqual(rows[0].comment, 'how much for this, bro?');
});

test('сценарий «Утренняя рассылка» проходит целиком', async (t) => {
  const { out, store } = setup();
  const hub = new Hub({ store, platform: 'linux' });
  t.after(() => hub.shutdown());
  store.set({ disabledSteps: { 'morning-outreach': [0] }, dolphinToken: 'tok-123' }); // Dolphin Anty в тесте не открываем

  await hub.runScenario('morning-outreach');
  const run = hub.runs['morning-outreach'];
  assert.deepStrictEqual(run.steps.map((s) => s.status), ['off', 'ok', 'ok', 'ok'], JSON.stringify(run.steps));
  assert.match(run.steps[2].note, /🔥 1, тёплых 1 → новых в очереди: 2/);

  const mock = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepStrictEqual(mock.started.profileIds, ['p1', 'p2']);
  assert.strictEqual(mock.config.dolphin.token, 'tok-123'); // токен ушёл в Dolphin Outreach
  assert.strictEqual((await hub.snapshot()).settings.dolphinToken, undefined); // в интерфейс токен не отдаётся
  const imported = parseCsv(mock.imported[0]);
  assert.deepStrictEqual(imported.map((r) => r.username), ['lil.wave', 'rnb.mia']);

  // карточка программы: статистика из панели рассылки
  const st = await hub.moduleState(hub.module('dolphin-outreach'));
  assert.strictEqual(st.status, 'running');
  assert.strictEqual(st.outreach.sentToday, 3); // только выбранные профили
  assert.strictEqual(st.outreach.profilesBlocked, 1);

  // повторный прогон не переносит тот же файл второй раз
  await hub.runScenario('morning-outreach');
  assert.strictEqual(hub.runs['morning-outreach'].steps[2].status, 'skip');
});

test('нет папки программы — понятная ошибка и остальные шаги отменены', async () => {
  const { store } = setup();
  store.set({ workspaceDir: '/nonexistent', outreachPort: PORT + 100, disabledSteps: { 'morning-outreach': [0] } });
  const hub = new Hub({ store, platform: 'linux' });
  await hub.runScenario('morning-outreach');
  const steps = hub.runs['morning-outreach'].steps;
  assert.strictEqual(steps[1].status, 'fail');
  assert.match(steps[1].note, /не найдена.*Настройках/);
  assert.deepStrictEqual(steps.slice(2).map((s) => s.status), ['cancel', 'cancel']);
});
