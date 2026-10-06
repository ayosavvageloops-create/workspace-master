'use strict';
// Savage Alike: по Spotify-ссылке артиста находит похожих и сохраняет CSV (с опенерами).
// Money Hub кладёт ссылку в буфер обмена, открывает Savage Alike и ждёт новый CSV в «Загрузках».
const fs = require('node:fs');
const path = require('node:path');
const { parseCsv } = require('./csv');

const COLS = {
  username: ['instagram', 'username', 'ig', 'ig_handle', 'ighandle', 'handle', 'instagram_url', 'ig_url', 'user'],
  name: ['name', 'artist', 'artist_name', 'full_name'],
  track: ['track', 'top_track', 'song', 'top_tracks'],
  opener: ['opener', 'message', 'dm', 'text', 'template'],
  spotify_url: ['spotify_url', 'spotify', 'url', 'link'],
  listeners: ['monthly_listeners', 'listeners'],
};

function col(row, keys) {
  for (const k of keys) if (row[k] !== undefined && String(row[k]).trim() !== '') return String(row[k]).trim();
  return '';
}

function handleOf(v) {
  const m = String(v).match(/instagram\.com\/([^/?#\s]+)/i);
  return (m ? m[1] : String(v)).replace(/^@/, '').trim().toLowerCase();
}

/** CSV Savage Alike → строки для Dolphin Outreach (opener — если в файле есть готовый). */
function rowsFromCsv(text) {
  const seen = new Set();
  const out = [];
  for (const r of parseCsv(text)) {
    const username = handleOf(col(r, COLS.username));
    if (!username || !/^[a-z0-9._]{2,30}$/.test(username) || seen.has(username)) continue;
    seen.add(username);
    out.push({
      username,
      name: col(r, COLS.name),
      track: col(r, COLS.track).split(' | ')[0],
      opener: col(r, COLS.opener),
      listeners: col(r, COLS.listeners),
      spotify_url: col(r, COLS.spotify_url),
    });
  }
  return out;
}

/** Ждёт CSV, появившийся в dir после since (мс). */
async function waitNewCsv(dir, since, { timeoutMs = 15 * 60000, pollMs = 2000, onTick } = {}) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    let best = null;
    for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      if (!/\.csv$/i.test(name) || /^(money-hub-|type-beat-leads-)/i.test(name)) continue;
      const st = fs.statSync(path.join(dir, name));
      if (st.mtimeMs > since && (!best || st.mtimeMs > best.mtimeMs)) best = { file: path.join(dir, name), mtimeMs: st.mtimeMs };
    }
    if (best) {
      await new Promise((r) => setTimeout(r, 800)); // даём файлу дописаться
      return best.file;
    }
    if (onTick) onTick(Math.round((until - Date.now()) / 60000));
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error('Не дождался CSV из Savage Alike за 15 минут');
}

module.exports = { rowsFromCsv, waitNewCsv };
