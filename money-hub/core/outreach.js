'use strict';
// Клиент HTTP API Dolphin Outreach (его панель на localhost:4747).

class Outreach {
  constructor(getPort) {
    this.getPort = getPort;
  }

  base() {
    return `http://127.0.0.1:${this.getPort()}`;
  }

  async call(method, path, body, timeoutMs = 8000) {
    const res = await fetch(this.base() + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Dolphin Outreach ответил ${res.status}`);
    return data;
  }

  async alive() {
    try { await this.call('GET', '/api/state', null, 1500); return true; } catch { return false; }
  }

  async waitAlive(timeoutMs = 30000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (await this.alive()) return true;
      await new Promise((r) => setTimeout(r, 700));
    }
    return false;
  }

  /** Короткая сводка для карточки в Money Hub. */
  async summary() {
    const s = await this.call('GET', '/api/state', null, 3000);
    const selected = new Set((s.selected || []).map(String));
    const profiles = (s.profiles || []).filter((p) => selected.has(String(p.id)));
    const slots = s.run?.slots || [];
    return {
      running: Boolean(s.run?.running),
      queue: s.stats?.new || 0,
      sentTotal: s.stats?.sent || 0,
      sentToday: profiles.reduce((n, p) => n + (p.sentToday || 0), 0),
      sentThisRun: slots.reduce((n, x) => n + (x.sent || 0), 0),
      profilesSelected: profiles.length,
      profilesBlocked: profiles.filter((p) => p.blockedToday).length,
      selectedIds: [...selected],
      lastLog: (s.log || []).slice(-1)[0]?.text || '',
    };
  }

  importCsv(text) {
    return this.call('POST', '/api/artists/import', { text });
  }

  async start({ concurrency, perProfile } = {}) {
    const s = await this.summary();
    if (s.running) return { already: true };
    if (!s.selectedIds.length) throw new Error('В Dolphin Outreach не выбраны профили: открой его панель → «Профили» и отметь нужные.');
    if (!s.queue) throw new Error('В очереди Dolphin Outreach нет новых артистов: сначала перенеси лиды.');
    return this.call('POST', '/api/run/start', { profileIds: s.selectedIds, concurrency, perProfile });
  }

  stop() {
    return this.call('POST', '/api/run/stop', {});
  }
}

module.exports = { Outreach };
