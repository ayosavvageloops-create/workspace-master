// Парсинг YouTube: поисковая выдача, продолжения выдачи (continuation), страница канала, описание видео.
// Здесь только чистые функции над HTML/JSON — сами запросы делает background.js из вкладки youtube.com.

import { extractJsonAfter, parseCount, walk } from './util.js';

const text = (t) => {
  if (!t) return '';
  if (typeof t === 'string') return t;
  if (t.simpleText) return t.simpleText;
  if (Array.isArray(t.runs)) return t.runs.map((r) => r.text).join('');
  if (typeof t.content === 'string') return t.content;
  return '';
};

export function searchUrl(query, { onlyVideos = true } = {}) {
  const params = new URLSearchParams({ search_query: query, hl: 'en', gl: 'US' });
  if (onlyVideos) params.set('sp', 'EgIQAQ==');
  return `https://www.youtube.com/results?${params}`;
}

export function parseInitialData(html) {
  return (
    extractJsonAfter(html, 'var ytInitialData = ') ||
    extractJsonAfter(html, 'window["ytInitialData"] = ') ||
    extractJsonAfter(html, 'ytInitialData = ')
  );
}

function videoFromRenderer(v) {
  const run = (v.ownerText?.runs || v.longBylineText?.runs || [])[0] || {};
  const browse = run.navigationEndpoint?.browseEndpoint || {};
  return {
    videoId: v.videoId,
    title: text(v.title),
    channelName: run.text || '',
    channelId: browse.browseId || null,
    channelPath: browse.canonicalBaseUrl || null,
    views: parseCount(text(v.viewCountText)),
    published: text(v.publishedTimeText),
  };
}

// Новый формат карточек YouTube (lockupViewModel) — разбираем «на ощупь».
function videoFromLockup(l) {
  if (!l.contentId || (l.contentType && !/VIDEO/.test(l.contentType))) return null;
  let channelId = null;
  let channelPath = null;
  let channelName = '';
  let views = null;
  walk(l, (o) => {
    const be = o.browseEndpoint;
    if (!channelId && be?.browseId?.startsWith('UC')) {
      channelId = be.browseId;
      channelPath = be.canonicalBaseUrl || null;
    }
    if (typeof o.content === 'string') {
      if (views == null && /\bviews?\b/i.test(o.content)) views = parseCount(o.content);
    }
  });
  const meta = l.metadata?.lockupMetadataViewModel;
  const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
  const firstPart = rows[0]?.metadataParts?.[0]?.text?.content;
  if (firstPart && !/\bviews?\b/i.test(firstPart)) channelName = firstPart;
  return {
    videoId: l.contentId,
    title: text(meta?.title),
    channelName,
    channelId,
    channelPath,
    views,
    published: '',
  };
}

// Возвращает { videos, continuation } из ytInitialData или из ответа youtubei/v1/search.
export function parseSearchResults(json) {
  const videos = [];
  let continuation = null;
  walk(json, (o) => {
    if (o.videoRenderer) {
      videos.push(videoFromRenderer(o.videoRenderer));
      return false;
    }
    if (o.lockupViewModel) {
      const v = videoFromLockup(o.lockupViewModel);
      if (v) videos.push(v);
      return false;
    }
    if (o.continuationItemRenderer) {
      const token =
        o.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token;
      if (token) continuation = token;
      return false;
    }
    // Не заходим в рекламу / «люди также смотрят» на уровне шортсов — они не нужны.
    if (o.reelShelfRenderer || o.adSlotRenderer) return false;
    return true;
  });
  return { videos: videos.filter((v) => v.videoId && v.channelId), continuation };
}

// Видео, прочитанные из DOM страницы поиска (pagescripts.ytScrapeSearch).
export function videosFromScrape(scrape) {
  return (scrape.videos || [])
    .filter((v) => v.videoId && v.channelPath)
    .map((v) => ({
      videoId: v.videoId,
      title: v.title,
      channelName: v.channelName,
      channelId: /^\/channel\/(UC[\w-]+)/.test(v.channelPath) ? v.channelPath.split('/')[2] : null,
      channelPath: v.channelPath,
      views: parseCount(v.viewsText),
      published: '',
    }));
}

const TYPE_BEAT_RE = /type\s*beat|instrumental|\bprod\.?\b|\bbeat\b/i;

// Группирует видео по каналам и считает метрики. Отбрасывает официальные/Topic/VEVO каналы.
export function aggregateChannels(videos) {
  const byId = new Map();
  for (const v of videos) {
    if (/ - Topic$|VEVO$/i.test(v.channelName)) continue;
    const key = v.channelId || v.channelPath;
    if (!key) continue;
    let ch = byId.get(key);
    if (!ch) {
      ch = {
        key,
        channelId: v.channelId || null,
        name: v.channelName,
        path: v.channelPath,
        url: `https://www.youtube.com${v.channelPath || `/channel/${v.channelId}`}`,
        videoCount: 0,
        typeBeatVideos: 0,
        totalViews: 0,
        maxViews: 0,
        sampleVideos: [],
      };
      byId.set(key, ch);
    }
    if (!ch.name && v.channelName) ch.name = v.channelName;
    ch.videoCount++;
    if (TYPE_BEAT_RE.test(v.title)) ch.typeBeatVideos++;
    ch.totalViews += v.views || 0;
    ch.maxViews = Math.max(ch.maxViews, v.views || 0);
    if (ch.sampleVideos.length < 3) ch.sampleVideos.push({ videoId: v.videoId, title: v.title });
  }
  return [...byId.values()].filter((c) => c.typeBeatVideos > 0);
}

export function channelAboutUrl(channel) {
  const base = channel.path ? channel.path : `/channel/${channel.channelId}`;
  return `https://www.youtube.com${base}/about?hl=en&gl=US`;
}

export function watchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}&hl=en&gl=US`;
}

export function parseSubscribers(text) {
  const m = String(text || '').match(
    /(\d{1,3}(?:[,\s ]\d{3})+|\d+(?:[.,]\d+)?)\s*([KMB]|тыс\.?|млн)?\s*(?:subscribers?|подписчик)/i,
  );
  return m ? parseCount(m[1] + (m[2] || '')) : null;
}

const IG_RESERVED = new Set([
  'p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'tv', 'direct', 'about',
  'developer', 'legal', 'web', 'static', 'privacy', 'terms', 'instagram',
]);

function decodeForLinks(s) {
  return s
    .replace(/\\u0026/g, '&')
    .replace(/\\u003d/gi, '=')
    .replace(/\\\//g, '/')
    .replace(/%2F/gi, '/')
    .replace(/%3A/gi, ':')
    .replace(/%40/gi, '@')
    .replace(/%2E/gi, '.')
    .replace(/%5F/gi, '_');
}

function cleanHandle(h) {
  const handle = h.replace(/\.+$/, '').toLowerCase();
  if (handle.length < 2 || handle.length > 30) return null;
  if (IG_RESERVED.has(handle)) return null;
  return handle;
}

// Ищет Instagram-аккаунты в тексте/HTML: ссылки instagram.com/xxx и подписи "IG: @xxx".
// Возвращает массив хендлов, отсортированный по частоте упоминаний.
export function findInstagramHandles(raw) {
  if (!raw) return [];
  const s = decodeForLinks(raw);
  const counts = new Map();
  const add = (h, weight) => {
    const handle = cleanHandle(h);
    if (handle) counts.set(handle, (counts.get(handle) || 0) + weight);
  };
  for (const m of s.matchAll(/instagram\.com\/(?!p\/|reel\/|explore\/|stories\/)([A-Za-z0-9_.]{2,30})/gi)) {
    add(m[1], 3);
  }
  for (const m of s.matchAll(/instagr\.am\/([A-Za-z0-9_.]{2,30})/gi)) add(m[1], 3);
  // "IG: @x", "Instagram - @x", опечатки вроде "Instargam - @x", эмодзи-камеры.
  for (const m of s.matchAll(
    /(?:\bi\.?g\b|\bins?ta\w*|📸|📷)[^@\n\\]{0,12}@([A-Za-z0-9_.]{2,30})/gi,
  )) {
    add(m[1], 2);
  }
  // Слабый сигнал: "Must credit - @x", "prod. by @x" — обычно это тот же хендл продюсера.
  for (const m of s.matchAll(/(?:credit|prod\.?\s*by|follow)[^@\n\\]{0,12}@([A-Za-z0-9_.]{2,30})/gi)) {
    add(m[1], 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
}

export function parseVideoDescription(html) {
  const m = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
  if (!m) return '';
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return m[1];
  }
}

// Описание канала + блок ссылок «About». Ограничиваем область поиска, чтобы не цеплять чужие ссылки.
export function parseChannelAbout(html) {
  const subscribers = parseSubscribers(html);
  const parts = [];
  const data = parseInitialData(html);
  if (data) {
    walk(data, (o) => {
      if (o.aboutChannelViewModel) {
        parts.push(JSON.stringify(o.aboutChannelViewModel));
        return false;
      }
      if (o.channelMetadataRenderer) {
        parts.push(o.channelMetadataRenderer.description || '');
        return false;
      }
      if (o.channelHeaderLinksViewModel || o.attributionViewModel) {
        parts.push(JSON.stringify(o));
        return false;
      }
      if (o.pageHeaderViewModel) {
        parts.push(JSON.stringify(o.pageHeaderViewModel));
      }
      return true;
    });
  }
  const scoped = parts.join('\n');
  let handles = findInstagramHandles(scoped);
  // Фолбэк: весь HTML страницы (туда попадает описание «витринного» видео канала).
  if (!handles.length) handles = findInstagramHandles(html).slice(0, 3);
  return { subscribers, handles };
}
