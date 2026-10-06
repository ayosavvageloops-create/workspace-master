// Адаптер под расширение IG Sender Pro (режим «2026»: артист → свой опенер).
// Код расширения не меняется: лаунчер через DevTools заходит в его service worker,
// кладёт в chrome.storage.local очередь `pairs`, включает mode2026 и вызывает startProcess().
// Прогресс читается обратно из тех же `pairs` (status: pending | sent | skipped | error).

const SRC = 'dolphin-outreach';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class IGSender {
  constructor(cdp, extCfg, log = () => {}) {
    this.cdp = cdp;
    this.cfg = extCfg;
    this.log = log;
    this.session = null;
    this.extId = null;
  }

  async _extensionWorkers() {
    const { targetInfos } = await this.cdp.send('Target.getTargets');
    return targetInfos.filter(
      (t) => (t.type === 'service_worker' || t.type === 'background_page') && t.url.startsWith('chrome-extension://'),
    );
  }

  /**
   * Находит service worker расширения и подключается к нему. Возвращает ID расширения.
   * Подходит воркер с ID из настроек ИЛИ с нужным названием в manifest.json —
   * ID в разных профилях может отличаться, поэтому ищем и по названию.
   */
  async attach(timeoutMs = 30000) {
    const wantId = (this.cfg.id || '').trim();
    const wantName = (this.cfg.name || 'IG Sender Pro').trim().toLowerCase();
    const wakeIds = [...new Set([wantId, ...(this.cfg.knownIds || [])].filter(Boolean))];
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    const rejected = new Set();
    let woke = false;
    while (Date.now() < deadline) {
      for (const t of await this._extensionWorkers()) {
        const id = new URL(t.url).host;
        if (rejected.has(id)) continue;
        const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
        let name = '';
        try {
          name = await this.cdp.evaluate(sessionId, 'chrome.runtime.getManifest().name', 5000);
        } catch { /* чужой воркер без chrome.runtime */ }
        if (id === wantId || String(name).toLowerCase().includes(wantName)) {
          this.session = sessionId;
          this.extId = id;
          return id;
        }
        rejected.add(id);
        await this.cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {});
      }
      // MV3-воркер мог уснуть — будим, открыв страницу расширения по известным ID
      if (!woke && wakeIds.length && Date.now() - startedAt > 3000) {
        woke = true;
        for (const id of wakeIds) {
          const { targetId } = await this.cdp.send('Target.createTarget', { url: `chrome-extension://${id}/sidepanel.html`, background: true });
          setTimeout(() => this.cdp.send('Target.closeTarget', { targetId }).catch(() => {}), 4000);
        }
      }
      await sleep(1500);
    }
    throw new Error(
      `Расширение «${this.cfg.name || 'IG Sender Pro'}» не найдено в профиле (установлено? включено?). ` +
      'Открой профиль вручную и проверь, или укажи ID расширения в настройках',
    );
  }

  async _eval(expr, timeoutMs) {
    try {
      return await this.cdp.evaluate(this.session, expr, timeoutMs);
    } catch (e) {
      // Воркер мог перезапуститься — переподключаемся один раз
      if (/target|session|closed|context/i.test(e.message)) {
        await this.attach(15000);
        return this.cdp.evaluate(this.session, expr, timeoutMs);
      }
      throw e;
    }
  }

  /** Открывает вкладку Instagram и проверяет, что аккаунт залогинен. */
  async openInstagram(url = 'https://www.instagram.com/direct/inbox/') {
    const { targetId } = await this.cdp.send('Target.createTarget', { url });
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true });
    let state = 'loading';
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      await sleep(2000);
      state = await this.cdp
        .evaluate(sessionId, `(() => {
          if (document.readyState !== 'complete') return 'loading';
          if (document.querySelector('form input[name="username"]') || /\\/accounts\\/login/.test(location.pathname)) return 'login';
          if (/\\/challenge\\/|\\/accounts\\/suspended/.test(location.pathname)) return 'challenge';
          return 'ok';
        })()`, 10000)
        .catch(() => 'loading');
      if (state !== 'loading') break;
    }
    await this.cdp.send('Target.activateTarget', { targetId }).catch(() => {});
    await this.cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {});
    return state;
  }

  /** Кладёт очередь артистов в расширение. Чужую (ручную) очередь сохраняет в бэкап. */
  async loadQueue(jobId, artists) {
    this.loadedAt = Date.now();
    const pairs = artists.map((a) => ({ user: a.username, opener: a.opener, status: 'pending', note: '', ts: 0, src: SRC, jobId }));
    const extra = {};
    if (this.cfg.delays && Number(this.cfg.delays.min) > 0 && Number(this.cfg.delays.max) >= Number(this.cfg.delays.min)) {
      extra.delays = { min: Number(this.cfg.delays.min), max: Number(this.cfg.delays.max) };
    }
    if (this.cfg.methods && typeof this.cfg.methods === 'object') extra.modes2026 = this.cfg.methods;
    await this._eval(`(async () => {
      const d = await chrome.storage.local.get(['pairs', 'isRunning']);
      if (d.isRunning) { try { await stopBot(); } catch (e) { await chrome.storage.local.set({ isRunning: false }); } }
      const old = (d.pairs || []).filter(p => p.src !== ${JSON.stringify(SRC)} && (!p.status || p.status === 'pending'));
      if (old.length) await chrome.storage.local.set({ pairsBackupBeforeDolphin: old });
      await chrome.storage.local.set(Object.assign({
        pairs: ${JSON.stringify(pairs)},
        pairIndex: 0, mode2026: true, modeFollowup: false, stage2026: null,
      }, ${JSON.stringify(extra)}));
      return true;
    })()`);
  }

  async start() {
    if (this.cfg.lang) await this._eval(`chrome.storage.local.set({ lang: ${JSON.stringify(this.cfg.lang)} })`);
    await this._eval('startProcess().then(() => true)', 60000);
  }

  async stop() {
    await this._eval('stopBot().then(() => true)', 15000).catch(() => {});
  }

  /** → { state: running|done|stopped|blocked, items: [{user,status,note}] } */
  async status(jobId) {
    const d = await this._eval(`chrome.storage.local.get(['pairs', 'isRunning', 'sentLog'])`, 15000);
    const sentLog = d.sentLog || {};
    const items = (d.pairs || [])
      .filter((p) => p.jobId === jobId)
      .map((p) => {
        let status = p.status || 'pending';
        // Сообщение ушло, но отчёт не успел записаться (например, нажали «Стоп») — считаем отправленным
        const log = sentLog[String(p.user).toLowerCase()];
        if (status === 'pending' && log && log.ts >= (this.loadedAt || 0)) status = 'sent';
        return { user: p.user, status, note: p.note || '' };
      });
    const pending = items.filter((i) => i.status === 'pending').length;
    let state = 'running';
    if (!d.isRunning) {
      // Ограничение проверяем первым: оно могло прийти и на последнем артисте пачки
      if (items.some((i) => i.status === 'error' && /challenge|limited|blocked/i.test(i.note))) state = 'blocked';
      else if (!pending) state = 'done';
      else state = 'stopped';
    }
    return { state, items };
  }
}
