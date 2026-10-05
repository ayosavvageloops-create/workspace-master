// E2E: грузит расширение в Chromium и прогоняет Instagram-этап против локального мок-сервера.
// Мок отдаёт обычные HTML-страницы (профиль, пост с кнопкой «ещё комментарии», Tagged) — API не используется.
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

const lines = (...xs) => xs.map((x) => `<div>${x}</div>`).join('');
const outLink = (url) => `<a href="https://l.instagram.com/?u=${encodeURIComponent(url)}&e=x">${url.replace(/^https?:\/\//, '')}</a>`;

const profiles = {
  prodalpha: { posts: 30, followers: '52K', name: 'Prod Alpha', bio: ['Music producer', 'type beats daily'], grid: ['/prodalpha/p/BEATPOST01/', '/prodalpha/reel/PLACEPOST1/', '/prodalpha/p/SELFIEPOST/'] },
  buyer_artist: { posts: 40, followers: '3,400', name: 'Lil Buyer', bio: ['Musician/band', 'Rapper 🎤 new single out now'], link: 'https://open.spotify.com/artist/1' },
  buyer_prod: { posts: 300, followers: '900', name: 'Beat Guy', bio: ['producer / drum kits / mixing &amp; mastering'] },
  tagger_artist: { posts: 80, followers: '15K', name: 'Tag Artist', bio: ['Artist', 'singer songwriter • booking: x@y.z'] },
  placement_artist: { posts: 120, followers: '88K', name: 'Placed', bio: ['R&amp;B artist. Stream my EP'], link: 'https://linktr.ee/placed' },
};

const profilePage = (u, tagged = false) => {
  const p = profiles[u];
  if (!p) return `<main><div>Sorry, this page isn't available.</div></main>`;
  const grid = tagged ? ['/p/TAGGEDPOST1/'] : p.grid || [];
  return `<main><header><section>${lines(u, 'Follow', 'Message', `${p.posts} posts`, `${p.followers} followers`, '10 following', p.name, ...p.bio)}${p.link ? outLink(p.link) : ''}</section></header>
    <div class="grid">${grid.map((g) => `<a href="${g}"><img alt="${g.includes('BEATPOST') ? 'new beat link in bio' : 'photo'}"></a>`).join('')}</div></main>`;
};

const comment = (u, text) =>
  `<li><div><a href="/${u}/"><img alt=""></a></div><div><h3><a href="/${u}/">${u}</a></h3><span>${text}</span><div><time>2w</time><button>Reply</button></div></div></li>`;

const posts = {
  BEATPOST01: {
    owner: 'prodalpha',
    caption: 'new beat 🔥 link in bio',
    comments: [comment('buyer_artist', 'Check DM, I’m trying to buy a beat'), comment('random_fan', '🔥🔥🔥'), comment('prodalpha', 'thank you!')],
    more: comment('buyer_prod', 'How much would it cost?'),
  },
  PLACEPOST1: { owner: 'prodalpha', caption: 'Out now w/ <a href="/placement_artist/">@placement_artist</a>', comments: [] },
  SELFIEPOST: { owner: 'prodalpha', caption: 'vibes', comments: [] },
  TAGGEDPOST1: { owner: 'tagger_artist', caption: 'my new song prod <a href="/prodalpha/">@prodalpha</a>', comments: [] },
};

const postPage = (code) => {
  const p = posts[code];
  if (!p) return `<main><div>Sorry, this page isn't available.</div></main>`;
  const loadMore = p.more
    ? `<button id="more" onclick="document.getElementById('list').insertAdjacentHTML('beforeend', ${JSON.stringify(p.more).replace(/"/g, '&quot;')}); this.remove()"><svg aria-label="Load more comments"></svg></button>`
    : '';
  return `<head><meta property="og:description" content="10 likes, 4 comments - ${p.owner} on May 1, 2026: &quot;post&quot;"></head>
  <main><article><header><a href="/${p.owner}/">${p.owner}</a></header>
  <ul id="list">${comment(p.owner, p.caption)}${p.comments.join('')}</ul>${loadMore}</article></main>`;
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
  let body;
  let m;
  if (url.pathname.startsWith('/api/')) body = null; // расширение не должно ходить в API
  else if ((m = url.pathname.match(/^\/(?:[\w.]+\/)?(?:p|reel)\/([\w-]+)\/$/))) body = postPage(m[1]);
  else if ((m = url.pathname.match(/^\/([\w.]+)\/tagged\/$/))) body = profilePage(m[1], true);
  else if ((m = url.pathname.match(/^\/([\w.]+)\/$/))) body = profilePage(m[1]);
  else body = '<main></main>';
  if (body == null) {
    res.writeHead(500);
    return res.end('api used');
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html>${body.startsWith('<head>') ? body : `<body>${body}</body>`}</html>`);
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
  chrome.storage.local.set({ settings: { manualProducers: '@prodalpha', delayMin: 500, delayMax: 700 } }),
);
await panel.reload();
await panel.click('#startBtn');

let job;
for (let i = 0; i < 180; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  job = await panel.evaluate(async () => (await chrome.storage.local.get('job')).job);
  if (job && !job.running && job.status !== 'idle') break;
}
const leads = await panel.evaluate(async () => (await chrome.storage.local.get('leads')).leads);
if (process.env.DEBUG) console.log(JSON.stringify(leads.buyer_prod?.sources));
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
expect(leads.buyer_prod?.sources?.[0]?.text === 'How much would it cost?', '"load more comments" clicked, extra comment read');
expect(seen.includes('/prodalpha/tagged/'), 'Tagged tab opened');
expect(seen.includes('/p/TAGGEDPOST1/'), 'Tagged post opened to find its author');
expect(seen.includes('/buyer_artist/'), 'candidate profile opened');
expect(!seen.some((s) => s.startsWith('/api/')), 'no Instagram API requests');
