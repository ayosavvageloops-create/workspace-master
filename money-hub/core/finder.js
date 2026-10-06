'use strict';
// Клиент встроенного API Artist Finder (127.0.0.1:8763, работает, пока открыто приложение).
//   POST /discover {seed, count, minListeners, maxListeners, filterFollowers, minFollowers, maxFollowers, exclude}
//   GET  /discover/:jobId → {state: resolving|walking|done|error, found, rows:[{name, igHandle, track, spotifyUrl, ...}]}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Finder {
  constructor(getPort) {
    this.getPort = getPort;
  }

  async call(method, path, body, timeoutMs = 10000) {
    const res = await fetch(`http://127.0.0.1:${this.getPort()}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || `Artist Finder ответил ${res.status}`);
    return data;
  }

  async alive() {
    try { await this.call('GET', '/health', null, 1500); return true; } catch { return false; }
  }

  async waitAlive(timeoutMs = 60000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (await this.alive()) return true;
      await sleep(1000);
    }
    return false;
  }

  /** Запускает поиск и ждёт результата. onProgress(found, want, state). */
  async discover(params, { onProgress, timeoutMs = 15 * 60000, pollMs = 2000 } = {}) {
    const { jobId } = await this.call('POST', '/discover', params);
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      await sleep(pollMs);
      const job = await this.call('GET', `/discover/${encodeURIComponent(jobId)}`);
      if (onProgress) onProgress(job.found ?? (job.rows || []).length, job.want ?? params.count, job.state);
      if (job.state === 'error') throw new Error(`Artist Finder: ${job.error || 'ошибка поиска'}`);
      if (job.state === 'done') return job;
    }
    throw new Error('Artist Finder не закончил поиск за 15 минут');
  }
}

/** Строки Artist Finder → строки для импорта в Dolphin Outreach. */
function toOutreachRows(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    const username = String(r.igHandle || r.instagram || '').replace(/^@/, '').trim().toLowerCase();
    if (!username || seen.has(username)) continue;
    seen.add(username);
    out.push({
      username,
      name: r.name || '',
      track: r.track || '',
      listeners: r.monthlyListeners ?? '',
      ig_followers: r.igFollowers ?? '',
      spotify_url: r.spotifyUrl || '',
    });
  }
  return out;
}

module.exports = { Finder, toOutreachRows };
