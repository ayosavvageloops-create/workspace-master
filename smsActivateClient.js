'use strict';

const axios = require('axios');

/**
 * Ошибка, возвращаемая самим API SMS-Activate.
 * Код — это текстовый маркер из тела ответа (NO_BALANCE, BAD_KEY, NO_NUMBERS и т.п.).
 */
class SmsActivateError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'SmsActivateError';
    this.code = code;
  }
}

/**
 * Клиент для API SMS-Activate (handler_api.php).
 *
 * Особенность этого API: ответы приходят НЕ в JSON, а простой строкой
 * вида "ACCESS_NUMBER:<id>:<номер>" или "STATUS_OK:<код>", поэтому
 * тело ответа приходится парсить вручную.
 */
class SmsActivateClient {
  /**
   * @param {object} options
   * @param {string} options.apiKey                 — API-ключ из личного кабинета.
   * @param {string} [options.baseUrl]              — базовый URL API.
   * @param {number} [options.timeout=15000]        — таймаут запроса, мс.
   * @param {number} [options.retries=2]            — число повторов при сетевой ошибке.
   */
  constructor({
    apiKey,
    baseUrl = 'https://api.sms-activate.org/stubs/handler_api.php',
    timeout = 15000,
    retries = 2,
  } = {}) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('SmsActivateClient: apiKey обязателен');
    }

    this.apiKey = apiKey;
    this.retries = retries;

    this.http = axios.create({
      baseURL: baseUrl,
      timeout,
      // API ожидает параметры в query string.
      headers: { Accept: 'text/plain' },
    });
  }

  /**
   * Запрос нового номера.
   *
   * @param {object} params
   * @param {string} params.service        — код сервиса (например, 'tg' — Telegram, 'wa' — WhatsApp).
   * @param {string|number} [params.country=0] — код страны (0 — Россия).
   * @param {string} [params.operator]     — оператор ('any' или конкретный).
   * @param {number} [params.maxPrice]     — максимальная цена за номер.
   * @returns {Promise<{ activationId: string, phoneNumber: string }>}
   */
  async getNumber({ service, country = 0, operator, maxPrice } = {}) {
    if (!service) {
      throw new Error('getNumber: параметр service обязателен');
    }

    const raw = await this._request({
      action: 'getNumber',
      service,
      country,
      ...(operator ? { operator } : {}),
      ...(maxPrice ? { maxPrice } : {}),
    });

    // Успех: "ACCESS_NUMBER:<id>:<номер>"
    if (raw.startsWith('ACCESS_NUMBER')) {
      const [, activationId, phoneNumber] = raw.split(':');
      return { activationId, phoneNumber };
    }

    // Иначе raw — это код ошибки (NO_NUMBERS, NO_BALANCE, BAD_SERVICE, ...).
    throw new SmsActivateError(raw, `getNumber не удался: ${raw}`);
  }

  /**
   * Получение статуса активации / текста входящего СМС.
   *
   * @param {string|number} activationId — ID активации из getNumber.
   * @returns {Promise<{ status: string, code: string|null, raw: string }>}
   *   status: 'WAIT_CODE' | 'WAIT_RETRY' | 'OK' | 'CANCELED' | ...
   *   code:   полученный код из СМС (если уже пришёл), иначе null.
   */
  async getStatus(activationId) {
    if (activationId === undefined || activationId === null) {
      throw new Error('getStatus: activationId обязателен');
    }

    const raw = await this._request({ action: 'getStatus', id: activationId });

    // "STATUS_OK:<код>"        — код получен
    // "STATUS_WAIT_RETRY:<код>"— введён неверный код, ждём новый
    // "STATUS_WAIT_CODE"       — ждём первое СМС
    // "STATUS_CANCEL"          — активация отменена
    const [marker, code] = raw.split(':');

    const statusMap = {
      STATUS_OK: 'OK',
      STATUS_WAIT_CODE: 'WAIT_CODE',
      STATUS_WAIT_RETRY: 'WAIT_RETRY',
      STATUS_CANCEL: 'CANCELED',
    };

    const status = statusMap[marker];
    if (!status) {
      throw new SmsActivateError(raw, `getStatus вернул неизвестный ответ: ${raw}`);
    }

    return { status, code: code || null, raw };
  }

  /**
   * Изменение статуса активации.
   *
   * Типовые значения status:
   *   1  — сообщить о готовности номера (СМС отправлено ожидание).
   *   3  — запросить ещё одно СМС (повторная отправка кода).
   *   6  — подтвердить активацию и завершить (код верный).
   *   8  — отменить активацию.
   *
   * @param {string|number} activationId
   * @param {number} status
   * @returns {Promise<string>} — ответ API ('ACCESS_READY', 'ACCESS_ACTIVATION', 'ACCESS_CANCEL', ...).
   */
  async setStatus(activationId, status) {
    if (activationId === undefined || activationId === null) {
      throw new Error('setStatus: activationId обязателен');
    }
    if (status === undefined || status === null) {
      throw new Error('setStatus: status обязателен');
    }

    const raw = await this._request({
      action: 'setStatus',
      id: activationId,
      status,
    });

    // Успешные ответы начинаются с ACCESS_.
    if (raw.startsWith('ACCESS_')) {
      return raw;
    }

    throw new SmsActivateError(raw, `setStatus не удался: ${raw}`);
  }

  /**
   * Низкоуровневый GET-запрос с повторами и единой обработкой ошибок.
   * @private
   */
  async _request(params) {
    const query = { api_key: this.apiKey, ...params };

    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const { data } = await this.http.get('', { params: query });
        const body = typeof data === 'string' ? data.trim() : String(data);

        // API возвращает общие ошибки в теле даже при HTTP 200.
        this._assertNotApiError(body);
        return body;
      } catch (err) {
        lastError = this._normalizeError(err);

        // Повторяем только сетевые/временные ошибки, не ошибки логики API.
        const retriable =
          !(lastError instanceof SmsActivateError) &&
          attempt < this.retries;

        if (!retriable) break;

        // Экспоненциальная задержка: 500мс, 1с, 2с...
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }

    throw lastError;
  }

  /**
   * Бросает SmsActivateError для известных «ключевых» ошибок API,
   * которые приходят простой строкой с кодом 200.
   * @private
   */
  _assertNotApiError(body) {
    const fatalCodes = new Set([
      'BAD_KEY',        // неверный API-ключ
      'ERROR_SQL',      // ошибка на стороне сервиса
      'BAD_ACTION',     // неверное действие
      'BAD_SERVICE',    // неверный код сервиса
      'NO_BALANCE',     // недостаточно средств
      'NO_KEY',         // не передан ключ
    ]);

    if (fatalCodes.has(body)) {
      throw new SmsActivateError(body, `API вернул ошибку: ${body}`);
    }
  }

  /**
   * Приводит ошибку axios к читаемому виду.
   * @private
   */
  _normalizeError(err) {
    if (err instanceof SmsActivateError) {
      return err;
    }

    if (err.response) {
      // Сервер ответил кодом вне диапазона 2xx.
      return new Error(
        `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`,
      );
    }

    if (err.request) {
      // Запрос ушёл, но ответа нет (таймаут, обрыв связи).
      return new Error(`Нет ответа от API (${err.code || 'network error'})`);
    }

    // Ошибка на этапе формирования запроса.
    return new Error(`Ошибка запроса: ${err.message}`);
  }
}

module.exports = { SmsActivateClient, SmsActivateError };
