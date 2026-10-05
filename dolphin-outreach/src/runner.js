// Диспетчер: N окон одновременно, на каждый профиль — свой пакет артистов,
// следующий профиль запускается, как только освободилось место.
import { EventEmitter } from 'node:events';
import { CDP } from './cdp.js';
import { IGSender } from './igsender.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Runner extends EventEmitter {
  /**
   * @param {object} o
   * @param {() => object} o.getConfig
   * @param {import('./db.js').DB} o.db
   * @param {import('./dolphin.js').Dolphin} o.dolphin
   * @param {(id: string) => void} [o.onExtensionId] — запомнить найденный ID расширения (для пробуждения воркера)
   */
  constructor({ getConfig, db, dolphin, onExtensionId, connect = CDP.connect }) {
    super();
    this.getConfig = getConfig;
    this.db = db;
    this.dolphin = dolphin;
    this.onExtensionId = onExtensionId || (() => {});
    this.connect = connect;
    this.state = { running: false, runId: null, startedAt: null, slots: [], aborting: false };
    this.manualWaiters = new Map();
  }

  log(text, level = 'info', profile) {
    const line = { ts: new Date().toISOString(), level, text: profile ? `[${profile.name}] ${text}` : text };
    this.emit('log', line);
  }

  _slot(profileId) {
    return this.state.slots.find((s) => s.profileId === String(profileId));
  }

  _update(profileId, patch) {
    const s = this._slot(profileId);
    if (s) Object.assign(s, patch);
    this.emit('update', this.snapshot());
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  /** Сколько артистов получит каждый профиль — без запуска. */
  plan({ profileIds, perProfile }) {
    const cfg = this.getConfig();
    const per = Number(perProfile) || cfg.run.artistsPerProfile;
    let available = this.db.artists.filter((a) => a.status === 'new' && a.opener).length;
    return profileIds.map((id) => {
      const p = this.db.profiles.list.find((x) => String(x.id) === String(id)) || { id, name: id };
      const blocked = this.db.isProfileBlockedToday(id);
      const room = Math.max(0, cfg.run.dailyLimitPerProfile - this.db.sentTodayByProfile(id));
      const n = blocked ? 0 : Math.min(per, room, available);
      available -= n;
      return { profileId: String(id), name: p.name, take: n, sentToday: this.db.sentTodayByProfile(id), blocked };
    });
  }

  async start({ profileIds, concurrency, perProfile }) {
    if (this.state.running) throw new Error('Рассылка уже идёт');
    if (!profileIds?.length) throw new Error('Не выбраны профили');
    const cfg = this.getConfig();
    const conc = Math.max(1, Number(concurrency) || cfg.run.concurrency);
    const per = Math.max(1, Number(perProfile) || cfg.run.artistsPerProfile);
    const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const profiles = profileIds.map((id) => this.db.profiles.list.find((x) => String(x.id) === String(id)) || { id: String(id), name: String(id) });

    this.state = {
      running: true, aborting: false, runId, startedAt: new Date().toISOString(),
      concurrency: conc, perProfile: per,
      slots: profiles.map((p) => ({
        profileId: String(p.id), name: p.name, phase: 'waiting', message: '',
        total: 0, sent: 0, skipped: 0, failed: 0, pending: 0, artists: [],
      })),
    };
    this.db.addRun({ id: runId, startedAt: this.state.startedAt, profiles: profiles.map((p) => p.name), concurrency: conc, perProfile: per, sent: 0, finishedAt: null });
    this.log(`▶ Старт: ${profiles.length} профил(ей), по ${conc} окна одновременно, по ${per} артистов на профиль`);
    this.emit('update', this.snapshot());

    const queue = [...profiles];
    let noMoreArtists = false;
    const worker = async (slotNo) => {
      await sleep(slotNo * cfg.run.startStaggerSec * 1000);
      while (queue.length && !this.state.aborting && !noMoreArtists) {
        const p = queue.shift();
        const r = await this._runProfile(p, per).catch((e) => {
          this.log(`❌ ${e.message}`, 'error', p);
          this._update(p.id, { phase: 'error', message: e.message });
          return {};
        });
        if (r.noArtists) noMoreArtists = true;
      }
    };
    this._done = Promise.all(Array.from({ length: Math.min(conc, profiles.length) }, (_, i) => worker(i))).finally(() => {
      for (const s of this.state.slots) if (s.phase === 'waiting') { s.phase = 'skipped'; s.message ||= noMoreArtists ? 'артисты закончились' : 'остановлено'; }
      const sent = this.state.slots.reduce((n, s) => n + s.sent, 0);
      this.db.updateRun(runId, { finishedAt: new Date().toISOString(), sent, aborted: this.state.aborting });
      this.state.running = false;
      this.log(`■ Готово. Отправлено за прогон: ${sent}`);
      this.emit('update', this.snapshot());
    });
    return { runId };
  }

  async stop() {
    if (!this.state.running) return;
    this.state.aborting = true;
    this.log('⏹ Остановка: даём расширениям закончить текущего артиста и закрываем профили…', 'warn');
    for (const [, w] of this.manualWaiters) w({ aborted: true });
    this.emit('update', this.snapshot());
  }

  wait() {
    return this._done || Promise.resolve();
  }

  /** Ручной режим: отметить итог по профилю из панели. */
  finishManual(profileId, { sent = [], failed = [] } = {}) {
    const w = this.manualWaiters.get(String(profileId));
    if (!w) return false;
    w({ sent, failed });
    return true;
  }

  async _runProfile(p, per) {
    const cfg = this.getConfig();
    const id = String(p.id);
    if (this.db.isProfileBlockedToday(id)) {
      this._update(id, { phase: 'skipped', message: 'сегодня ловил ограничение Instagram — пропускаю' });
      this.log('⏭ Пропуск: профиль сегодня уже получал ограничение', 'warn', p);
      return {};
    }
    const room = cfg.run.dailyLimitPerProfile - this.db.sentTodayByProfile(id);
    const n = Math.min(per, room);
    if (n <= 0) {
      this._update(id, { phase: 'skipped', message: `дневной лимит ${cfg.run.dailyLimitPerProfile} уже выбран` });
      this.log('⏭ Пропуск: дневной лимит выбран', 'warn', p);
      return {};
    }
    const artists = this.db.claimArtists(n, p, this.state.runId);
    if (!artists.length) {
      this._update(id, { phase: 'skipped', message: 'нет новых артистов в базе' });
      this.log('⏭ Новых артистов в базе нет — дальше не запускаю', 'warn', p);
      return { noArtists: true };
    }
    const usernames = artists.map((a) => a.username);
    const jobId = `${this.state.runId}:${id}`;
    this._update(id, {
      phase: 'starting', message: 'запуск профиля…', total: artists.length, pending: artists.length,
      artists: artists.map((a) => ({ username: a.username, name: a.name, opener: a.opener, status: 'pending', note: '' })),
    });

    let cdp;
    let started = false;
    try {
      this.log(`🚀 Запуск профиля, артистов: ${artists.length}`, 'info', p);
      const conn = await this.dolphin.start(id);
      started = true;
      cdp = await this.connect(conn.wsUrl);

      if (cfg.extension.mode === 'manual') return await this._manual(p, cdp, usernames);

      const ext = new IGSender(cdp, cfg.extension, (t) => this.log(t, 'info', p));
      const extId = await ext.attach();
      if (extId && !(cfg.extension.knownIds || []).includes(extId)) this.onExtensionId(extId);

      this._update(id, { message: 'открываю Instagram…' });
      const ig = await ext.openInstagram(cfg.extension.openUrl);
      if (ig === 'login') throw new Error('Instagram не залогинен в этом профиле');
      if (ig === 'challenge') {
        this.db.markProfileBlocked(id);
        throw new Error('Instagram требует подтверждение (challenge) — профиль пропущен');
      }

      await ext.loadQueue(jobId, artists);
      await ext.start();
      this._update(id, { phase: 'sending', message: 'расширение рассылает' });
      this.log('✉️ Очередь загружена в IG Sender Pro, рассылка пошла', 'info', p);

      await this._watch(p, ext, jobId);
    } finally {
      const left = this.db.releaseQueued(usernames);
      if (left) this.log(`↩ ${left} артист(ов) вернул в очередь`, 'info', p);
      cdp?.close();
      if (started && cfg.run.closeWhenDone) {
        await this.dolphin.stop(id).catch(() => {});
        this.log('Профиль закрыт', 'info', p);
      }
    }
    return {};
  }

  async _watch(p, ext, jobId) {
    const cfg = this.getConfig();
    const id = String(p.id);
    const deadline = Date.now() + cfg.run.profileTimeoutMin * 60000;
    const seen = new Map();
    let errors = 0;
    let stopSent = false;
    for (;;) {
      await sleep(cfg.run.pollSec * 1000);
      let st;
      try {
        st = await ext.status(jobId);
        errors = 0;
      } catch (e) {
        if (++errors >= 5) throw new Error(`Потеряна связь с профилем: ${e.message}`);
        continue;
      }
      for (const it of st.items) {
        if (seen.get(it.user) === it.status) continue;
        seen.set(it.user, it.status);
        if (it.status === 'sent') {
          this.db.markSent(it.user, p);
          this.log(`✅ @${it.user}`, 'ok', p);
        } else if (it.status === 'skipped') {
          this.db.markSkipped(it.user, it.note);
          this.log(`⏭ @${it.user}: ${it.note || 'пропущен расширением'}`, 'info', p);
        } else if (it.status === 'error') {
          this.db.markFailed(it.user, it.note);
          this.log(`❌ @${it.user}: ${it.note || 'ошибка'}`, 'error', p);
        }
      }
      const count = (s) => st.items.filter((i) => i.status === s).length;
      const slot = this._slot(id);
      for (const a of slot.artists) {
        const it = st.items.find((i) => i.user === a.username);
        if (it) { a.status = it.status; a.note = it.note; }
      }
      this._update(id, { sent: count('sent'), skipped: count('skipped'), failed: count('error'), pending: count('pending') });

      if (st.state === 'done') {
        this._update(id, { phase: 'done', message: 'готово' });
        this.log(`🏁 Профиль закончил: отправлено ${count('sent')}`, 'ok', p);
        return;
      }
      if (st.state === 'blocked') {
        this.db.markProfileBlocked(id);
        this._update(id, { phase: 'blocked', message: 'Instagram ограничил аккаунт — профиль остановлен до завтра' });
        this.log('🛑 Instagram ограничил действия — профиль остановлен, остаток вернул в очередь', 'error', p);
        return;
      }
      if (st.state === 'stopped') {
        this._update(id, { phase: stopSent ? 'stopped' : 'error', message: stopSent ? 'остановлено' : 'расширение остановилось само (разлогин / нет вкладки Instagram / нажали «Стоп»)' });
        this.log('⚠️ Расширение остановилось, остаток вернул в очередь', 'warn', p);
        return;
      }
      if ((this.state.aborting || Date.now() > deadline) && !stopSent) {
        if (!this.state.aborting) this.log('⏰ Время на профиль вышло — останавливаю', 'warn', p);
        stopSent = true;
        await ext.stop();
      }
    }
  }

  async _manual(p, cdp, usernames) {
    const cfg = this.getConfig();
    const id = String(p.id);
    await cdp.send('Target.createTarget', { url: cfg.extension.openUrl }).catch(() => {});
    this._update(id, { phase: 'manual', message: 'профиль открыт — отправь вручную и отметь результат в панели' });
    this.log('👐 Ручной режим: профиль открыт, жду отметки в панели', 'info', p);
    const result = await new Promise((resolve) => {
      this.manualWaiters.set(id, resolve);
      setTimeout(() => resolve({ timeout: true }), cfg.run.profileTimeoutMin * 60000);
    });
    this.manualWaiters.delete(id);
    for (const u of result.sent || []) if (usernames.includes(u)) this.db.markSent(u, p);
    for (const u of result.failed || []) if (usernames.includes(u)) this.db.markFailed(u, 'отмечено вручную');
    this._update(id, { phase: 'done', sent: (result.sent || []).length, failed: (result.failed || []).length, pending: 0, message: result.aborted ? 'остановлено' : 'готово' });
    return {};
  }
}
