// Оркестратор: YouTube → Instagram продюсеров → комментарии + Tagged → проверка профилей → лиды.

import { analyzeComment, classifyArtist, scorePost } from './lib/classify.js';
import { IgError, igUrls, normalizeComments, normalizeFeed, normalizeProfile, parseIgResponse } from './lib/instagram.js';
import { EMPTY_JOB, KEYS, getLeads, getSettings, leadPriority } from './lib/store.js';
import { randomBetween, sleep } from './lib/util.js';
import {
  aggregateChannels,
  channelAboutUrl,
  continuationRequest,
  findInstagramHandles,
  parseChannelAbout,
  parseInitialData,
  parseSearchResults,
  parseVideoDescription,
  parseYtcfg,
  searchUrl,
  watchUrl,
} from './lib/youtube.js';

// ---------- Состояние ----------

let job = structuredClone(EMPTY_JOB);
let leads = {};
let profileCache = {};
let stopRequested = false;
let keepAliveTimer = null;
const tabs = { yt: null, ig: null };

class StopError extends Error {}

let saveJobTimer = null;
function saveJob(immediate = false) {
  const write = () => {
    saveJobTimer = null;
    return chrome.storage.local.set({ [KEYS.job]: job });
  };
  if (immediate) {
    clearTimeout(saveJobTimer);
    return write();
  }
  if (!saveJobTimer) saveJobTimer = setTimeout(write, 300);
  return Promise.resolve();
}

function log(msg, level = 'info') {
  job.log.push({ t: Date.now(), level, msg });
  if (job.log.length > 400) job.log.splice(0, job.log.length - 400);
  saveJob();
}

function progress(label, done, total) {
  job.progress = { label, done, total };
  saveJob();
}

function checkStop() {
  if (stopRequested) throw new StopError('Остановлено пользователем');
}

async function pause(min, max) {
  const ms = randomBetween(min, max);
  const until = Date.now() + ms;
  while (Date.now() < until) {
    checkStop();
    await sleep(Math.min(1000, until - Date.now()));
  }
}

// Service worker MV3 засыпает через ~30 с простоя: вызов API расширения сбрасывает таймер.
function startKeepAlive() {
  stopKeepAlive();
  keepAliveTimer = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
}
function stopKeepAlive() {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  keepAliveTimer = null;
}

// ---------- Вкладки и запросы из контекста страницы ----------

async function tabAlive(id) {
  if (id == null) return false;
  try {
    await chrome.tabs.get(id);
    return true;
  } catch {
    return false;
  }
}

function waitForComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') done();
    };
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function navigate(key, url) {
  checkStop();
  if (await tabAlive(tabs[key])) {
    const loaded = waitForComplete(tabs[key]);
    await chrome.tabs.update(tabs[key], { url });
    await loaded;
  } else {
    const tab = await chrome.tabs.create({ url, active: true });
    tabs[key] = tab.id;
    await waitForComplete(tab.id);
  }
  await sleep(800); // даём SPA дорисоваться
  return tabs[key];
}

// Выполняется ВНУТРИ страницы (youtube.com / instagram.com): fetch с куками пользователя.
async function injectedFetch(url, opts) {
  try {
    const headers = Object.assign({}, opts && opts.headers);
    if (opts && opts.instagram) {
      const csrf = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
      if (csrf) headers['X-CSRFToken'] = csrf[1];
      headers['X-IG-App-ID'] = '936619743392459';
      headers['X-ASBD-ID'] = '129477';
      headers['X-Requested-With'] = 'XMLHttpRequest';
      try {
        const claim = sessionStorage.getItem('www-claim-v2');
        if (claim) headers['X-IG-WWW-Claim'] = claim;
      } catch (e) {}
    }
    const res = await fetch(url, {
      method: (opts && opts.method) || 'GET',
      headers,
      body: opts && opts.body,
      credentials: 'include',
    });
    return { ok: res.ok, status: res.status, url: res.url, text: await res.text() };
  } catch (e) {
    return { ok: false, status: 0, url, text: '', error: String(e) };
  }
}

async function pageFetch(tabId, url, opts = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        func: injectedFetch,
        args: [url, opts],
      });
      return injection?.result || { ok: false, status: 0, text: '', error: 'скрипт не выполнился' };
    } catch (e) {
      // Вкладка показывает страницу сетевой ошибки — одна попытка перезагрузить.
      if (attempt >= 2 || !/error page/i.test(e.message)) throw e;
      log('Вкладка не загрузилась, перезагружаю…', 'warn');
      const loaded = waitForComplete(tabId);
      await chrome.tabs.reload(tabId);
      await loaded;
      await sleep(1500);
    }
  }
}

async function ensureTab(key, fallbackUrl) {
  if (!(await tabAlive(tabs[key]))) await navigate(key, fallbackUrl);
  return tabs[key];
}

// ---------- YouTube ----------

async function ytFetch(url, opts) {
  const tabId = await ensureTab('yt', 'https://www.youtube.com/');
  const res = await pageFetch(tabId, url, opts);
  if (!res.ok) throw new Error(`YouTube HTTP ${res.status} ${res.error || ''}`.trim());
  return res.text;
}

async function youtubePhase(s) {
  job.phase = 'youtube';
  log(`YouTube: ищу «${s.query}»`);
  const url = searchUrl(s.query);
  await navigate('yt', url);
  const html = await ytFetch(url);
  const data = parseInitialData(html);
  if (!data) throw new Error('Не удалось разобрать выдачу YouTube (ytInitialData не найден)');
  const ytcfg = parseYtcfg(html);

  let { videos, continuation } = parseSearchResults(data);
  for (let page = 2; page <= s.searchPages && continuation; page++) {
    checkStop();
    progress('Страницы выдачи YouTube', page - 1, s.searchPages);
    await pause(800, 1600);
    const req = continuationRequest(ytcfg, continuation);
    try {
      const next = parseSearchResults(JSON.parse(await ytFetch(req.url, req.options)));
      videos = videos.concat(next.videos);
      continuation = next.continuation;
    } catch (e) {
      log(`Не удалось подгрузить страницу ${page}: ${e.message}`, 'warn');
      break;
    }
  }
  const channels = aggregateChannels(videos).sort((a, b) => b.totalViews - a.totalViews);
  log(`Найдено ${videos.length} видео, ${channels.length} type beat-каналов`);

  const toCheck = channels.slice(0, Math.max(s.producerCount * 4, 10));
  for (let i = 0; i < toCheck.length; i++) {
    checkStop();
    const ch = toCheck[i];
    progress('Проверка каналов YouTube', i, toCheck.length);
    try {
      const aboutUrl = channelAboutUrl(ch);
      if (s.visualNavigation) await navigate('yt', aboutUrl);
      const about = parseChannelAbout(await ytFetch(aboutUrl));
      ch.subscribers = about.subscribers;
      ch.instagram = about.handles[0] || null;
      if (!ch.instagram && ch.sampleVideos[0]) {
        await pause(600, 1200);
        const desc = parseVideoDescription(await ytFetch(watchUrl(ch.sampleVideos[0].videoId)));
        ch.instagram = findInstagramHandles(desc)[0] || null;
      }
      log(`${ch.name}: ${ch.subscribers ?? '?'} подписчиков, IG: ${ch.instagram ? '@' + ch.instagram : 'не найден'}`);
    } catch (e) {
      log(`${ch.name}: ошибка — ${e.message}`, 'warn');
    }
    job.channels = toCheck.map(stripChannel);
    saveJob();
    await pause(700, 1500);
  }

  const chosen = toCheck
    .filter((c) => c.instagram && (c.subscribers ?? 0) >= s.minSubscribers)
    .sort((a, b) => (b.subscribers || 0) - (a.subscribers || 0));
  const seen = new Set();
  const producers = [];
  for (const c of chosen) {
    if (seen.has(c.instagram)) continue;
    seen.add(c.instagram);
    producers.push({ username: c.instagram, channelName: c.name, channelUrl: c.url, subscribers: c.subscribers });
    if (producers.length >= s.producerCount) break;
  }
  if (!producers.length) {
    throw new Error(
      `Не найдено каналов с Instagram и ≥ ${s.minSubscribers} подписчиков. Уменьшите порог или укажите продюсеров вручную.`,
    );
  }
  log(`Выбраны продюсеры: ${producers.map((p) => '@' + p.username).join(', ')}`, 'success');
  return producers;
}

function stripChannel(c) {
  const { sampleVideos, ...rest } = c;
  return { ...rest, sampleVideo: sampleVideos[0]?.title || '' };
}

// ---------- Instagram ----------

let settings = null;

async function igRequest(url) {
  const tabId = await ensureTab('ig', 'https://www.instagram.com/');
  for (let attempt = 1; ; attempt++) {
    checkStop();
    const res = await pageFetch(tabId, url, { instagram: true });
    try {
      const json = parseIgResponse(res);
      await pause(settings.delayMin, settings.delayMax);
      return json;
    } catch (e) {
      if (!(e instanceof IgError)) throw e;
      if (e.kind === 'rate_limit' && attempt <= 3) {
        const wait = 60000 * attempt;
        log(`Instagram ограничил запросы — жду ${wait / 1000} с (попытка ${attempt}/3)`, 'warn');
        await pause(wait, wait + 5000);
        continue;
      }
      if (e.kind === 'network' && attempt <= 2) {
        await pause(3000, 5000);
        continue;
      }
      throw e;
    }
  }
}

// Ошибки, после которых продолжать Instagram-часть бессмысленно.
const isFatalIg = (e) => e instanceof IgError && ['login', 'challenge', 'rate_limit'].includes(e.kind);

async function fetchProfile(username) {
  try {
    return normalizeProfile(await igRequest(igUrls.profileInfo(username)));
  } catch (e) {
    if (e instanceof IgError && e.kind === 'not_found') return null;
    throw e;
  }
}

async function fetchPosts(profile, limit) {
  const posts = [];
  let maxId = null;
  try {
    do {
      const page = normalizeFeed(await igRequest(igUrls.userFeed(profile.id, maxId)));
      posts.push(...page.items);
      maxId = page.nextMaxId;
    } while (maxId && posts.length < limit);
  } catch (e) {
    if (isFatalIg(e) || e instanceof StopError) throw e;
    log(`Лента @${profile.username} недоступна через API (${e.message}) — беру первые посты профиля`, 'warn');
  }
  return (posts.length ? posts : profile.recentPosts).slice(0, limit);
}

function addCandidate(candidates, username, source) {
  if (!username) return;
  const u = username.toLowerCase();
  if (!candidates.has(u)) candidates.set(u, []);
  candidates.get(u).push(source);
}

async function scanProducer(producer, candidates, s, producerHandles) {
  log(`Instagram: открываю @${producer.username}`);
  await navigate('ig', igUrls.profilePage(producer.username));
  const tab = await chrome.tabs.get(tabs.ig);
  if (/\/accounts\/login/.test(tab.url || '')) throw new IgError('login', 'требуется вход в Instagram');

  const profile = await fetchProfile(producer.username);
  if (!profile) {
    producer.status = 'не найден';
    log(`@${producer.username} не найден в Instagram`, 'warn');
    return;
  }
  Object.assign(producer, { id: profile.id, followers: profile.followers, isPrivate: profile.isPrivate, status: 'сканирую' });
  producer.stats = { posts: 0, postsScanned: 0, comments: 0, intentComments: 0, tagged: 0, placements: 0 };
  saveJob();
  if (profile.isPrivate) {
    producer.status = 'закрытый профиль';
    log(`@${producer.username} — закрытый профиль, пропускаю`, 'warn');
    return;
  }

  const posts = await fetchPosts(profile, s.postsToFetch);
  producer.stats.posts = posts.length;
  log(`@${producer.username}: ${profile.followers} подписчиков, получено ${posts.length} постов`);

  // Плейсменты: артисты, отмеченные/упомянутые в постах продюсера.
  if (s.includePlacements) {
    for (const p of posts) {
      for (const u of new Set([...p.taggedUsers, ...p.mentions])) {
        if (producerHandles.has(u)) continue;
        addCandidate(candidates, u, {
          type: 'placement',
          producer: producer.username,
          postCode: p.code,
          text: p.caption.slice(0, 200),
        });
        producer.stats.placements++;
      }
    }
  }

  // Комментарии под битами/плейсментами.
  if (s.scanComments) {
    const ranked = posts
      .filter((p) => p.commentCount > 0)
      .sort((a, b) => scorePost(b) - scorePost(a))
      .slice(0, s.postsToScan);
    for (let i = 0; i < ranked.length; i++) {
      const post = ranked[i];
      progress(`@${producer.username}: комментарии`, i, ranked.length);
      if (s.visualNavigation) await navigate('ig', igUrls.postPage(post.code));
      let cursor = null;
      let fetched = 0;
      try {
        do {
          const page = normalizeComments(await igRequest(igUrls.comments(post.id, cursor)));
          for (const c of page.comments) {
            fetched++;
            if (!c.username || producerHandles.has(c.username)) continue;
            const intent = analyzeComment(c.text);
            if (intent.score >= s.minIntent) {
              producer.stats.intentComments++;
              addCandidate(candidates, c.username, {
                type: 'comment',
                producer: producer.username,
                postCode: post.code,
                text: c.text.slice(0, 300),
                intent: intent.score,
                labels: intent.labels,
                at: c.createdAt,
              });
            }
          }
          cursor = page.comments.length ? page.cursor : null;
        } while (cursor && fetched < s.commentsPerPost);
      } catch (e) {
        if (isFatalIg(e) || e instanceof StopError) throw e;
        log(`Комментарии поста ${post.code}: ${e.message}`, 'warn');
      }
      producer.stats.comments += fetched;
      producer.stats.postsScanned++;
      saveJob();
    }
    log(`@${producer.username}: просмотрено ${producer.stats.comments} комментариев, с намерением купить — ${producer.stats.intentComments}`);
  }

  // Вкладка Tagged: посты, где продюсер отмечен (обычно — треки артистов на его битах).
  if (s.scanTagged) {
    await navigate('ig', igUrls.taggedPage(producer.username));
    let maxId = null;
    let count = 0;
    try {
      do {
        const page = normalizeFeed(await igRequest(igUrls.tagged(profile.id, maxId)));
        for (const item of page.items) {
          count++;
          if (!item.owner || producerHandles.has(item.owner)) continue;
          addCandidate(candidates, item.owner, {
            type: 'tagged',
            producer: producer.username,
            postCode: item.code,
            text: item.caption.slice(0, 200),
          });
          producer.stats.tagged++;
        }
        maxId = page.nextMaxId;
        progress(`@${producer.username}: Tagged`, count, s.taggedPosts);
      } while (maxId && count < s.taggedPosts);
    } catch (e) {
      if (isFatalIg(e) || e instanceof StopError) throw e;
      log(`Tagged @${producer.username}: ${e.message}`, 'warn');
    }
    log(`@${producer.username}: в Tagged найдено ${producer.stats.tagged} постов от других аккаунтов`);
  }
  producer.status = 'готово';
  saveJob();
}

const SOURCE_ORDER = { comment: 0, tagged: 1, placement: 2 };

function candidateRank(sources) {
  const best = Math.min(...sources.map((s) => SOURCE_ORDER[s.type]));
  const intent = Math.max(0, ...sources.map((s) => s.intent || 0));
  return best * 100 - intent - sources.length * 0.1;
}

function sourceKey(s) {
  return [s.type, s.producer, s.postCode, s.text].join('|');
}

function upsertLead(username, sources, profile, verdict) {
  const now = Date.now();
  const lead = leads[username] || { username, url: igUrls.profilePage(username), sources: [], firstSeen: now };
  const known = new Set(lead.sources.map(sourceKey));
  for (const s of sources) if (!known.has(sourceKey(s))) lead.sources.push(s);
  if (profile) {
    Object.assign(lead, {
      fullName: profile.fullName,
      bio: profile.bio,
      category: profile.category,
      externalUrl: profile.externalUrl,
      links: profile.links,
      followers: profile.followers,
      postCount: profile.postCount,
      isPrivate: profile.isPrivate,
      isVerified: profile.isVerified,
    });
  }
  if (verdict) {
    Object.assign(lead, {
      isArtist: verdict.isArtist,
      artistScore: verdict.score,
      artistReasons: verdict.reasons,
      tier: verdict.tier,
    });
  } else if (lead.isArtist === undefined) {
    lead.isArtist = null;
  }
  lead.priority = leadPriority(lead);
  lead.updatedAt = now;
  leads[username] = lead;
}

async function checkProfiles(candidates, s, producerHandles) {
  job.phase = 'profiles';
  const ordered = [...candidates.entries()]
    .filter(([u]) => !producerHandles.has(u))
    .sort((a, b) => candidateRank(a[1]) - candidateRank(b[1]));
  log(`Кандидатов для проверки: ${ordered.length}`);

  const freshMs = s.recheckDays * 86400000;
  let fetched = 0;
  let artists = 0;
  for (let i = 0; i < ordered.length; i++) {
    if (stopRequested) {
      for (const [u, src] of ordered.slice(i)) upsertLead(u, src, null, null);
      await saveLeads();
      checkStop();
    }
    const [username, sources] = ordered[i];
    progress('Проверка профилей', i, ordered.length);
    const cached = profileCache[username];
    let profile = cached && Date.now() - cached.checkedAt < freshMs ? cached.profile : null;
    if (!profile && fetched < s.maxProfileChecks) {
      try {
        if (s.visualNavigation) await navigate('ig', igUrls.profilePage(username));
        profile = await fetchProfile(username);
        fetched++;
        if (profile) {
          const { recentPosts, ...slim } = profile;
          profile = slim;
          profileCache[username] = { checkedAt: Date.now(), profile };
          await chrome.storage.local.set({ [KEYS.profileCache]: profileCache });
        }
      } catch (e) {
        if (isFatalIg(e) || e instanceof StopError) {
          for (const [u, src] of ordered.slice(i)) upsertLead(u, src, null, null);
          await saveLeads();
          throw e;
        }
        log(`@${username}: ${e.message}`, 'warn');
      }
    }
    const verdict = profile ? classifyArtist(profile, s.artistThreshold) : null;
    if (verdict?.isArtist) artists++;
    upsertLead(username, sources, profile, verdict);
    if (profile) {
      log(
        `@${username}: ${verdict.isArtist ? 'АРТИСТ' : 'не артист'} (score ${verdict.score}, ${profile.followers ?? '?'} подп.)`,
        verdict.isArtist ? 'success' : 'info',
      );
    }
    await saveLeads();
  }
  if (fetched >= s.maxProfileChecks && ordered.length > fetched) {
    log(`Достигнут лимит проверок (${s.maxProfileChecks}). Остальные кандидаты сохранены как «не проверен» — запустите ещё раз, кэш не даст проверять повторно.`, 'warn');
  }
  log(`Готово: артистов найдено — ${artists}`, 'success');
}

async function saveLeads() {
  await chrome.storage.local.set({ [KEYS.leads]: leads });
}

async function instagramPhase(producers, s) {
  job.phase = 'instagram';
  const producerHandles = new Set(producers.map((p) => p.username));
  const candidates = new Map();
  try {
    for (let i = 0; i < producers.length; i++) {
      checkStop();
      progress('Продюсеры', i, producers.length);
      try {
        await scanProducer(producers[i], candidates, s, producerHandles);
      } catch (e) {
        if (isFatalIg(e) || e instanceof StopError) throw e;
        producers[i].status = 'ошибка';
        log(`@${producers[i].username}: ${e.message}`, 'warn');
      }
    }
  } catch (e) {
    // Не теряем уже собранных кандидатов: сохраняем их как «не проверен».
    for (const [u, sources] of candidates) if (!producerHandles.has(u)) upsertLead(u, sources, null, null);
    await saveLeads();
    throw e;
  }
  await checkProfiles(candidates, s, producerHandles);
}

// ---------- Запуск ----------

async function runJob(s) {
  settings = s;
  stopRequested = false;
  leads = await getLeads();
  profileCache = (await chrome.storage.local.get(KEYS.profileCache))[KEYS.profileCache] || {};
  job = { ...structuredClone(EMPTY_JOB), running: true, status: 'running', startedAt: Date.now() };
  await saveJob(true);
  startKeepAlive();
  try {
    const manual = s.manualProducers
      .split(/[\s,;]+/)
      .map((h) => h.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/.*$/, '').toLowerCase())
      .filter(Boolean);
    job.producers = manual.length
      ? manual.map((username) => ({ username, channelName: '(вручную)' }))
      : await youtubePhase(s);
    saveJob();
    await instagramPhase(job.producers, s);
    job.status = 'done';
    job.message = 'Готово';
  } catch (e) {
    if (e instanceof StopError) {
      job.status = 'stopped';
      job.message = 'Остановлено. Найденные лиды сохранены.';
    } else {
      job.status = 'error';
      job.message = e instanceof IgError ? `Instagram: ${e.message}` : e.message;
      log(job.message, 'error');
      if (e instanceof IgError && e.kind === 'login') log('Откройте instagram.com, войдите в аккаунт и запустите снова.', 'error');
    }
  } finally {
    await saveLeads();
    job.running = false;
    job.finishedAt = Date.now();
    job.progress = { label: '', done: 0, total: 0 };
    stopKeepAlive();
    await saveJob(true);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case 'start': {
        if (job.running) return { ok: false, error: 'Уже запущено' };
        const s = { ...(await getSettings()), ...(msg.settings || {}) };
        await chrome.storage.local.set({ [KEYS.settings]: s });
        runJob(s);
        return { ok: true };
      }
      case 'stop':
        stopRequested = true;
        return { ok: true };
      case 'clearLeads':
        if (job.running) return { ok: false, error: 'Сначала остановите задачу' };
        leads = {};
        await chrome.storage.local.set({ [KEYS.leads]: {}, [KEYS.leadStatus]: {} });
        return { ok: true };
      case 'clearCache':
        profileCache = {};
        await chrome.storage.local.set({ [KEYS.profileCache]: {} });
        return { ok: true };
      default:
        return { ok: false, error: 'unknown message' };
    }
  })().then(sendResponse);
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

// Если воркер перезапустился посреди задачи — честно помечаем её прерванной.
(async () => {
  const { [KEYS.job]: saved } = await chrome.storage.local.get(KEYS.job);
  if (saved?.running && !job.running) {
    await chrome.storage.local.set({
      [KEYS.job]: { ...saved, running: false, status: 'interrupted', message: 'Задача прервана (браузер выгрузил расширение). Лиды сохранены — запустите снова.' },
    });
  }
})();
