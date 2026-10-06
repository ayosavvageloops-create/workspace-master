'use strict';
// Мост Type Beat Leads → Dolphin Outreach: берём свежий экспорт из «Загрузок»,
// оставляем артистов (🔥 горячих и тёплых) и приводим к колонкам Dolphin Outreach.
const fs = require('node:fs');
const path = require('node:path');
const { parseCsv, toCsv } = require('./csv');

const FILE_RE = /^type-beat-leads-.*\.csv$/i;

function findLatestExport(dir) {
  let best = null;
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { return null; }
  for (const name of entries) {
    if (!FILE_RE.test(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (!best || st.mtimeMs > best.mtimeMs) best = { file: full, name, mtimeMs: st.mtimeMs };
  }
  return best;
}

function firstName(fullName) {
  const word = String(fullName || '').trim().split(/\s+/)[0] || '';
  // только «человеческое» имя: буквы, без эмодзи и цифр
  return /^[\p{L}][\p{L}'-]{1,20}$/u.test(word) ? word : '';
}

/** Строки экспорта Type Beat Leads → строки для импорта в Dolphin Outreach. */
function toOutreachRows(rows, { priorities = ['hot', 'warm'] } = {}) {
  const want = new Set(priorities);
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const username = String(r.username || '').replace(/^@/, '').trim().toLowerCase();
    if (!username || seen.has(username)) continue;
    if (!want.has(String(r.priority || '').toLowerCase())) continue;
    seen.add(username);
    out.push({
      username,
      name: firstName(r.full_name),
      priority: r.priority,
      followers: r.followers,
      producer: String(r.producers || '').split(/\s+/)[0] || '',
      comment: r.best_comment || '',
    });
  }
  return out;
}

function summarize(rows) {
  const by = (p) => rows.filter((r) => r.priority === p).length;
  return { total: rows.length, hot: by('hot'), warm: by('warm') };
}

function prepareImport(file, opts) {
  const rows = toOutreachRows(parseCsv(fs.readFileSync(file, 'utf8')), opts);
  return {
    rows,
    counts: summarize(rows),
    csv: toCsv(rows, ['username', 'name', 'priority', 'followers', 'producer', 'comment']),
  };
}

module.exports = { findLatestExport, toOutreachRows, prepareImport, firstName };
