'use strict';
// Программы, которыми управляет Money Hub. dir — путь относительно папки workspace
// (её выбираешь в Настройках); для каждой программы путь можно переопределить.

const MODULES = [
  {
    id: 'artist-finder',
    title: 'Artist Finder',
    role: 'Поиск артистов по референсу (Spotify)',
    kind: 'finder',
    appName: 'Artist Finder',
  },
  {
    id: 'dolphin-anty',
    title: 'Dolphin Anty',
    role: 'Браузер с профилями Instagram',
    kind: 'app',
    appName: 'Dolphin Anty',
  },
  {
    id: 'dolphin-outreach',
    title: 'Dolphin Outreach',
    role: 'Холодная рассылка по профилям',
    kind: 'server',
    dir: 'dolphin-outreach',
    cmd: 'npm start',
  },
  {
    id: 'type-beat-leads',
    title: 'Type Beat Leads',
    role: 'Лиды из комментариев под type beat',
    kind: 'chrome',
    url: 'https://www.youtube.com/results?search_query=type+beat',
  },
  {
    id: 'beat-visualizer',
    title: 'Beat Visualizer',
    role: 'Бит → видео для рилс',
    kind: 'app',
    appName: 'Beat Visualizer',
    dir: 'beat-visualizer',
    fallbackFile: 'index.html',
  },
  {
    id: 'fl-tutorial-recorder',
    title: 'FL Tutorial Recorder',
    role: 'Туториал из записи FL Studio',
    kind: 'process',
    dir: 'fl-tutorial-recorder',
    cmd: '[ -d node_modules ] || npm install; npm start',
  },
  {
    id: 'manychat',
    title: 'ManyChat',
    role: 'Автоответы и воронка low ticket',
    kind: 'url',
    url: 'https://app.manychat.com',
  },
];

const SCENARIOS = [
  {
    id: 'stage1',
    title: 'Этап 1: лиды → рассылка',
    about: 'Artist Finder находит артистов по референсу → Dolphin Outreach делит их между профилями, пишет каждому опенер по шаблонам и запускает расширение (директ / сторис / пост).',
    steps: [
      { type: 'startFinder', title: 'Открыть Artist Finder' },
      { type: 'discover', title: 'Найти похожих артистов по референсу' },
      { type: 'openApp', module: 'dolphin-anty', title: 'Открыть Dolphin Anty', waitSec: 10 },
      { type: 'startServer', module: 'dolphin-outreach', title: 'Запустить Dolphin Outreach (+ токен)' },
      { type: 'prepareOutreach', title: 'Передать шаблоны опенеров и способы отправки' },
      { type: 'importFound', title: 'Загрузить найденных артистов (опенер каждому)' },
      { type: 'startOutreach', title: 'Запустить рассылку по профилям Dolphin' },
    ],
  },
  {
    id: 'morning-outreach',
    title: 'Утренняя рассылка',
    about: 'Dolphin Anty → Dolphin Outreach → свежие лиды из Type Beat Leads → запуск рассылки по выбранным профилям.',
    steps: [
      { type: 'openApp', module: 'dolphin-anty', title: 'Открыть Dolphin Anty', waitSec: 10 },
      { type: 'startServer', module: 'dolphin-outreach', title: 'Запустить Dolphin Outreach' },
      { type: 'importLeads', title: 'Перенести свежие лиды (🔥 + тёплые) из «Загрузок»' },
      { type: 'startOutreach', title: 'Запустить рассылку по выбранным профилям' },
    ],
  },
  {
    id: 'lead-hunt',
    title: 'Поиск лидов',
    about: 'Открывает YouTube для Type Beat Leads и Spotify для поиска похожих артистов.',
    steps: [
      { type: 'openModule', module: 'type-beat-leads', title: 'Открыть YouTube для Type Beat Leads' },
      { type: 'openUrl', url: 'https://open.spotify.com', title: 'Открыть Spotify (метод плейлиста)' },
    ],
  },
  {
    id: 'content-session',
    title: 'Контент-сессия',
    about: 'Запись бита с туториалом, затем видео для рилс.',
    steps: [
      { type: 'startProcess', module: 'fl-tutorial-recorder', title: 'Запустить FL Tutorial Recorder' },
      { type: 'openModule', module: 'beat-visualizer', title: 'Открыть Beat Visualizer' },
    ],
  },
];

module.exports = { MODULES, SCENARIOS };
