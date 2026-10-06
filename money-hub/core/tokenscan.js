'use strict';
// Ищет уже сохранённый Dolphin API токен в настройках других программ на этом Маке
// (Savage DM Bot 2 / Savage Bot 1 хранят его как dolphin_token).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const KEYS = ['dolphin_token', 'dolphinToken', 'dolphin_api_token', 'dolphinApiToken'];
const FILES = ['data/settings.json', 'settings.json', 'data/config.json', 'config.json'];

function pick(obj) {
  if (!obj || typeof obj !== 'object') return '';
  for (const k of KEYS) if (typeof obj[k] === 'string' && obj[k].trim().length > 20) return obj[k].trim();
  const nested = obj.dolphin && obj.dolphin.token;
  return typeof nested === 'string' && nested.trim().length > 20 ? nested.trim() : '';
}

/** → { token, source } или null. base — папка Application Support. */
function findDolphinToken(base = path.join(os.homedir(), 'Library', 'Application Support')) {
  let dirs = [];
  try { dirs = fs.readdirSync(base); } catch { return null; }
  // сначала программы, где токен точно бывает
  dirs.sort((a, b) => Number(/savage/i.test(b)) - Number(/savage/i.test(a)));
  for (const d of dirs) {
    if (!/savage|dolphin|outreach|instagram|bot/i.test(d)) continue;
    for (const f of FILES) {
      const file = path.join(base, d, f);
      let data;
      try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
      const token = pick(data);
      if (token) return { token, source: d };
    }
  }
  return null;
}

module.exports = { findDolphinToken };
