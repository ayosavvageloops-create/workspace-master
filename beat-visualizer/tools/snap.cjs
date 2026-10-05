#!/usr/bin/env node
// Renders looks on the built-in demo beat in headless Chromium and writes PNG contact
// sheets (4 frames at clip time 2, 4, 6, 8 s) for visual review.
//
//   node tools/snap.cjs <lookId|all> [--out dir] [--format 9:16] [--nomidi] [--times 2,4,6,8] [--scale 0.28]
//        [--beat file.wav] [--midi a.mid,b.mid] [--source midi|audio] [--title "a long title"] [--key F#m] [--handle @name] [--tag name]
//
// Prints per-look render time and any console errors. Requires Playwright
// (set PLAYWRIGHT_PATH if it is not resolvable from here).
const path = require('path');
const fs = require('fs');
const pw = (() => {
  for (const p of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node-tools/node_modules/playwright']) {
    if (!p) continue;
    try { return require(p); } catch (e) { /* next */ }
  }
  throw new Error('playwright not found');
})();

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes('--' + k);
const which = args[0] || 'all';
const out = path.resolve(opt('out', 'snaps'));
const format = opt('format', '9:16');
const times = opt('times', '2,4,6,8').split(',').map(Number);
const scale = parseFloat(opt('scale', '0.28'));
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await pw.chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? undefined : undefined });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  const url = 'file://' + path.resolve(__dirname, '..', 'index.html') + `?demo=1&format=${encodeURIComponent(format)}${flag('nomidi') ? '&nomidi=1' : ''}`;
  await page.goto(url);
  await page.waitForFunction(() => window.__app, null, { timeout: 20000 });
  await page.evaluate(() => window.__app.ready);
  if (opt('midi')) await page.setInputFiles('#midiFile', opt('midi').split(','));
  if (opt('beat')) {
    const name = path.basename(opt('beat'));
    await page.setInputFiles('#beatFile', opt('beat'));
    await page.waitForFunction((n) => window.__app.state.beatName === n && window.__app.state.busy === false, name, { timeout: 60000 });
  }
  if (opt('source')) { await page.selectOption('#source', opt('source')); }
  if (opt('title')) { await page.fill('#title', opt('title')); }
  if (opt('key')) { await page.fill('#key', opt('key')); }
  if (opt('handle')) { await page.fill('#handle', opt('handle')); }
  const info = await page.evaluate(() => { const s = window.__app.state; return { title: s.meta.title, bpm: s.meta.bpm, key: s.meta.key, source: s.source, midiOffsetMs: Math.round(s.midiOffset * 1000),
    parts: s.parts.map((p) => `${p.name}:${p.notes.length}`).join(' ') }; });
  console.log('scene:', JSON.stringify(info));
  const ids = which === 'all' ? await page.evaluate(() => window.__app.Looks.list.map((l) => l.id)) : which.split(',');
  for (const id of ids) {
    const before = errors.length;
    const res = await page.evaluate(async ({ id, times, scale }) => {
      const app = window.__app;
      if (!app.Looks.get(id)) return { missing: true };
      const shots = [];
      let ms = 0;
      for (const t of times) { const s = app.snap(id, t, scale); shots.push(s.url); ms = Math.max(ms, s.ms); }
      // full-res timing on one frame (what export pays per frame)
      const full = app.snap(id, times[1] || times[0], 1).ms;
      // tile the shots side by side
      const imgs = await Promise.all(shots.map((u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = u; })));
      const c = document.createElement('canvas');
      c.width = imgs[0].width * imgs.length; c.height = imgs[0].height;
      const g = c.getContext('2d');
      imgs.forEach((im, i) => g.drawImage(im, i * im.width, 0));
      return { url: c.toDataURL('image/png'), ms, full };
    }, { id, times, scale });
    if (res.missing) { console.log(`${id}: not registered`); continue; }
    const file = path.join(out, `${id}${format === '9:16' ? '' : '-' + format.replace(':', 'x')}${flag('nomidi') ? '-nomidi' : ''}${opt('tag') ? '-' + opt('tag') : ''}.png`);
    fs.writeFileSync(file, Buffer.from(res.url.split(',')[1], 'base64'));
    console.log(`${id}: ${file}  render ${res.full.toFixed(1)} ms/frame at full res`);
    for (const e of errors.slice(before)) console.log(`  ! ${e}`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
