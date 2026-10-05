// Ключи chrome.storage.local и общие помощники для UI и фонового скрипта.

export const KEYS = {
  settings: 'settings',
  job: 'job',
  leads: 'leads',
  profileCache: 'profileCache',
  // Статусы работы с лидом хранятся отдельно, чтобы фоновая задача не перезаписывала правки из таблицы.
  leadStatus: 'leadStatus',
};

export const LEAD_STATUSES = {
  new: 'Новый',
  contacted: 'Написал',
  replied: 'Ответил',
  call: 'Созвон',
  closed: 'Закрыт',
  skip: 'Пропуск',
};

export const DEFAULT_SETTINGS = {
  // YouTube
  query: 'Rylo Rodriguez type beat',
  searchPages: 3, // ~20 видео на страницу
  minSubscribers: 5000,
  producerCount: 3, // сколько каналов отметить заранее
  channelsToCheck: 12, // сколько каналов открыть («О канале» / видео)
  autoSelect: false, // false — после YouTube остановиться и дать выбрать продюсеров
  manualProducers: '', // IG-хендлы через запятую — если заполнено, YouTube пропускается
  // Instagram
  postsToFetch: 24, // сколько постов взять из сетки профиля
  postsToScan: 8, // сколько из них открыть и прочитать комментарии
  commentsPerPost: 100,
  minIntent: 4,
  scanComments: true,
  scanTagged: true,
  taggedPosts: 24,
  includePlacements: true,
  maxProfileChecks: 60,
  artistThreshold: 3,
  // Поведение
  delayMin: 2500,
  delayMax: 6000,
  recheckDays: 14,
};

export const EMPTY_JOB = {
  running: false,
  status: 'idle', // idle | running | select | done | stopped | error | interrupted
  phase: null, // youtube | instagram | profiles
  message: '',
  startedAt: null,
  finishedAt: null,
  progress: { label: '', done: 0, total: 0 },
  channels: [],
  producers: [],
  log: [],
};

export async function getSettings() {
  const { [KEYS.settings]: s } = await chrome.storage.local.get(KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}

export async function getJob() {
  const { [KEYS.job]: j } = await chrome.storage.local.get(KEYS.job);
  return { ...EMPTY_JOB, ...(j || {}) };
}

export async function getLeads() {
  const { [KEYS.leads]: l } = await chrome.storage.local.get(KEYS.leads);
  return l || {};
}

const PRIORITY_RANK = { hot: 3, warm: 2, cold: 1, unchecked: 0 };

export function leadPriority(lead) {
  const maxIntent = Math.max(0, ...lead.sources.filter((s) => s.type === 'comment').map((s) => s.intent || 0));
  if (lead.isArtist == null) return maxIntent >= 5 ? 'hot' : 'unchecked';
  if (maxIntent >= 5 && lead.isArtist) return 'hot';
  if (lead.isArtist) return 'warm';
  return 'cold';
}

export function leadSortKey(lead) {
  const maxIntent = Math.max(0, ...lead.sources.filter((s) => s.type === 'comment').map((s) => s.intent || 0));
  return PRIORITY_RANK[lead.priority] * 1000 + maxIntent * 10 + (lead.artistScore || 0);
}

export function sortedLeads(leadsMap) {
  return Object.values(leadsMap).sort((a, b) => leadSortKey(b) - leadSortKey(a));
}

export const SOURCE_LABELS = {
  comment: 'Комментарий',
  tagged: 'Отметка (Tagged)',
  placement: 'Плейсмент',
};
