// Простая база на JSON-файлах в data/. Один процесс — все операции синхронные,
// поэтому два потока никогда не возьмут одного и того же артиста.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { pickTemplate, renderOpener } from './templates.js';

export const STATUSES = ['new', 'queued', 'sent', 'failed', 'skipped'];

const DEFAULT_TEMPLATES = [
  { id: 't1', name: 'Коммент под битом', enabled: true, weight: 1,
    text: "{Yo|Yoo|Ayo} {{first_name:bro}}, {saw|peeped} your {last drop|latest track|recent post} — {you working on anything right now|you cooking up a project rn}, or just looking for sounds?" },
  { id: 't2', name: 'Простой', enabled: true, weight: 1,
    text: "{Yo|What's good} {{first_name:bro}}! {Been rocking with|Really fw} your music — you working on a project right now?" },
];

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    // Битый файл не затираем молча — откладываем в .bak
    fs.copyFileSync(file, `${file}.${Date.now()}.bak`);
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function localDay(iso) {
  const d = iso ? new Date(iso) : new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export class DB {
  constructor(dir = DATA_DIR) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.files = {
      artists: path.join(dir, 'artists.json'),
      templates: path.join(dir, 'templates.json'),
      profiles: path.join(dir, 'profiles.json'),
      runs: path.join(dir, 'runs.json'),
    };
    this.artists = readJson(this.files.artists, []);
    this.templates = readJson(this.files.templates, DEFAULT_TEMPLATES);
    this.profiles = readJson(this.files.profiles, { list: [], selected: [] });
    this.runs = readJson(this.files.runs, []);
    this.index = new Map(this.artists.map((a) => [a.username, a]));
    // Если программа упала посреди рассылки — «queued» без активного прогона возвращаем в очередь
    for (const a of this.artists) if (a.status === 'queued') this._release(a);
    this.save('artists');
  }

  save(...what) {
    for (const w of what.length ? what : Object.keys(this.files)) writeJson(this.files[w], this[w]);
  }

  // ---------- артисты ----------
  addArtists(list) {
    let added = 0;
    const duplicates = [];
    for (const a of list) {
      if (this.index.has(a.username)) { duplicates.push(a.username); continue; }
      const rec = {
        username: a.username,
        name: a.name || '',
        fields: a.fields || {},
        opener: a.opener || '',         // готовый опенер (если задан вручную или из CSV)
        openerSource: a.opener ? 'custom' : '',
        status: 'new',
        profileId: null,
        profileName: '',
        runId: null,
        sentAt: null,
        error: '',
        addedAt: new Date().toISOString(),
      };
      if (!rec.opener) this._generateOpener(rec);
      this.artists.push(rec);
      this.index.set(rec.username, rec);
      added++;
    }
    this.save('artists');
    return { added, duplicates };
  }

  _generateOpener(a) {
    const t = pickTemplate(this.templates);
    if (!t) return;
    a.opener = renderOpener(t.text, a).text;
    a.openerSource = t.id;
  }

  regenerateOpeners({ includeCustom = false } = {}) {
    let n = 0;
    for (const a of this.artists) {
      if (a.status !== 'new') continue;
      if (a.openerSource === 'custom' && !includeCustom) continue;
      this._generateOpener(a);
      n++;
    }
    this.save('artists');
    return n;
  }

  updateArtist(username, patch) {
    const a = this.index.get(username);
    if (!a) return null;
    if (typeof patch.opener === 'string') { a.opener = patch.opener; a.openerSource = 'custom'; }
    if (typeof patch.name === 'string') a.name = patch.name;
    if (patch.status && STATUSES.includes(patch.status) && patch.status !== 'queued') {
      a.status = patch.status;
      if (patch.status === 'new') this._release(a);
    }
    this.save('artists');
    return a;
  }

  deleteArtists(usernames) {
    const set = new Set(usernames);
    const before = this.artists.length;
    this.artists = this.artists.filter((a) => !(set.has(a.username) && a.status !== 'queued'));
    this.index = new Map(this.artists.map((a) => [a.username, a]));
    this.save('artists');
    return before - this.artists.length;
  }

  resetArtists(usernames) {
    let n = 0;
    for (const u of usernames) {
      const a = this.index.get(u);
      if (a && a.status !== 'queued') { a.status = 'new'; this._release(a); a.sentAt = null; n++; }
    }
    this.save('artists');
    return n;
  }

  stats() {
    const s = Object.fromEntries(STATUSES.map((k) => [k, 0]));
    for (const a of this.artists) s[a.status] = (s[a.status] || 0) + 1;
    s.total = this.artists.length;
    return s;
  }

  sentTodayByProfile(profileId) {
    const today = localDay();
    return this.artists.filter(
      (a) => a.status === 'sent' && String(a.profileId) === String(profileId) && a.sentAt && localDay(a.sentAt) === today,
    ).length;
  }

  /** Атомарно забирает n новых артистов под профиль. */
  claimArtists(n, profile, runId) {
    const out = [];
    for (const a of this.artists) {
      if (out.length >= n) break;
      if (a.status !== 'new') continue;
      if (!a.opener) this._generateOpener(a);
      if (!a.opener) continue; // нет ни шаблонов, ни своего опенера — пропускаем
      a.status = 'queued';
      a.profileId = profile.id;
      a.profileName = profile.name || '';
      a.runId = runId;
      a.error = '';
      out.push(a);
    }
    this.save('artists');
    return out;
  }

  _release(a) {
    a.status = 'new';
    a.profileId = null;
    a.profileName = '';
    a.runId = null;
  }

  releaseQueued(usernames) {
    let n = 0;
    for (const u of usernames) {
      const a = this.index.get(u);
      if (a && a.status === 'queued') { this._release(a); n++; }
    }
    this.save('artists');
    return n;
  }

  markSent(username, profile, at = new Date().toISOString()) {
    const a = this.index.get(username);
    if (!a || a.status === 'sent') return false;
    a.status = 'sent';
    a.profileId = profile.id;
    a.profileName = profile.name || '';
    a.sentAt = at;
    a.error = '';
    this.save('artists');
    return true;
  }

  markFailed(username, error) {
    const a = this.index.get(username);
    if (!a || a.status === 'sent' || a.status === 'failed') return false;
    a.status = 'failed';
    a.error = String(error || 'unknown');
    this.save('artists');
    return true;
  }

  markSkipped(username, note) {
    const a = this.index.get(username);
    if (!a || a.status === 'sent') return false;
    a.status = 'skipped';
    a.error = String(note || '');
    this.save('artists');
    return true;
  }

  // ---------- шаблоны ----------
  setTemplates(list) {
    this.templates = list.map((t, i) => ({
      id: t.id || `t${Date.now()}${i}`,
      name: String(t.name || `Шаблон ${i + 1}`),
      text: String(t.text || ''),
      weight: Number(t.weight) > 0 ? Number(t.weight) : 1,
      enabled: t.enabled !== false,
    }));
    this.save('templates');
    return this.templates;
  }

  // ---------- профили ----------
  setProfiles(list) {
    this.profiles.list = list;
    const ids = new Set(list.map((p) => String(p.id)));
    this.profiles.selected = this.profiles.selected.filter((id) => ids.has(String(id)));
    this.save('profiles');
  }

  addManualProfile(p) {
    if (!this.profiles.list.some((x) => String(x.id) === String(p.id))) {
      this.profiles.list.push({ id: String(p.id), name: p.name || `Профиль ${p.id}`, tags: [], manual: true });
      this.save('profiles');
    }
  }

  markProfileBlocked(profileId) {
    this.profiles.blocked = { ...(this.profiles.blocked || {}), [String(profileId)]: new Date().toISOString() };
    this.save('profiles');
  }

  isProfileBlockedToday(profileId) {
    const at = this.profiles.blocked?.[String(profileId)];
    return Boolean(at) && localDay(at) === localDay();
  }

  unblockProfile(profileId) {
    if (this.profiles.blocked) delete this.profiles.blocked[String(profileId)];
    this.save('profiles');
  }

  setSelected(ids) {
    this.profiles.selected = ids.map(String);
    this.save('profiles');
  }

  // ---------- история прогонов ----------
  addRun(run) {
    this.runs.unshift(run);
    this.runs = this.runs.slice(0, 200);
    this.save('runs');
  }

  updateRun(runId, patch) {
    const r = this.runs.find((x) => x.id === runId);
    if (r) { Object.assign(r, patch); this.save('runs'); }
  }
}
