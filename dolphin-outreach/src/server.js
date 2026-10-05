// Локальная панель управления: http://localhost:4747
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, loadConfig, saveConfig, publicConfig, deepMerge } from './config.js';
import { DB } from './db.js';
import { Dolphin } from './dolphin.js';
import { Runner } from './runner.js';
import { parseArtists, toCsv } from './csv.js';
import { renderOpener } from './templates.js';

export function createApp({ config, db, connect } = {}) {
  let cfg = config || loadConfig();
  const persist = !config;
  db = db || new DB();
  const dolphin = new Dolphin(cfg);
  const runner = new Runner({
    getConfig: () => cfg,
    db,
    dolphin,
    connect,
    onExtensionId: (id) => {
      cfg.extension.knownIds = [...new Set([...(cfg.extension.knownIds || []), id])].slice(-20);
      if (persist) saveConfig(cfg);
    },
  });

  // ---- живой лог для панели (Server-Sent Events) ----
  const clients = new Set();
  const logBuf = [];
  const push = (event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(msg);
  };
  runner.on('log', (line) => {
    logBuf.push(line);
    if (logBuf.length > 500) logBuf.shift();
    console.log(`${line.ts.slice(11, 19)} ${line.text}`);
    push('log', line);
  });
  let pendingUpdate = null;
  runner.on('update', (snap) => {
    if (pendingUpdate) return;
    pendingUpdate = setTimeout(() => {
      pendingUpdate = null;
      push('run', runner.snapshot());
      push('stats', db.stats());
    }, 300);
    void snap;
  });

  const routes = {
    'GET /api/state': () => ({
      config: publicConfig(cfg),
      profiles: db.profiles.list.map((p) => ({ ...p, sentToday: db.sentTodayByProfile(p.id), blockedToday: db.isProfileBlockedToday(p.id) })),
      selected: db.profiles.selected,
      stats: db.stats(),
      run: runner.snapshot(),
      log: logBuf.slice(-200),
      runs: db.runs.slice(0, 30),
    }),

    'GET /api/artists': (req, url) => {
      const status = url.searchParams.get('status') || '';
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const items = db.artists.filter(
        (a) => (!status || a.status === status) && (!q || a.username.includes(q) || a.name.toLowerCase().includes(q) || a.opener.toLowerCase().includes(q)),
      );
      return { total: items.length, items: items.slice(0, 2000) };
    },
    'POST /api/artists/import': (req, url, body) => {
      const { artists, invalid } = parseArtists(String(body.text || ''));
      const r = db.addArtists(artists);
      return { ...r, invalid: invalid.slice(0, 50), invalidCount: invalid.length };
    },
    'POST /api/artists/update': (req, url, body) => {
      const a = db.updateArtist(String(body.username), body.patch || {});
      if (!a) throw httpError(404, 'Артист не найден');
      return a;
    },
    'POST /api/artists/delete': (req, url, body) => ({ deleted: db.deleteArtists(body.usernames || []) }),
    'POST /api/artists/reset': (req, url, body) => ({ reset: db.resetArtists(body.usernames || []) }),
    'POST /api/artists/regenerate': (req, url, body) => ({ regenerated: db.regenerateOpeners({ includeCustom: Boolean(body.includeCustom) }) }),
    'GET /api/artists/export': () => ({
      __raw: toCsv(db.artists, ['username', 'name', 'opener', 'status', 'profileName', 'sentAt', 'error']),
      __type: 'text/csv; charset=utf-8',
    }),

    'GET /api/templates': () => db.templates,
    'POST /api/templates': (req, url, body) => db.setTemplates(Array.isArray(body.templates) ? body.templates : []),
    'POST /api/templates/preview': (req, url, body) => {
      const sample = db.artists.filter((a) => a.status === 'new').slice(0, 5);
      const list = sample.length ? sample : [{ username: 'lil.example', name: 'Lil Example', fields: {} }];
      return list.map((a) => ({ username: a.username, ...renderOpener(String(body.text || ''), a) }));
    },

    'POST /api/profiles/refresh': async () => {
      const list = await dolphin.listProfiles();
      const manual = db.profiles.list.filter((p) => p.manual && !list.some((x) => x.id === p.id));
      db.setProfiles([...list, ...manual]);
      return { count: list.length };
    },
    'POST /api/profiles/manual': (req, url, body) => {
      if (!body.id) throw httpError(400, 'Нужен ID профиля');
      db.addManualProfile({ id: String(body.id).trim(), name: String(body.name || '').trim() });
      return { ok: true };
    },
    'POST /api/profiles/select': (req, url, body) => { db.setSelected(body.ids || []); return { ok: true }; },
    'POST /api/profiles/unblock': (req, url, body) => { db.unblockProfile(body.id); return { ok: true }; },

    'POST /api/config': (req, url, body) => {
      const next = deepMerge(cfg, body || {});
      if (!body?.dolphin?.token) next.dolphin.token = cfg.dolphin.token; // пустое поле = не менять токен
      cfg = next;
      dolphin.cfg = cfg;
      dolphin.loggedIn = false;
      if (persist) saveConfig(cfg);
      return publicConfig(cfg);
    },

    'POST /api/run/plan': (req, url, body) => runner.plan({ profileIds: body.profileIds || [], perProfile: body.perProfile }),
    'POST /api/run/start': (req, url, body) => runner.start(body),
    'POST /api/run/stop': async () => { await runner.stop(); return { ok: true }; },
    'POST /api/run/manual-finish': (req, url, body) => ({ ok: runner.finishManual(body.profileId, body) }),
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write('retry: 2000\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      const handler = routes[`${req.method} ${url.pathname}`];
      if (handler) {
        let body = {};
        if (req.method === 'POST') {
          const chunks = [];
          for await (const c of req) chunks.push(c);
          const raw = Buffer.concat(chunks).toString('utf8');
          body = raw ? JSON.parse(raw) : {};
        }
        const out = await handler(req, url, body);
        if (out && out.__raw !== undefined) {
          res.writeHead(200, { 'Content-Type': out.__type, 'Content-Disposition': 'attachment; filename="artists.csv"' });
          return res.end('﻿' + out.__raw);
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(out ?? {}));
      }
      if (req.method === 'GET') return serveStatic(url.pathname, res);
      throw httpError(404, 'Не найдено');
    } catch (e) {
      res.writeHead(e.status || 500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });

  return { server, runner, db, getConfig: () => cfg };
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function serveStatic(pathname, res) {
  const pub = path.join(ROOT, 'public');
  const file = path.normalize(path.join(pub, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(pub) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const { server, getConfig } = createApp();
  const port = Number(process.env.PORT) || getConfig().port;
  server.listen(port, '127.0.0.1', () => {
    console.log(`\n  Dolphin Outreach запущен → http://localhost:${port}\n`);
  });
}
