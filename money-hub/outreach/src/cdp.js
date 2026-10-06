// Минимальный клиент Chrome DevTools Protocol на встроенном WebSocket (Node 22+), без зависимостей.

export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.closed = false;
    ws.addEventListener('message', (ev) => this._onMessage(ev.data));
    ws.addEventListener('close', () => {
      this.closed = true;
      for (const { reject } of this.pending.values()) reject(new Error('Соединение с браузером закрыто'));
      this.pending.clear();
    });
  }

  static connect(wsUrl, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => { ws.close(); reject(new Error(`Нет связи с браузером: ${wsUrl}`)); }, timeoutMs);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(new CDP(ws)); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`Ошибка WebSocket: ${wsUrl}`)); }, { once: true });
    });
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); } catch { return; }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject, method } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const fn of this.listeners) fn(msg);
    }
  }

  send(method, params = {}, sessionId, timeoutMs = 30000) {
    if (this.closed) return Promise.reject(new Error('Соединение с браузером закрыто'));
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: таймаут`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.ws.send(JSON.stringify(payload));
    });
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Выполнить JS в цели (вкладка / service worker) и вернуть значение. */
  async evaluate(sessionId, expression, timeoutMs = 30000) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId, timeoutMs);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(d.exception?.description || d.text || 'Ошибка выполнения JS');
    }
    return r.result?.value;
  }

  close() {
    try { this.ws.close(); } catch { /* уже закрыт */ }
  }
}
