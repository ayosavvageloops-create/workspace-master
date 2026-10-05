// E2E: грузит расширение в Chromium и прогоняет Instagram-этап против локального мок-сервера.
// www.instagram.com резолвится на 127.0.0.1 (самоподписанный сертификат).
// Запуск: npm run test:e2e  (нужны playwright и openssl; путь к браузеру — CHROMIUM_PATH, если нужен)

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const extPath = join(dirname(fileURLToPath(import.meta.url)), '..');

const profiles = {
  prodalpha: { id: '100', username: 'prodalpha', full_name: 'Prod Alpha', biography: 'Producer | type beats', category_name: 'Music producer', followers: 52000 },
  buyer_artist: { id: '201', username: 'buyer_artist', full_name: 'Lil Buyer', biography: 'Rapper 🎤 new single out now', category_name: 'Musician/Band', external_url: 'https://open.spotify.com/artist/1', followers: 3400 },
  buyer_prod: { id: '202', username: 'buyer_prod', full_name: 'Beat Guy', biography: 'producer / drum kits / mixing & mastering', category_name: '', followers: 900 },
  tagger_artist: { id: '301', username: 'tagger_artist', full_name: 'Tag Artist', biography: 'singer songwriter • booking: x@y.z', category_name: 'Artist', followers: 15000 },
  placement_artist: { id: '401', username: 'placement_artist', full_name: 'Placed', biography: 'R&B artist. Stream my EP', category_name: '', external_url: 'https://linktr.ee/placed', followers: 88000 },
};

const userJson = (p) => ({
  data: {
    user: {
      id: p.id, username: p.username, full_name: p.full_name, biography: p.biography, category_name: p.category_name,
      external_url: p.external_url || null, bio_links: [], is_private: false, is_verified: false,
      edge_followed_by: { count: p.followers }, edge_follow: { count: 10 },
      edge_owner_to_timeline_media: { count: 30, edges: [] },
    },
  },
});

const feed = {
  items: [
    { pk: '9001', code: 'BEAT1', media_type: 2, comment_count: 4, caption: { text: 'new beat 🔥 link in bio' }, user: { username: 'prodalpha' } },
    { pk: '9002', code: 'PLACE1', media_type: 2, comment_count: 1, caption: { text: 'Out now w/ @placement_artist' }, user: { username: 'prodalpha' } },
    { pk: '9003', code: 'SELFIE', media_type: 1, comment_count: 0, caption: { text: 'vibes' }, user: { username: 'prodalpha' } },
  ],
  more_available: false,
};

const commentsPage1 = {
  comments: [
    { pk: 1, text: 'Check DM, I’m trying to buy a beat', user: { username: 'buyer_artist' } },
    { pk: 2, text: '🔥🔥🔥', user: { username: 'random_fan' } },
  ],
  has_more_headload_comments: true,
  next_min_id: 'page2',
};
const commentsPage2 = {
  comments: [
    { pk: 3, text: 'How much would it cost?', user: { username: 'buyer_prod' } },
    { pk: 4, text: 'thank you!', user: { username: 'prodalpha' } },
  ],
};
const tagged = {
  items: [{ pk: '7001', code: 'TAG1', media_type: 2, caption: { text: 'my new song prod @prodalpha' }, user: { username: 'tagger_artist' } }],
  more_available: false,
};

const ctxDir = mkdtempSync(join(tmpdir(), 'tbl-e2e-'));
// Самоподписанный сертификат для локального мока. Тестовый браузер ходит только на 127.0.0.1,
// поэтому ошибки сертификата игнорируются лишь в этом одноразовом профиле.
const keyPath = join(ctxDir, 'key.pem');
const certPath = join(ctxDir, 'cert.pem');
execFileSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=www.instagram.com',
  '-addext', 'subjectAltName=DNS:www.instagram.com', '-keyout', keyPath, '-out', certPath,
], { stdio: 'ignore' });

const seen = [];
const server = createServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (req, res) => {
  const url = new URL(req.url, 'https://www.instagram.com');
  seen.push(url.pathname + url.search);
  const json = (body, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === '/api/v1/users/web_profile_info/') {
    const p = profiles[url.searchParams.get('username')];
    return p ? json(userJson(p)) : json({}, 404);
  }
  if (url.pathname.startsWith('/api/v1/feed/user/')) return json(feed);
  if (url.pathname === '/api/v1/media/9001/comments/') return json(url.searchParams.get('min_id') ? commentsPage2 : commentsPage1);
  if (url.pathname.startsWith('/api/v1/media/')) return json({ comments: [] });
  if (url.pathname.startsWith('/api/v1/usertags/')) return json(tagged);
  res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'csrftoken=test; Path=/' });
  res.end(`<html><body>${url.pathname}</body></html>`);
});
await new Promise((r) => server.listen(Number(process.env.MOCK_PORT || 443), '127.0.0.1', r));
const { port } = server.address();

const ctx = await chromium.launchPersistentContext(join(ctxDir, 'profile'), {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
    '--headless=new',
    '--no-proxy-server',
    `--host-resolver-rules=MAP www.instagram.com 127.0.0.1${port === 443 ? '' : `:${port}`}`,
    // Вкладки, которые создаёт расширение, не управляются Playwright, поэтому нужен флаг уровня браузера.
    // Прокси не используется: весь трафик этого одноразового браузера идёт только на локальный мок.
    '--ignore-certificate-errors',
  ],
  viewport: { width: 420, height: 1200 },
});

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];
const panel = await ctx.newPage();
const errors = [];
panel.on('pageerror', (e) => errors.push(e.message));
await panel.goto(`chrome-extension://${extId}/src/ui/sidepanel.html`);
await panel.evaluate(() =>
  chrome.storage.local.set({ settings: { manualProducers: '@prodalpha', delayMin: 500, delayMax: 700, visualNavigation: true } }),
);
await panel.reload();
await panel.click('#startBtn');

let job;
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  job = await panel.evaluate(async () => (await chrome.storage.local.get('job')).job);
  if (job && !job.running && job.status !== 'idle') break;
}
const leads = await panel.evaluate(async () => (await chrome.storage.local.get('leads')).leads);
for (const l of job.log) console.log(`  [${l.level}] ${l.msg}`);
await panel.screenshot({ path: join(ctxDir, 'panel.png'), fullPage: true });
const table = await ctx.newPage();
await table.setViewportSize({ width: 1400, height: 700 });
await table.goto(`chrome-extension://${extId}/src/ui/results.html`);
await table.waitForTimeout(500);
await table.screenshot({ path: join(ctxDir, 'results.png'), fullPage: true });
console.log('screenshots:', ctxDir);
await ctx.close();
server.close();

const expect = (cond, msg) => {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else console.log('ok:', msg);
};
expect(job.status === 'done', `job finished (${job.status}: ${job.message})`);
expect(errors.length === 0, `no UI errors ${errors.join('; ')}`);
expect(leads.buyer_artist?.priority === 'hot', 'commenter "Check DM…" who is an artist → hot');
expect(leads.buyer_prod?.isArtist === false, 'commenter who is a producer → not artist');
expect(leads.tagger_artist?.priority === 'warm', 'Tagged post owner artist → warm');
expect(leads.placement_artist?.isArtist === true, 'artist mentioned in placement caption → artist');
expect(!leads.random_fan, 'emoji-only commenter ignored');
expect(!leads.prodalpha, 'producer own replies ignored');
expect(seen.some((s) => s.includes('min_id=page2')), 'comments pagination followed');
expect(seen.some((s) => s === '/prodalpha/tagged/'), 'Tagged tab opened');
