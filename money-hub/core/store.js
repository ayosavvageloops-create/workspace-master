'use strict';
// Настройки в JSON-файле (папка данных приложения).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULTS = {
  workspaceDir: path.join(os.homedir(), 'workspace-master'),
  downloadsDir: path.join(os.homedir(), 'Downloads'),
  outreachPort: 4747,
  dolphinToken: '', // хранится только в этом файле на Маке
  finderPort: 8763,
  // Этап 1: поиск артистов в Artist Finder
  stage1: {
    seed: 'Tory Lanez', // референс: имя артиста или ссылка Spotify
    similarSource: 'finder', // кто ищет похожих: 'finder' (Artist Finder, полностью сам) или 'alike' (Savage Alike)
    pickOne: true, // сначала Artist Finder выбирает 1 артиста по метрикам, потом ищем похожих на него
    count: 30,
    minListeners: 1600,
    maxListeners: 24000,
    filterFollowers: false, // фильтр по подписчикам Instagram (медленнее)
    minFollowers: 3000,
    maxFollowers: 50000,
  },
  // Шаблоны опенеров: {a|b} — случайный вариант, {{first_name:bro}}, {{track}}, {{name}}
  templates: [
    '{Yo|Ayo|Yo yo} {{first_name:bro}}! {Just came across|Been bumping|Caught} "{{track:your latest}}" — real ones only. Working with artists in your lane right now, {wanted to link|had to reach out|thought I should hit you}.',
  ],
  methods: { dm: true, story: true, post: true }, // способы отправки в расширении
  extensionName: 'IG Sender Pro', // как называется расширение авторассылки в профилях Dolphin
  usedHandles: [], // кому уже отдали в рассылку — Artist Finder их не вернёт повторно
  paths: {}, // id программы -> своя папка
  disabledSteps: {}, // id сценария -> [номера выключенных шагов]
  imported: [], // уже перенесённые экспорты лидов: "имя|mtime"
};

class Store {
  constructor(file) {
    this.file = file;
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* первый запуск */ }
    this.data = { ...DEFAULTS, ...saved };
  }

  get(key) { return this.data[key]; }

  set(patch) {
    this.data = { ...this.data, ...patch };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    return this.data;
  }
}

module.exports = { Store, DEFAULTS };
