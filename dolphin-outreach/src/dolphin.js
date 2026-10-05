// Клиент Dolphin{anty}: локальный API (запуск/остановка профилей) + облачный API (список профилей).

async function json(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Dolphin ответил не JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
}

export class Dolphin {
  constructor(cfg) {
    this.cfg = cfg;
    this.loggedIn = false;
  }

  get local() { return this.cfg.dolphin.localApi.replace(/\/+$/, ''); }
  get cloud() { return this.cfg.dolphin.cloudApi.replace(/\/+$/, ''); }

  /** Новые версии Dolphin требуют авторизовать локальный API токеном перед стартом профилей. */
  async login() {
    if (this.loggedIn || !this.cfg.dolphin.token) return;
    const res = await fetch(`${this.local}/v1.0/auth/login-with-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: this.cfg.dolphin.token }),
    });
    const data = await json(res).catch(() => ({}));
    if (!res.ok || data.success === false) {
      throw new Error(`Не удалось авторизоваться в локальном API Dolphin: ${data.error || data.message || `HTTP ${res.status}`}`);
    }
    this.loggedIn = true;
  }

  async listProfiles() {
    if (!this.cfg.dolphin.token) throw new Error('Не указан API-токен Dolphin (Настройки)');
    const out = [];
    for (let page = 1; page < 100; page++) {
      const res = await fetch(`${this.cloud}/browser_profiles?limit=100&page=${page}`, {
        headers: { Authorization: `Bearer ${this.cfg.dolphin.token}` },
      });
      const data = await json(res);
      if (!res.ok) throw new Error(`Dolphin API: ${data.error || data.message || `HTTP ${res.status}`}`);
      for (const p of data.data || []) {
        out.push({
          id: String(p.id),
          name: p.name || `Профиль ${p.id}`,
          tags: Array.isArray(p.tags) ? p.tags : [],
          notes: typeof p.notes === 'object' && p.notes ? p.notes.content || '' : p.notes || '',
        });
      }
      const last = data.last_page || data.meta?.last_page || 1;
      if (page >= last || !(data.data || []).length) break;
    }
    return out;
  }

  async start(profileId) {
    await this.login();
    const q = `automation=1${this.cfg.dolphin.headless ? '&headless=1' : ''}`;
    const call = async () => {
      const res = await fetch(`${this.local}/v1.0/browser_profiles/${encodeURIComponent(profileId)}/start?${q}`);
      return json(res);
    };
    let data = await call();
    if (!data.automation && /already|running|запущ/i.test(JSON.stringify(data))) {
      // Профиль висит открытым с прошлого раза — перезапускаем
      await this.stop(profileId).catch(() => {});
      await new Promise((r) => setTimeout(r, 3000));
      data = await call();
    }
    if (!data.automation || !data.automation.port) {
      throw new Error(`Профиль ${profileId} не запустился: ${data.error || data.message || JSON.stringify(data).slice(0, 200)}`);
    }
    const { port, wsEndpoint } = data.automation;
    return { port, wsEndpoint, wsUrl: `ws://127.0.0.1:${port}${wsEndpoint}` };
  }

  async stop(profileId) {
    const res = await fetch(`${this.local}/v1.0/browser_profiles/${encodeURIComponent(profileId)}/stop`);
    return json(res).catch(() => ({}));
  }
}
