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
