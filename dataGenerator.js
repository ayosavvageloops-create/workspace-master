'use strict';

const crypto = require('crypto');

// Наборы имён по локалям. Транслитерация русских имён нужна для username на латинице.
const NAMES = {
  en: {
    male: ['James', 'John', 'Michael', 'David', 'Daniel', 'Matthew', 'Andrew', 'Joseph', 'William', 'Ryan'],
    female: ['Mary', 'Jennifer', 'Linda', 'Patricia', 'Elizabeth', 'Susan', 'Jessica', 'Sarah', 'Karen', 'Emily'],
    last: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson', 'Taylor', 'Anderson'],
  },
  ru: {
    male: ['Александр', 'Дмитрий', 'Максим', 'Сергей', 'Андрей', 'Алексей', 'Иван', 'Михаил', 'Никита', 'Роман'],
    female: ['Анна', 'Мария', 'Елена', 'Ольга', 'Наталья', 'Екатерина', 'Татьяна', 'Ирина', 'Юлия', 'Виктория'],
    last: ['Иванов', 'Смирнов', 'Кузнецов', 'Попов', 'Соколов', 'Лебедев', 'Козлов', 'Новиков', 'Морозов', 'Волков'],
  },
};

// Карта транслитерации кириллицы → латиница для генерации username.
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

const PASSWORD_SETS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  special: '!@#$%^&*()-_=+[]{}',
};

/**
 * Генератор случайных данных для тестирования форм регистрации.
 *
 * Использует crypto из стандартной библиотеки Node.js для криптографически
 * стойкой случайности, без внешних зависимостей.
 */
class DataGenerator {
  /**
   * @param {object} [options]
   * @param {'en'|'ru'} [options.locale='en'] — локаль для имён.
   */
  constructor({ locale = 'en' } = {}) {
    if (!NAMES[locale]) {
      throw new Error(`DataGenerator: неизвестная локаль "${locale}". Доступно: ${Object.keys(NAMES).join(', ')}`);
    }
    this.locale = locale;
  }

  /**
   * Генерирует полный профиль для формы регистрации.
   * @returns {{
   *   firstName: string,
   *   lastName: string,
   *   birthDate: { day: number, month: number, year: number },
   *   password: string,
   *   username: string
   * }}
   */
  generateProfile() {
    const gender = this._pick(['male', 'female']);
    const pool = NAMES[this.locale];

    const firstName = this._pick(pool[gender]);
    const lastName = this._pick(pool.last);

    return {
      firstName,
      lastName,
      birthDate: this._generateBirthDate(18, 35),
      password: this._generatePassword(),
      username: this._generateUsername(firstName, lastName),
    };
  }

  /**
   * Дата рождения для возраста в заданном диапазоне (включительно).
   * @private
   */
  _generateBirthDate(minAge, maxAge) {
    const now = new Date();
    const age = this._randomInt(minAge, maxAge);

    // Базовый год по возрасту, затем случайный день/месяц в пределах года.
    const year = now.getFullYear() - age;
    const month = this._randomInt(1, 12);
    // Безопасный максимум дней для месяца (день 0 следующего месяца = последний день текущего).
    const daysInMonth = new Date(year, month, 0).getDate();
    const day = this._randomInt(1, daysInMonth);

    return { day, month, year };
  }

  /**
   * Пароль 12–16 символов, гарантированно содержащий хотя бы один символ
   * каждого класса: заглавные, строчные, цифры, спецсимволы.
   * @private
   */
  _generatePassword() {
    const length = this._randomInt(12, 16);

    // По одному обязательному символу из каждого набора.
    const required = [
      this._pick(PASSWORD_SETS.upper),
      this._pick(PASSWORD_SETS.lower),
      this._pick(PASSWORD_SETS.digits),
      this._pick(PASSWORD_SETS.special),
    ];

    const all = Object.values(PASSWORD_SETS).join('');
    const rest = Array.from({ length: length - required.length }, () => this._pick(all));

    return this._shuffle([...required, ...rest]).join('');
  }

  /**
   * Уникальный username на латинице: firstname.lastname + 2 цифры.
   * Для русской локали имена транслитерируются.
   * @private
   */
  _generateUsername(firstName, lastName) {
    const first = this._latinize(firstName).toLowerCase();
    const last = this._latinize(lastName).toLowerCase();
    const suffix = String(this._randomInt(10, 99)); // ровно 2 цифры

    return `${first}.${last}${suffix}`;
  }

  /**
   * Транслитерация кириллицы в латиницу; латинские символы остаются как есть.
   * @private
   */
  _latinize(str) {
    return str
      .split('')
      .map((ch) => {
        const lower = ch.toLowerCase();
        const mapped = TRANSLIT[lower];
        if (mapped === undefined) return ch; // уже латиница или цифра
        // Сохраняем регистр первой буквы.
        return ch === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1);
      })
      .join('')
      .replace(/[^a-zA-Z0-9]/g, ''); // чистим всё, что не латиница/цифра
  }

  /**
   * Криптографически стойкое целое в диапазоне [min, max] включительно.
   * Отбраковка (rejection sampling) убирает смещение по модулю.
   * @private
   */
  _randomInt(min, max) {
    const range = max - min + 1;
    if (range <= 0) throw new Error('_randomInt: max должен быть >= min');

    const maxUint32 = 0xffffffff;
    const limit = maxUint32 - (maxUint32 % range);

    let value;
    do {
      value = crypto.randomBytes(4).readUInt32BE(0);
    } while (value >= limit);

    return min + (value % range);
  }

  /**
   * Случайный элемент массива или случайный символ строки.
   * @private
   */
  _pick(collection) {
    return collection[this._randomInt(0, collection.length - 1)];
  }

  /**
   * Перемешивание массива (Фишер–Йейтс) на crypto-рандоме.
   * @private
   */
  _shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = this._randomInt(0, i);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

module.exports = DataGenerator;
