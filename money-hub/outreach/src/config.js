import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Внутри Money Hub данные лежат в папке приложения (DOLPHIN_OUTREACH_DATA), а не рядом с кодом.
const HOME = process.env.DOLPHIN_OUTREACH_DATA || '';
export const DATA_DIR = HOME ? path.join(HOME, 'data') : path.join(ROOT, 'data');
const CONFIG_FILE = HOME ? path.join(HOME, 'config.json') : path.join(ROOT, 'config.json');

export const DEFAULTS = {
  port: 4747,
  dolphin: {
    // Local API работает только на том же компьютере, где запущен Dolphin{anty}
    localApi: 'http://localhost:3001',
    cloudApi: 'https://dolphin-anty-api.com',
    // API-токен: Dolphin → Настройки → API → «Создать токен»
    token: '',
    headless: false,
  },
  run: {
    concurrency: 3,           // сколько окон одновременно
    artistsPerProfile: 25,    // сколько артистов на один профиль за сессию
    dailyLimitPerProfile: 25, // жёсткий лимит отправок на профиль в сутки
    startStaggerSec: 15,      // пауза между запуском окон в одной волне
    profileTimeoutMin: 240,   // максимум времени на один профиль (25 артистов ≈ 1–2 часа)
    pollSec: 5,               // как часто опрашивать расширение о прогрессе
    closeWhenDone: true,      // закрывать профиль после завершения
  },
  extension: {
    // igsender — работа с IG Sender Pro: лаунчер сам загружает очередь в режим «2026» и жмёт «Запустить»
    // manual   — лаунчер только открывает профиль и Instagram; список с опенерами видно в панели
    mode: 'igsender',
    name: 'IG Sender Pro', // как найти расширение в профиле (часть названия из manifest.json)
    id: '',                // или точный ID расширения (необязательно)
    knownIds: [],          // ID, найденные при прошлых запусках — заполняется само
    openUrl: 'https://www.instagram.com/direct/inbox/',
    // null — берутся паузы из настроек самого расширения (вкладка «Основная»).
    // Например { "min": 60, "max": 180 } — переопределить для всех профилей.
    delays: null,
    // null — способы отправки как настроены в расширении. Например { "dm": true, "story": false, "post": false }
    methods: null,
    lang: '', // 'ru' / 'en' — язык лога расширения, пусто — не трогать
  },
};

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

export function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

export function loadConfig(file = CONFIG_FILE) {
  let user = {};
  if (fs.existsSync(file)) user = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cfg = deepMerge(DEFAULTS, user);
  if (process.env.DOLPHIN_TOKEN) cfg.dolphin.token = process.env.DOLPHIN_TOKEN;
  return cfg;
}

export function saveConfig(cfg, file = CONFIG_FILE) {
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
}

/** Конфиг для отдачи в браузер — без токена целиком. */
export function publicConfig(cfg) {
  const t = cfg.dolphin.token || '';
  return deepMerge(cfg, {
    dolphin: { token: '', tokenSet: Boolean(t), tokenHint: t ? `…${t.slice(-4)}` : '' },
  });
}
