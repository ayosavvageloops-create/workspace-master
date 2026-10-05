// Instagram: адреса страниц и разбор того, что прочитано с открытых страниц (см. pagescripts.js).
// API Instagram не используется.

import { extractMentions } from './classify.js';
import { parseCount, safeJson, walk } from './util.js';

export const igUrls = {
  profilePage: (u) => `https://www.instagram.com/${u}/`,
  taggedPage: (u) => `https://www.instagram.com/${u}/tagged/`,
  postPage: (code) => `https://www.instagram.com/p/${code}/`,
};

export class IgError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'login' | 'challenge' | 'rate_limit'
  }
}

// Проверка состояния страницы: не выкинуло ли на логин/проверку/«подождите».
export function assertPageUsable(scrape) {
  if (scrape.challenge) throw new IgError('challenge', 'Instagram запросил проверку аккаунта');
  if (scrape.loginWall) throw new IgError('login', 'требуется вход в Instagram');
  if (scrape.rateLimited) throw new IgError('rate_limit', 'Instagram просит подождать несколько минут');
}

const COUNT_LINE_RE = /^([\d.,\s ]+\s*(?:[KMB]|тыс\.?|млн)?)\s*(posts?|followers?|following|публикаци\S*|подписчик\S*|подписок|подписк\S*)$/i;
const UI_LINES = new Set([
  'follow', 'following', 'follow back', 'message', 'requested', 'edit profile', 'view archive', 'options',
  'verified', 'contact', 'email', 'call', 'directions', 'subscribe', 'share profile', 'ad tools',
  'подписаться', 'подписки', 'вы подписаны', 'отправить сообщение', 'сообщение', 'запрос отправлен',
  'редактировать профиль', 'посмотреть архив', 'подтвержденный', 'связаться', 'эл. адрес', 'поделиться профилем',
]);

function decodeLink(href) {
  try {
    const url = new URL(href);
    if (/(^|\.)l\.instagram\.com$/.test(url.hostname) && url.searchParams.get('u')) return url.searchParams.get('u');
    if (/instagram\.com$/.test(url.hostname)) return null;
    return href;
  } catch {
    return null;
  }
}

// Профиль из шапки страницы. Если страница отдала встроенные данные профиля — берём точные поля оттуда.
export function profileFromPage(scrape, username) {
  const u = username.toLowerCase();
  const profile = {
    username: u,
    fullName: '',
    bio: '',
    category: '',
    externalUrl: '',
    links: [],
    followers: null,
    following: null,
    postCount: null,
    isPrivate: !!scrape.isPrivate,
    isVerified: !!scrape.verified,
    source: 'страница',
  };

  // 1. Шапка профиля.
  const rawLines = String(scrape.headerText || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  // "18" и "posts" иногда оказываются на разных строках — склеиваем.
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const next = rawLines[i + 1];
    if (next && /^[\d.,\s\u00a0]+\s*(?:[KMB]|тыс\.?|млн)?$/i.test(rawLines[i]) && COUNT_LINE_RE.test(`${rawLines[i]} ${next}`)) {
      lines.push(`${rawLines[i]} ${next}`);
      i++;
    } else lines.push(rawLines[i]);
  }
  const rest = [];
  for (const line of lines) {
    const low = line.toLowerCase();
    const count = line.match(COUNT_LINE_RE);
    if (count) {
      const n = parseCount(count[1]);
      if (/^(post|публикаци)/i.test(count[2])) profile.postCount = n;
      else if (/^(follower|подписчик)/i.test(count[2])) profile.followers = n;
      else profile.following = n;
      continue;
    }
    if (low === u || UI_LINES.has(low) || /^(followed by|подписан|и ещё|and \d+ more)/i.test(low)) continue;
    rest.push(line);
  }
  if (rest.length) {
    profile.fullName = rest[0];
    profile.bio = rest.slice(1).join('\n');
  }
  profile.links = [...new Set((scrape.headerLinks || []).map((l) => decodeLink(l.href)).filter(Boolean))];
  profile.externalUrl = profile.links[0] || '';

  // 2. Мета-описание: "106K Followers, 3,497 Following, 18 Posts - See Instagram photos…".
  if (profile.followers == null && scrape.metaDescription) {
    const parts = scrape.metaDescription.split(/\s+[-–—]\s+/)[0].split(/,\s+/);
    if (parts.length >= 3) {
      profile.followers = parseCount(parts[0]);
      profile.following = parseCount(parts[1]);
      profile.postCount = parseCount(parts[2]);
    }
  }
  if (!profile.fullName && scrape.ogTitle) {
    profile.fullName = scrape.ogTitle.split(/\s*\(@/)[0].trim();
  }

  // 3. Встроенные в страницу данные профиля (если есть) — точнее, чем текст шапки.
  for (const blob of scrape.blobs || []) {
    const json = safeJson(blob);
    if (!json) continue;
    walk(json, (o) => {
      if (typeof o.username !== 'string' || o.username.toLowerCase() !== u || typeof o.biography !== 'string') return true;
      profile.fullName = o.full_name || profile.fullName;
      profile.bio = o.biography;
      profile.category = o.category || o.category_name || o.business_category_name || profile.category;
      if (o.external_url) profile.externalUrl = o.external_url;
      const bioLinks = (o.bio_links || []).map((l) => l.url).filter(Boolean);
      if (bioLinks.length) profile.links = [...new Set([...bioLinks, ...profile.links])];
      profile.followers = o.follower_count ?? o.edge_followed_by?.count ?? profile.followers;
      profile.postCount = o.media_count ?? profile.postCount;
      profile.isPrivate = o.is_private ?? profile.isPrivate;
      profile.isVerified = o.is_verified ?? profile.isVerified;
      return false;
    });
  }

  const empty = !profile.fullName && !profile.bio && profile.followers == null && !profile.links.length;
  return empty ? null : profile;
}

// Служебные элементы под комментарием: время, лайки, «Ответить», перевод и т. п. Часто идут одной строкой: "2w 3 likes Reply".
const NOISE_TOKEN_RE = new RegExp(
  [
    '\\b\\d+\\s*(?:s|m|h|d|w|y|sec|min|mins|hr|hrs)\\b',
    '\\d+\\s*(?:сек|мин|ч|д|дн|н|нед|г)\\.?(?=\\s|$)',
    '\\b[A-Z][a-z]{2,8} \\d{1,2}(?:, \\d{4})?\\b',
    '\\d{1,2} [а-я]{3,8}\\.?(?: \\d{4})?',
    '\\b\\d[\\d,.]*\\s*(?:likes?|replies|reply)\\b',
    '\\b(?:reply|see translation|translated|verified|edited|author|pinned|hide replies|view (?:all )?replies|view all \\d+ replies|like)\\b',
    'отметк\\S* «нравится»:?\\s*\\d*',
    '\\d+\\s*отметк\\S* «нравится»',
    '(?:ответить|показать перевод|изменено|автор|закреплено|скрыть ответы|посмотреть ответы|нравится)',
    '\\(\\d+\\)',
    '[•·—-]',
  ].join('|'),
  'gi',
);

// Склеенные элементы ("2wReply", "1 нед.Ответить") сначала разделяем по границе строчная→заглавная.
const isNoiseLine = (line) =>
  line
    .replace(/([a-zа-яё\d.])([A-ZА-ЯЁ])/g, '$1 $2')
    .replace(NOISE_TOKEN_RE, '')
    .replace(/[\s.,:]+/g, '') === '';

export function cleanCommentText(raw, handle) {
  return String(raw || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l.toLowerCase() !== handle && !isNoiseLine(l))
    .join(' ')
    .trim();
}

// Автор поста: из og:description ("12 likes, 3 comments - nick on May 1, 2026: …"), шапки или первого блока.
export function ownerFromPost(scrape) {
  const m = String(scrape.metaDescription || '').match(/[-–—]\s*([A-Za-z0-9_.]{1,30})\s+(?:on|в)\s/);
  if (m) return m[1].toLowerCase();
  if (scrape.ownerHint) return scrape.ownerHint;
  return scrape.blocks?.[0]?.handle || null;
}

// Комментарии и подпись автора со страницы поста.
export function parsePost(scrape) {
  const owner = ownerFromPost(scrape);
  let caption = '';
  let captionMentions = [];
  const comments = [];
  const seen = new Set();
  for (const b of scrape.blocks || []) {
    const text = cleanCommentText(b.text, b.handle);
    if (!text) continue;
    if (b.handle === owner && !caption) {
      caption = text;
      captionMentions = [...new Set([...extractMentions(text), ...b.mentions.map((x) => x.slice(1).toLowerCase())])];
      continue;
    }
    const key = `${b.handle}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    comments.push({ username: b.handle, text });
  }
  return { owner, caption, captionMentions, comments };
}
