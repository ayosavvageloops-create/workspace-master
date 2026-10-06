'use strict';
// Запуск и остановка программ. Команды идут через login-shell, чтобы был тот же
// PATH (node, npm, brew), что и в Терминале: у приложений из Finder он урезан.
const { spawn, execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');

const LOG_LINES = 400;

class Processes extends EventEmitter {
  constructor({ shell = process.env.SHELL || '/bin/zsh' } = {}) {
    super();
    this.shell = shell;
    this.procs = new Map(); // id -> { child, startedAt, exitCode }
    this.logs = new Map(); // id -> [lines]
  }

  log(id, text) {
    const buf = this.logs.get(id) || [];
    for (const line of String(text).split(/\r?\n/)) {
      if (line === '') continue;
      buf.push(line);
    }
    if (buf.length > LOG_LINES) buf.splice(0, buf.length - LOG_LINES);
    this.logs.set(id, buf);
    this.emit('log', id);
  }

  getLog(id) {
    return (this.logs.get(id) || []).join('\n');
  }

  isRunning(id) {
    const p = this.procs.get(id);
    return Boolean(p && p.exitCode === null);
  }

  state(id) {
    const p = this.procs.get(id);
    if (!p) return { status: 'idle' };
    if (p.exitCode === null) return { status: 'running', startedAt: p.startedAt };
    return { status: p.exitCode === 0 ? 'done' : 'failed', exitCode: p.exitCode, startedAt: p.startedAt };
  }

  /** Долгий процесс (сервер, Electron-приложение). */
  start(id, cmd, cwd) {
    if (this.isRunning(id)) return;
    this.log(id, `$ ${cmd}   (папка: ${cwd})`);
    const child = spawn(this.shell, ['-lc', cmd], {
      cwd,
      detached: true, // своя группа процессов, чтобы стоп убивал и npm, и node под ним
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const rec = { child, startedAt: Date.now(), exitCode: null };
    this.procs.set(id, rec);
    child.stdout.on('data', (d) => this.log(id, d));
    child.stderr.on('data', (d) => this.log(id, d));
    child.on('error', (e) => { this.log(id, `Ошибка запуска: ${e.message}`); rec.exitCode = -1; this.emit('change', id); });
    child.on('exit', (code, signal) => {
      rec.exitCode = code ?? (signal ? 0 : -1);
      this.log(id, signal ? `— остановлено (${signal})` : `— завершилось, код ${code}`);
      this.emit('change', id);
    });
    this.emit('change', id);
  }

  stop(id) {
    const p = this.procs.get(id);
    if (!p || p.exitCode !== null) return;
    try { process.kill(-p.child.pid, 'SIGTERM'); } catch { try { p.child.kill('SIGTERM'); } catch { /* уже нет */ } }
  }

  stopAll() {
    for (const id of this.procs.keys()) this.stop(id);
  }

  /** Короткая команда: дождаться результата. */
  run(cmd, cwd, timeoutMs = 20000) {
    return new Promise((resolve) => {
      execFile(this.shell, ['-lc', cmd], { cwd, timeout: timeoutMs }, (err, stdout, stderr) => {
        resolve({ ok: !err, code: err ? err.code ?? 1 : 0, stdout: String(stdout), stderr: String(stderr) });
      });
    });
  }
}

module.exports = { Processes };
