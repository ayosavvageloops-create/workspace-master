'use strict';

const axios = require('axios');

/**
 * Модуль управления прокси-соединениями для Playwright.
 *
 * - rotateIP: дёргает rotation-URL мобильного прокси для смены IP (с таймаутом и повторами).
 * - parseProxyString: разбирает строку прокси в объект формата launch({ proxy }).
 */
class ProxyHelper {
  /**
   * @param {object} [options]
   * @param {number} [options.timeout=10000]   — таймаут одного запроса ротации, мс.
   * @param {number} [options.retries=3]        — число попыток ротации.
   * @param {number} [options.retryDelay=2000]  — базовая задержка между попытками, мс (растёт экспоненциально).
   * @param {string} [options.defaultScheme='http'] — схема по умолчанию для server, если не задана в строке.
   * @param {object} [options.logger=console]   — логгер с методами info/warn/error.
   */
  constructor({
    timeout = 10000,
    retries = 3,
    retryDelay = 2000,
    defaultScheme = 'http',
    logger = console,
  } = {}) {
    this.timeout = timeout;
    this.retries = retries;
    this.retryDelay = retryDelay;
    this.defaultScheme = defaultScheme;
    this.logger = logger;
  }

  /**
   * Смена IP мобильного прокси через GET-запрос на rotation-URL.
   * Повторяет попытки при ошибке/не-200 статусе с экспоненциальной задержкой.
   *
   * @param {string} rotationUrl — URL, по которому провайдер меняет IP.
   * @returns {Promise<boolean>} — true при успешном ответе (200), иначе выбрасывает ошибку.
   */
  async rotateIP(rotationUrl) {
    if (!rotationUrl || typeof rotationUrl !== 'string') {
      throw new Error('rotateIP: rotationUrl должен быть непустой строкой');
    }

    let lastError;

    for (let attempt = 1; attempt <= this.retries; attempt += 1) {
      try {
        this.logger.info(`[ProxyHelper] Ротация IP, попытка ${attempt}/${this.retries}: ${rotationUrl}`);

        const response = await axios.get(rotationUrl, {
          timeout: this.timeout,
          // Не бросать исключение автоматически — обработаем статус сами.
          validateStatus: () => true,
        });

        if (response.status === 200) {
          this.logger.info(`[ProxyHelper] IP успешно сменён (HTTP 200) с попытки ${attempt}`);
          return true;
        }

        // Не-200: считаем неуспехом и пробуем снова.
        lastError = new Error(`Неожиданный статус HTTP ${response.status}`);
        this.logger.warn(`[ProxyHelper] Попытка ${attempt} вернула HTTP ${response.status}`);
      } catch (err) {
        lastError = err;
        const reason = err.code === 'ECONNABORTED'
          ? `таймаут ${this.timeout}мс`
          : err.message;
        this.logger.warn(`[ProxyHelper] Попытка ${attempt} не удалась: ${reason}`);
      }

      // Задержка перед следующей попыткой (кроме последней).
      if (attempt < this.retries) {
        const delay = this.retryDelay * 2 ** (attempt - 1);
        this.logger.info(`[ProxyHelper] Повтор через ${delay}мс...`);
        await this._sleep(delay);
      }
    }

    this.logger.error(`[ProxyHelper] Ротация IP не удалась после ${this.retries} попыток: ${lastError.message}`);
    throw new Error(`rotateIP: не удалось сменить IP после ${this.retries} попыток — ${lastError.message}`);
  }

  /**
   * Разбор строки прокси в объект для Playwright: { server, username?, password? }.
   *
   * Поддерживаемые форматы:
   *   - "ip:port:login:password"
   *   - "ip:port"
   *   - "login:password@ip:port"
   *   - "ip:port@login:password" (нестандартный, но встречается)
   *   - любой из вариантов с префиксом схемы: "http://...", "socks5://..."
   *
   * @param {string} proxyStr
   * @returns {{ server: string, username?: string, password?: string }}
   */
  parseProxyString(proxyStr) {
    if (!proxyStr || typeof proxyStr !== 'string') {
      throw new Error('parseProxyString: proxyStr должен быть непустой строкой');
    }

    const trimmed = proxyStr.trim();

    // Отделяем схему, если есть (http://, https://, socks5://).
    let scheme = this.defaultScheme;
    let rest = trimmed;
    const schemeMatch = trimmed.match(/^([a-z0-9]+):\/\/(.+)$/i);
    if (schemeMatch) {
      scheme = schemeMatch[1].toLowerCase();
      rest = schemeMatch[2];
    }

    let host;
    let port;
    let username;
    let password;

    if (rest.includes('@')) {
      // Формат с "@": одна часть — креды, другая — адрес.
      const [left, right] = this._splitOnce(rest, '@');
      // Определяем, где адрес (где порт — число): адрес содержит ровно 2 части с числовым портом.
      const leftParts = left.split(':');
      const rightParts = right.split(':');

      if (this._looksLikeHostPort(rightParts)) {
        // "login:password@ip:port"
        [host, port] = rightParts;
        [username, password] = leftParts;
      } else if (this._looksLikeHostPort(leftParts)) {
        // "ip:port@login:password"
        [host, port] = leftParts;
        [username, password] = rightParts;
      } else {
        throw new Error(`parseProxyString: не удалось определить ip:port в "${proxyStr}"`);
      }
    } else {
      // Формат с двоеточиями без "@".
      const parts = rest.split(':');
      if (parts.length === 2) {
        // "ip:port"
        [host, port] = parts;
      } else if (parts.length === 4) {
        // "ip:port:login:password"
        [host, port, username, password] = parts;
      } else {
        throw new Error(
          `parseProxyString: неподдерживаемый формат "${proxyStr}" ` +
          '(ожидается "ip:port", "ip:port:login:password" или "login:password@ip:port")',
        );
      }
    }

    this._validateHostPort(host, port, proxyStr);

    const proxy = { server: `${scheme}://${host}:${port}` };
    if (username) proxy.username = username;
    if (password) proxy.password = password;

    // Логируем без утечки пароля.
    this.logger.info(
      `[ProxyHelper] Прокси распознан: ${proxy.server}` +
      (username ? ` (auth: ${username}:***)` : ' (без авторизации)'),
    );

    return proxy;
  }

  /**
   * Похоже ли [a, b] на пару host:port (ровно 2 элемента, второй — число).
   * @private
   */
  _looksLikeHostPort(parts) {
    return parts.length === 2 && /^\d+$/.test(parts[1]);
  }

  /**
   * Проверка валидности хоста и порта.
   * @private
   */
  _validateHostPort(host, port, original) {
    if (!host) {
      throw new Error(`parseProxyString: пустой хост в "${original}"`);
    }
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      throw new Error(`parseProxyString: некорректный порт "${port}" в "${original}"`);
    }
  }

  /**
   * Разбивает строку по первому вхождению разделителя.
   * @private
   */
  _splitOnce(str, sep) {
    const idx = str.indexOf(sep);
    return [str.slice(0, idx), str.slice(idx + 1)];
  }

  /** @private */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = ProxyHelper;
