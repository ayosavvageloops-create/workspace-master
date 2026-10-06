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
  if (req.url === '/api/config') { state.config = { ...state.config, ...body }; save(); return json({ ok: true }); }
  if (req.url === '/api/templates') { state.templates = body.templates; save(); return json(body.templates); }
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

test('Этап 1: Artist Finder → шаблоны и способы → импорт → рассылка', async (t) => {
  const http = require('node:http');
  const { out, store } = setup();
  let discoverBody = null;
  let polls = 0;
  const finder = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/health') return json({ ok: true, app: 'artist-finder' });
    if (req.url === '/discover') { discoverBody = JSON.parse(raw); return json({ ok: true, jobId: 'j1' }); }
    if (req.url === '/discover/j1') {
      polls++;
      if (polls < 2) return json({ ok: true, state: 'walking', want: 3, found: 1, rows: [] });
      return json({ ok: true, state: 'done', seedName: 'Tory Lanez', want: 3, found: 3, rows: [
        { name: 'Jay Wave', igHandle: 'jay.wave', track: 'Night Drive', monthlyListeners: 5000, spotifyUrl: 'https://open.spotify.com/artist/1' },
        { name: 'Mia', igHandle: '@Rnb.Mia', track: 'Slow', monthlyListeners: 3000 },
        { name: 'No IG', igHandle: '', track: 'x' },
      ] });
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise((r) => finder.listen(0, '127.0.0.1', r));
  const hub = new Hub({ store, platform: 'linux' });
  hub.finder.discover = ((orig) => (p, o) => orig.call(hub.finder, p, { ...o, pollMs: 20 }))(hub.finder.discover);
  t.after(() => { hub.shutdown(); finder.close(); });
  store.set({
    finderPort: finder.address().port,
    disabledSteps: { stage1: [3] }, // Dolphin Anty в тесте не открываем
    usedHandles: ['old.one'],
    stage1: { seed: 'Tory Lanez', count: 3, minListeners: 1600, maxListeners: 24000, filterFollowers: false, minFollowers: 3000, maxFollowers: 50000 },
    templates: ['Yo {{first_name:bro}}, "{{track}}" hits', '  '],
    methods: { dm: true, story: true, post: false },
  });

  await hub.runScenario('stage1');
  const run = hub.runs.stage1;
  assert.deepStrictEqual(run.steps.map((s) => s.status), ['ok', 'skip', 'ok', 'off', 'ok', 'ok', 'ok', 'ok'], JSON.stringify(run.steps));
  assert.match(run.steps[2].note, /найдено 2 артистов/);

  assert.strictEqual(discoverBody.seed, 'Tory Lanez');
  assert.strictEqual(discoverBody.count, 3);
  assert.strictEqual(discoverBody.minListeners, 1600);
  assert.deepStrictEqual(discoverBody.exclude, ['old.one']);

  const mock = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepStrictEqual(mock.templates.map((x) => x.text), ['Yo {{first_name:bro}}, "{{track}}" hits']);
  assert.deepStrictEqual(mock.config.extension.methods, { dm: true, story: true, post: false });
  const imported = parseCsv(mock.imported[0]);
  assert.deepStrictEqual(imported.map((r) => [r.username, r.name, r.track]), [['jay.wave', 'Jay Wave', 'Night Drive'], ['rnb.mia', 'Mia', 'Slow']]);
  assert.ok(mock.started);
  assert.deepStrictEqual(store.get('usedHandles').sort(), ['jay.wave', 'old.one', 'rnb.mia']);
  assert.strictEqual((await hub.snapshot()).settings.usedCount, 3);
});

test('встроенный Dolphin Outreach (настоящий код): профили, шаблоны, опенер каждому артисту', async (t) => {
  const http = require('node:http');
  const { startEmbeddedOutreach } = require('../core/embedded');
  const { root, store } = setup();
  const port = PORT + 200;
  const finder = http.createServer(async (req, res) => {
    for await (const _ of req) { /* тело не нужно */ }
    const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/health') return json({ ok: true });
    if (req.url === '/discover') return json({ ok: true, jobId: 'j' });
    return json({ ok: true, state: 'done', want: 2, found: 2, rows: [
      { name: 'Jay Wave', igHandle: 'jay.wave', track: 'Night Drive' },
      { name: '', igHandle: 'nobody.x', track: '' },
    ] });
  });
  await new Promise((r) => finder.listen(0, '127.0.0.1', r));
  const hub = new Hub({ store, platform: 'linux', embedded: (p) => startEmbeddedOutreach({ dataDir: path.join(root, 'do'), port: p }) });
  hub.finder.discover = ((orig) => (p, o) => orig.call(hub.finder, p, { ...o, pollMs: 10 }))(hub.finder.discover);
  t.after(() => { hub.embeddedServer?.close(); finder.close(); });
  store.set({
    outreachPort: port, finderPort: finder.address().port, dolphinToken: 'tok-1', extensionName: 'Savage Reach',
    workspaceDir: '/nonexistent', // папка не нужна — Outreach встроенный
    disabledSteps: { stage1: [3, 7] }, // без Dolphin Anty и без реального старта профилей
    templates: ['Yo {{first_name:bro}}, "{{track:your latest}}" goes hard'],
    methods: { dm: true, story: false, post: true },
  });

  await hub.runScenario('stage1');
  assert.deepStrictEqual(hub.runs.stage1.steps.map((s) => s.status), ['ok', 'ok', 'ok', 'off', 'ok', 'ok', 'ok', 'off'], JSON.stringify(hub.runs.stage1.steps));
  assert.match(hub.runs.stage1.steps[6].note, /файл: money-hub-/);
  const saved = fs.readdirSync(path.join(root, 'Downloads')).find((f) => f.startsWith('money-hub-'));
  const savedRows = parseCsv(fs.readFileSync(path.join(root, 'Downloads', saved), 'utf8'));
  assert.strictEqual(savedRows.find((r) => r.username === 'jay.wave').opener, 'Yo Jay, "Night Drive" goes hard');

  const base = `http://127.0.0.1:${port}`;
  const artists = (await (await fetch(`${base}/api/artists`)).json()).items;
  const op = Object.fromEntries(artists.map((a) => [a.username, a.opener]));
  assert.strictEqual(op['jay.wave'], 'Yo Jay, "Night Drive" goes hard');
  assert.strictEqual(op['nobody.x'], 'Yo bro, "your latest" goes hard');
  const st = await (await fetch(`${base}/api/state`)).json();
  assert.deepStrictEqual(st.config.extension.methods, { dm: true, story: false, post: true });
  assert.strictEqual(st.config.extension.name, 'Savage Reach');
  assert.strictEqual(st.config.dolphin.tokenHint, '…ok-1'); // токен дошёл

  // профили: выбор из Money Hub
  await fetch(`${base}/api/profiles/manual`, { method: 'POST', body: JSON.stringify({ id: '835678777', name: 'IG4' }) });
  const list = await hub.selectProfiles(['835678777']);
  assert.deepStrictEqual(list.map((p) => [p.name, p.selected]), [['IG4', true]]);
  const mod = await hub.moduleState(hub.module('dolphin-outreach'));
  assert.strictEqual(mod.status, 'running');
  assert.strictEqual(mod.embedded, true);
  assert.strictEqual(mod.external, undefined);
});

test('Этап 1: Artist Finder выбирает 1 артиста → похожие на него; Savage Alike подхватывается по CSV', async (t) => {
  const http = require('node:http');
  const { startEmbeddedOutreach } = require('../core/embedded');
  const { root, store } = setup();
  const dl = path.join(root, 'Downloads');
  const port = PORT + 300;
  const seeds = [];
  const finder = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/health') return json({ ok: true });
    if (req.url === '/discover') { const b = JSON.parse(raw); seeds.push([b.seed, b.count]); return json({ ok: true, jobId: b.count === 1 ? 'one' : 'many' }); }
    if (req.url === '/discover/one') return json({ ok: true, state: 'done', rows: [{ name: 'Picked Star', igHandle: 'picked.star', spotifyUrl: 'https://open.spotify.com/artist/P', monthlyListeners: 9000 }] });
    return json({ ok: true, state: 'done', rows: [{ name: 'Sim One', igHandle: 'sim.one', track: 'A' }, { name: 'Picked Star', igHandle: 'picked.star' }] });
  });
  await new Promise((r) => finder.listen(0, '127.0.0.1', r));
  const hub = new Hub({ store, platform: 'linux', tokenScan: () => null, embedded: (p) => startEmbeddedOutreach({ dataDir: path.join(root, 'do2'), port: p }) });
  hub.finder.discover = ((orig) => (p, o) => orig.call(hub.finder, p, { ...o, pollMs: 10 }))(hub.finder.discover);
  hub.alikePollMs = 20;
  t.after(() => { hub.embeddedServer?.close(); finder.close(); });
  store.set({
    outreachPort: port, finderPort: finder.address().port, disabledSteps: { stage1: [3, 7] },
    stage1: { seed: 'Tory Lanez', pickOne: true, similarSource: 'finder', count: 30, minListeners: 1600, maxListeners: 24000 },
    templates: ['Yo {{first_name:bro}}'], methods: { dm: true, story: true, post: true },
  });

  // 1) Artist Finder: 1 артист → 30 похожих на него (сам выбранный в рассылку не попадает)
  await hub.runScenario('stage1');
  let steps = hub.runs.stage1.steps;
  assert.deepStrictEqual(steps.map((s) => s.status), ['ok', 'ok', 'ok', 'off', 'ok', 'ok', 'ok', 'off'], JSON.stringify(steps));
  assert.match(steps[1].note, /выбран Picked Star \(@picked\.star\), 9000 слушателей/);
  assert.deepStrictEqual(seeds, [['Tory Lanez', 1], ['Picked Star', 30]]);
  assert.deepStrictEqual(hub.found.map((a) => a.username), ['sim.one', 'picked.star']);

  // 2) Savage Alike: CSV с готовыми опенерами появляется в «Загрузках»
  store.set({ stage1: { ...store.get('stage1'), similarSource: 'alike' } });
  setTimeout(() => fs.writeFileSync(path.join(dl, 'alike-export.csv'),
    'artist,instagram,top_tracks,message,spotify_url\n' +
    'Nova,https://instagram.com/nova.wav/,Glow | Other,"yo Nova, Glow is crazy",x\n' +
    'Sim One,@sim.one,A,already used,\n' +
    'Kai,@kai.music,,,\n'), 150);
  await hub.runScenario('stage1');
  steps = hub.runs.stage1.steps;
  assert.deepStrictEqual(steps.map((s) => s.status), ['ok', 'ok', 'ok', 'off', 'ok', 'ok', 'ok', 'off'], JSON.stringify(steps));
  assert.match(steps[2].note, /alike-export\.csv: 2 артистов, с готовыми опенерами: 1/);
  const items = (await (await fetch(`http://127.0.0.1:${port}/api/artists`)).json()).items;
  const op = Object.fromEntries(items.map((a) => [a.username, a.opener]));
  assert.strictEqual(op['nova.wav'], 'yo Nova, Glow is crazy'); // опенер из Savage Alike как есть
  assert.strictEqual(op['kai.music'], 'Yo Kai'); // нет опенера — из шаблона
});

test('токен Dolphin находится в настройках Savage DM Bot 2', () => {
  const { findDolphinToken } = require('../core/tokenscan');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'appsup-'));
  fs.mkdirSync(path.join(base, 'Other App'), { recursive: true });
  fs.writeFileSync(path.join(base, 'Other App', 'settings.json'), JSON.stringify({ dolphin_token: 'x'.repeat(40) }));
  assert.strictEqual(findDolphinToken(base), null); // чужие программы не трогаем
  fs.mkdirSync(path.join(base, 'Savage DM Bot 2', 'data'), { recursive: true });
  fs.writeFileSync(path.join(base, 'Savage DM Bot 2', 'data', 'settings.json'), JSON.stringify({ min_delay: 30, dolphin_token: 'eyJ' + 'a'.repeat(60) }));
  assert.deepStrictEqual(findDolphinToken(base), { token: 'eyJ' + 'a'.repeat(60), source: 'Savage DM Bot 2' });
});
