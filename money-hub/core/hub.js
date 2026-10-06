'use strict';
// Командный центр: состояние программ, действия над ними и сценарии.
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { MODULES, SCENARIOS } = require('./modules');
const { Processes } = require('./processes');
const { Outreach } = require('./outreach');
const leads = require('./leads');
const { Finder, toOutreachRows } = require('./finder');
const { toCsv } = require('./csv');

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Hub extends EventEmitter {
  constructor({ store, processes, outreach, platform = process.platform } = {}) {
    super();
    this.store = store;
    this.platform = platform;
    this.procs = processes || new Processes();
    this.outreach = outreach || new Outreach(() => this.store.get('outreachPort'));
    this.finder = new Finder(() => this.store.get('finderPort'));
    this.found = null; // последние найденные артисты (этап 1)
    this.runs = {}; // id сценария -> { running, steps: [{status, note}] }
    this.procs.on('change', () => this.emit('change'));
    this.procs.on('log', (id) => this.emit('log', id));
  }

  module(id) {
    const m = MODULES.find((x) => x.id === id);
    if (!m) throw new Error(`Нет программы ${id}`);
    return m;
  }

  dirOf(m) {
    const own = this.store.get('paths')[m.id];
    if (own) return own;
    return m.dir ? path.join(this.store.get('workspaceDir'), m.dir) : null;
  }

  // ---------- состояние ----------

  async appRunning(appName) {
    if (this.platform !== 'darwin') return false;
    const r = await this.procs.run(`pgrep -if ${q(`${appName}.app/Contents/MacOS`)} >/dev/null`, undefined, 3000);
    return r.ok;
  }

  async moduleState(m) {
    const dir = this.dirOf(m);
    const found = !dir || fs.existsSync(dir);
    const base = { id: m.id, title: m.title, role: m.role, kind: m.kind, dir, found, log: Boolean(this.procs.getLog(m.id)) };
    if (m.kind === 'server' && m.id === 'dolphin-outreach') {
      const alive = await this.outreach.alive();
      const own = this.procs.state(m.id);
      const st = { ...base, status: alive ? 'running' : own.status === 'running' ? 'starting' : own.status === 'failed' ? 'failed' : 'idle' };
      if (alive) {
        try { st.outreach = await this.outreach.summary(); } catch { /* панель отвечает не сразу */ }
        if (own.status !== 'running') st.external = true;
      }
      return st;
    }
    if (m.kind === 'process') return { ...base, status: this.procs.state(m.id).status };
    if (m.kind === 'app') return { ...base, found: true, status: (await this.appRunning(m.appName)) ? 'running' : 'idle' };
    if (m.kind === 'finder') {
      const alive = await this.finder.alive();
      return { ...base, found: true, status: alive ? 'running' : 'idle', foundCount: this.found ? this.found.length : null };
    }
    if (m.kind === 'chrome') {
      const latest = leads.findLatestExport(this.store.get('downloadsDir'));
      return { ...base, status: 'tool', latestExport: latest && { name: latest.name, mtimeMs: latest.mtimeMs, imported: this.isImported(latest) } };
    }
    return { ...base, status: 'tool' };
  }

  async snapshot() {
    const modules = await Promise.all(MODULES.map((m) => this.moduleState(m)));
    const scenarios = SCENARIOS.map((s) => ({
      ...s,
      disabled: this.store.get('disabledSteps')[s.id] || [],
      run: this.runs[s.id] || null,
    }));
    return { modules, scenarios, settings: this.publicSettings() };
  }

  // ---------- действия над программами ----------

  async openApp(m) {
    const r = await this.procs.run(`open -a ${q(m.appName)}`);
    if (r.ok) return;
    const dir = this.dirOf(m);
    if (m.fallbackFile && dir && fs.existsSync(path.join(dir, m.fallbackFile))) {
      await this.openUrl(path.join(dir, m.fallbackFile), true);
      return;
    }
    throw new Error(`Не получилось открыть «${m.appName}». Установлена ли программа в «Программы»?`);
  }

  async openUrl(url, inChrome = false) {
    const r = await this.procs.run(inChrome ? `open -a 'Google Chrome' ${q(url)} || open ${q(url)}` : `open ${q(url)}`);
    if (!r.ok) throw new Error(`Не открылось: ${url}`);
  }

  ensureDir(m) {
    const dir = this.dirOf(m);
    if (!dir || !fs.existsSync(dir)) {
      throw new Error(`Папка «${m.title}» не найдена: ${dir}. Укажи её в Настройках.`);
    }
    return dir;
  }

  async startServer(m) {
    let res = 'уже работает';
    if (!(await this.outreach.alive())) {
      this.procs.start(m.id, m.cmd, this.ensureDir(m));
      if (!(await this.outreach.waitAlive(45000))) {
        throw new Error('Dolphin Outreach не ответил за 45 секунд. Открой лог программы.');
      }
      res = 'запущен';
    }
    await this.pushToken();
    return res;
  }

  /** Токен Dolphin из настроек Money Hub → в Dolphin Outreach. */
  async pushToken() {
    const token = this.store.get('dolphinToken');
    if (token && (await this.outreach.alive())) await this.outreach.setToken(token);
  }

  async saveSettings(patch) {
    this.store.set(patch);
    if ('dolphinToken' in patch) await this.pushToken();
    this.emit('change');
    return this.publicSettings();
  }

  publicSettings() {
    const { dolphinToken, usedHandles, ...rest } = this.store.data;
    return { ...rest, hasDolphinToken: Boolean(dolphinToken), usedCount: usedHandles.length };
  }

  async action(id, act) {
    const m = this.module(id);
    switch (act) {
      case 'start':
        if (m.kind === 'server') return this.startServer(m);
        if (m.kind === 'process') return this.procs.start(m.id, m.cmd, this.ensureDir(m));
        if (m.kind === 'app') return this.openApp(m);
        if (m.kind === 'finder') return this.startFinder();
        return this.openUrl(m.url, m.kind === 'chrome');
      case 'stop':
        if (m.kind === 'app') return this.procs.run(`osascript -e ${q(`quit app "${m.appName}"`)}`);
        return this.procs.stop(m.id);
      case 'panel':
        return this.openUrl(`http://localhost:${this.store.get('outreachPort')}`);
      case 'outreach-start':
        return this.outreach.start();
      case 'outreach-stop':
        return this.outreach.stop();
      case 'import-leads':
        return this.importLeads({ force: true });
      case 'folder':
        return this.procs.run(`open ${q(this.ensureDir(m))}`);
      default:
        throw new Error(`Неизвестное действие ${act}`);
    }
  }

  log(id) {
    return this.procs.getLog(id);
  }

  // ---------- лиды ----------

  isImported(latest) {
    return this.store.get('imported').includes(`${latest.name}|${Math.round(latest.mtimeMs)}`);
  }

  async importLeads({ force = false } = {}) {
    const latest = leads.findLatestExport(this.store.get('downloadsDir'));
    if (!latest) return { skipped: true, note: 'в «Загрузках» нет экспорта type-beat-leads-*.csv' };
    if (!force && this.isImported(latest)) return { skipped: true, note: `${latest.name} уже перенесён` };
    const prep = leads.prepareImport(latest.file);
    if (!prep.rows.length) return { skipped: true, note: `в ${latest.name} нет горячих/тёплых артистов` };
    if (!(await this.outreach.alive())) throw new Error('Dolphin Outreach не запущен');
    const r = await this.outreach.importCsv(prep.csv);
    const key = `${latest.name}|${Math.round(latest.mtimeMs)}`;
    this.store.set({ imported: [...this.store.get('imported').filter((k) => k !== key), key].slice(-50) });
    this.emit('change');
    const dup = r.duplicates?.length ? `, уже были в базе: ${r.duplicates.length}` : '';
    return { note: `${latest.name}: 🔥 ${prep.counts.hot}, тёплых ${prep.counts.warm} → новых в очереди: ${r.added ?? 0}${dup}` };
  }

  // ---------- сценарии ----------

  setStepEnabled(scenarioId, index, enabled) {
    const all = { ...this.store.get('disabledSteps') };
    const set = new Set(all[scenarioId] || []);
    if (enabled) set.delete(index); else set.add(index);
    all[scenarioId] = [...set].sort((a, b) => a - b);
    this.store.set({ disabledSteps: all });
    this.emit('change');
  }

  async startFinder() {
    if (await this.finder.alive()) return 'уже открыт';
    await this.openApp(this.module('artist-finder'));
    if (!(await this.finder.waitAlive(60000))) {
      throw new Error('Artist Finder открылся, но его API (порт 8763) не ответил за минуту. Обнови Artist Finder до версии с «control server».');
    }
    return 'открыт';
  }

  async discover(progress) {
    const p = this.store.get('stage1');
    const seed = String(p.seed || '').trim();
    if (!seed) throw new Error('Не задан референс-артист (вкладка «Этап 1»)');
    const job = await this.finder.discover({
      seed,
      count: Math.min(500, Math.max(1, Number(p.count) || 100)),
      minListeners: Number(p.minListeners) || 0,
      maxListeners: Number(p.maxListeners) || 0,
      filterFollowers: Boolean(p.filterFollowers),
      minFollowers: Number(p.minFollowers) || 0,
      maxFollowers: Number(p.maxFollowers) || 0,
      exclude: this.store.get('usedHandles'),
    }, { onProgress: (found, want, state) => progress(`${state === 'resolving' ? 'ищу референс…' : 'ищу'} найдено ${found} из ${want}`) });
    this.found = toOutreachRows(job.rows);
    if (!this.found.length) return { skipped: true, note: `${job.seedName || seed}: никого не нашлось под эти фильтры` };
    return `${job.seedName || seed}: найдено ${this.found.length} артистов с Instagram`;
  }

  async prepareOutreach() {
    const templates = (this.store.get('templates') || []).map((t) => String(t).trim()).filter(Boolean);
    if (!templates.length) throw new Error('Нет ни одного шаблона опенера (вкладка «Этап 1»)');
    await this.outreach.setTemplates(templates);
    const methods = this.store.get('methods');
    if (!methods.dm && !methods.story && !methods.post) throw new Error('Не выбран ни один способ отправки');
    await this.outreach.setMethods(methods);
    const on = [methods.dm && 'директ', methods.story && 'сторис', methods.post && 'пост'].filter(Boolean).join(', ');
    return `шаблонов: ${templates.length}; способы: ${on}`;
  }

  async importFound() {
    if (!this.found || !this.found.length) throw new Error('Нет найденных артистов: сначала шаг поиска');
    const csv = toCsv(this.found, ['username', 'name', 'track', 'listeners', 'ig_followers', 'spotify_url']);
    const r = await this.outreach.importCsv(csv);
    const used = new Set(this.store.get('usedHandles'));
    for (const a of this.found) used.add(a.username);
    this.store.set({ usedHandles: [...used].slice(-20000) });
    const dup = r.duplicates?.length ? `, уже были в базе: ${r.duplicates.length}` : '';
    return `в очередь добавлено ${r.added ?? 0}${dup}`;
  }

  async runStep(step, progress = () => {}) {
    switch (step.type) {
      case 'startFinder':
        return this.startFinder();
      case 'discover':
        return this.discover(progress);
      case 'prepareOutreach':
        return this.prepareOutreach();
      case 'importFound':
        return this.importFound();
      case 'openApp': {
        const m = this.module(step.module);
        if (await this.appRunning(m.appName)) return 'уже открыт';
        await this.openApp(m);
        if (step.waitSec) await sleep(step.waitSec * 1000);
        return 'открыт';
      }
      case 'startServer':
        return this.startServer(this.module(step.module));
      case 'startProcess': {
        const m = this.module(step.module);
        if (this.procs.isRunning(m.id)) return 'уже работает';
        this.procs.start(m.id, m.cmd, this.ensureDir(m));
        return 'запущен';
      }
      case 'openModule':
        await this.action(step.module, 'start');
        return 'открыт';
      case 'openUrl':
        await this.openUrl(step.url);
        return 'открыт';
      case 'importLeads': {
        const r = await this.importLeads();
        return r.skipped ? { skipped: true, note: r.note } : r.note;
      }
      case 'startOutreach': {
        const r = await this.outreach.start();
        return r.already ? 'уже идёт' : 'рассылка идёт';
      }
      default:
        throw new Error(`Неизвестный шаг ${step.type}`);
    }
  }

  async runScenario(id) {
    const sc = SCENARIOS.find((s) => s.id === id);
    if (!sc) throw new Error('Нет такого сценария');
    if (this.runs[id]?.running) return;
    const disabled = new Set(this.store.get('disabledSteps')[id] || []);
    const run = {
      running: true,
      startedAt: Date.now(),
      steps: sc.steps.map((_, i) => ({ status: disabled.has(i) ? 'off' : 'wait', note: '' })),
    };
    this.runs[id] = run;
    this.emit('change');
    for (let i = 0; i < sc.steps.length; i++) {
      if (run.steps[i].status === 'off') continue;
      run.steps[i].status = 'active';
      this.emit('change');
      try {
        const res = await this.runStep(sc.steps[i], (note) => { run.steps[i].note = note; this.emit('change'); });
        if (res && res.skipped) Object.assign(run.steps[i], { status: 'skip', note: res.note });
        else Object.assign(run.steps[i], { status: 'ok', note: typeof res === 'string' ? res : '' });
      } catch (e) {
        Object.assign(run.steps[i], { status: 'fail', note: e.message });
        for (let j = i + 1; j < run.steps.length; j++) if (run.steps[j].status === 'wait') run.steps[j].status = 'cancel';
        break;
      } finally {
        this.emit('change');
      }
    }
    run.running = false;
    run.finishedAt = Date.now();
    this.emit('change');
  }

  shutdown() {
    this.procs.stopAll();
  }
}

module.exports = { Hub };
