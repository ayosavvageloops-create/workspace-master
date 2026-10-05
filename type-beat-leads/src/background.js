// Оркестратор. Всё делается действиями во вкладках, без API:
// YouTube (поиск → «О канале» → при необходимости видео) → выбор продюсеров →
// Instagram (профиль → посты с комментариями → Tagged → профили кандидатов) → лиды.

import { analyzeComment, classifyArtist, scorePost } from './lib/classify.js';
import { IgError, assertPageUsable, igUrls, parsePost, profileFromPage } from './lib/instagram.js';
import { igScrapeGrid, igScrapePost, ytScrapeChannelAbout, ytScrapeSearch, ytScrapeVideo } from './lib/pagescripts.js';
import { EMPTY_JOB, KEYS, getLeads, getSettings, leadPriority } from './lib/store.js';
import { randomBetween, sleep } from './lib/util.js';
import {
  aggregateChannels,
  channelAboutUrl,
  findInstagramHandles,
  parseChannelAbout,
  parseInitialData,
  parseSearchResults,
  parseSubscribers,
  parseVideoDescription,
  searchUrl,
  videosFromScrape,
  watchUrl,
} from './lib/youtube.js';

// ---------- Состояние ----------

let job = structuredClone(EMPTY_JOB);
let leads = {};
let profileCache = {};
let settings = null;
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

// ---------- Вкладки ----------

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
  await sleep(800);
}

// Выполняет функцию из pagescripts.js на открытой странице. Если вкладка показывает ошибку сети — одна перезагрузка.
async function runInTab(key, func, args = []) {
  for (let attempt = 1; ; attempt++) {
    try {
      const [injection] = await chrome.scripting.executeScript({ target: { tabId: tabs[key] }, func, args });
      if (!injection || injection.result == null) throw new Error('страница не ответила');
      return injection.result;
    } catch (e) {
      const network = /error page|не ответила|No frame/i.test(e.message);
      if (network && attempt >= 2) throw new Error('страница не загрузилась (ошибка сети или страница недоступна)');
      if (!network) throw e;
      log('Страница не загрузилась, перезагружаю…', 'warn');
      const loaded = waitForComplete(tabs[key]);
      await chrome.tabs.reload(tabs[key]);
      await loaded;
      await sleep(1500);
    }
  }
}

async function visit(key, url, func, args = []) {
  await navigate(key, url);
  return runInTab(key, func, args);
}

// ---------- YouTube ----------

async function youtubePhase(s) {
  job.phase = 'youtube';
  log(`YouTube: ищу «${s.query}»`);
  const search = await visit('yt', searchUrl(s.query), ytScrapeSearch, [{ scrolls: Math.max(0, s.searchPages - 1) }]);
  let videos = videosFromScrape(search);
  if (!videos.length && search.script) {
    videos = parseSearchResults(parseInitialData(search.script) || {}).videos;
  }
  if (!videos.length) throw new Error('На странице поиска YouTube не нашлось видео. Проверьте запрос или откройте вкладку YouTube вручную.');

  const channels = aggregateChannels(videos).sort((a, b) => b.totalViews - a.totalViews);
  log(`Найдено ${videos.length} видео, ${channels.length} type beat-каналов`);

  const toCheck = channels.slice(0, s.channelsToCheck);
  for (let i = 0; i < toCheck.length; i++) {
    checkStop();
    const ch = toCheck[i];
    progress('Каналы YouTube', i, toCheck.length);
    try {
      const about = await visit('yt', channelAboutUrl(ch), ytScrapeChannelAbout);
      const fromScript = about.script ? parseChannelAbout(about.script) : { subscribers: null, handles: [] };
      ch.subscribers = parseSubscribers(`${about.headerText}\n${about.aboutText}`) ?? fromScript.subscribers;
      let handles = findInstagramHandles([about.aboutText, ...about.links].join('\n'));
      if (!handles.length) handles = fromScript.handles;
      ch.igSource = handles.length ? 'о канале' : null;

      // Нет Instagram в «О канале» — открываем видео канала и читаем описание.
      for (const v of handles.length ? [] : ch.sampleVideos.slice(0, 2)) {
        log(`${ch.name}: в «О канале» Instagram нет — открываю видео «${v.title.slice(0, 60)}»`);
        await pause(800, 1500);
        const video = await visit('yt', watchUrl(v.videoId), ytScrapeVideo);
        const desc = parseVideoDescription(`"shortDescription":"${video.shortDescription}"`);
        handles = findInstagramHandles([video.text, ...video.links, desc].join('\n'));
        if (handles.length) {
          ch.igSource = 'описание видео';
          break;
        }
      }
      ch.instagram = handles[0] || null;
      ch.instagramAlt = handles.slice(1, 3);
      log(
        `${ch.name}: ${ch.subscribers ?? '?'} подписчиков, IG: ${ch.instagram ? `@${ch.instagram} (${ch.igSource})` : 'не найден'}`,
      );
    } catch (e) {
      if (e instanceof StopError) throw e;
      log(`${ch.name}: ошибка — ${e.message}`, 'warn');
    }
    job.channels = toCheck.map(stripChannel);
    saveJob();
    await pause(700, 1500);
  }

  // Предварительно отмечаем самых крупных с найденным Instagram — пользователь может поменять выбор.
  const preselected = new Set(
    toCheck
      .filter((c) => c.instagram && (c.subscribers ?? 0) >= s.minSubscribers)
      .sort((a, b) => (b.subscribers || 0) - (a.subscribers || 0))
      .slice(0, s.producerCount)
      .map((c) => c.key),
  );
  job.channels = toCheck
    .map(stripChannel)
    .map((c) => ({ ...c, selected: preselected.has(c.key) }))
    .sort((a, b) => (b.subscribers || 0) - (a.subscribers || 0));
  return job.channels;
}

function stripChannel(c) {
  const { sampleVideos, ...rest } = c;
  return { ...rest, sampleVideo: sampleVideos?.[0]?.title || '' };
}

const channelToProducer = (c) => ({
  username: c.instagram,
  channelName: c.name,
  channelUrl: c.url,
  subscribers: c.subscribers,
});

// ---------- Instagram (только страницы) ----------

async function igVisit(url, func, opts) {
  for (let attempt = 1; ; attempt++) {
    const scrape = await visit('ig', url, func, [opts]);
    try {
      assertPageUsable(scrape);
    } catch (e) {
      if (e.kind === 'rate_limit' && attempt === 1) {
        log('Instagram просит подождать — пауза 3 минуты и повтор', 'warn');
        await pause(180000, 200000);
        continue;
      }
      throw e;
    }
    await pause(settings.delayMin, settings.delayMax);
    return scrape;
  }
}

const isFatalIg = (e) => e instanceof IgError;

function addCandidate(candidates, username, source) {
  if (!username) return;
  const u = username.toLowerCase();
  if (!candidates.has(u)) candidates.set(u, []);
  candidates.get(u).push(source);
}

async function scanProducer(producer, candidates, s, producerHandles) {
  const u = producer.username;
  log(`Instagram: открываю профиль @${u}`);
  const page = await igVisit(igUrls.profilePage(u), igScrapeGrid, {
    username: u,
    scrolls: Math.ceil(s.postsToFetch / 12),
    maxCodes: s.postsToFetch,
  });
  if (page.notFound) {
    producer.status = 'не найден';
    log(`@${u} не найден в Instagram`, 'warn');
    return;
  }
  const profile = profileFromPage(page, u);
  producer.followers = profile?.followers ?? null;
  producer.status = 'сканирую';
  producer.stats = { posts: page.codes.length, postsScanned: 0, comments: 0, intentComments: 0, tagged: 0, placements: 0 };
  saveJob();
  if (page.isPrivate) {
    producer.status = 'закрытый профиль';
    log(`@${u} — закрытый профиль, пропускаю`, 'warn');
    return;
  }
  log(`@${u}: ${producer.followers ?? '?'} подписчиков, в сетке ${page.codes.length} постов`);

  // Посты: открываем каждый, догружаем комментарии, читаем их со страницы.
  if (s.scanComments || s.includePlacements) {
    const posts = page.codes
      .map((c, i) => ({ ...c, caption: c.alt, rank: scorePost({ caption: c.alt, isVideo: c.isVideo }) - i * 0.05 }))
      .sort((a, b) => b.rank - a.rank)
      .slice(0, s.postsToScan);
    for (let i = 0; i < posts.length; i++) {
      const code = posts[i].code;
      progress(`@${u}: посты`, i, posts.length);
      let post;
      try {
        post = await igVisit(igUrls.postPage(code), igScrapePost, {
          maxComments: s.scanComments ? s.commentsPerPost : 0,
          maxLoads: s.scanComments ? Math.ceil(s.commentsPerPost / 12) : 0,
        });
      } catch (e) {
        if (isFatalIg(e) || e instanceof StopError) throw e;
        log(`Пост ${code}: ${e.message}`, 'warn');
        continue;
      }
      if (post.notFound) continue;
      const parsed = parsePost(post);

      if (s.includePlacements) {
        for (const m of parsed.captionMentions) {
          if (producerHandles.has(m)) continue;
          addCandidate(candidates, m, { type: 'placement', producer: u, postCode: code, text: parsed.caption.slice(0, 200) });
          producer.stats.placements++;
        }
      }
      if (s.scanComments) {
        for (const c of parsed.comments) {
          producer.stats.comments++;
          if (producerHandles.has(c.username)) continue;
          const intent = analyzeComment(c.text);
          if (intent.score < s.minIntent) continue;
          producer.stats.intentComments++;
          addCandidate(candidates, c.username, {
            type: 'comment',
            producer: u,
            postCode: code,
            text: c.text.slice(0, 300),
            intent: intent.score,
            labels: intent.labels,
          });
        }
      }
      producer.stats.postsScanned++;
      saveJob();
    }
    log(`@${u}: открыто ${producer.stats.postsScanned} постов, прочитано ${producer.stats.comments} комментариев, с намерением купить — ${producer.stats.intentComments}`);
  }

  // Tagged: открываем вкладку, затем каждый пост — его автор и есть кандидат.
  if (s.scanTagged) {
    log(`@${u}: открываю вкладку Tagged`);
    const tagged = await igVisit(igUrls.taggedPage(u), igScrapeGrid, {
      scrolls: Math.ceil(s.taggedPosts / 12) + 1,
      maxCodes: s.taggedPosts,
    });
    log(`@${u}: в Tagged ${tagged.codes.length} постов — открываю каждый`);
    for (let i = 0; i < tagged.codes.length; i++) {
      const code = tagged.codes[i].code;
      progress(`@${u}: Tagged`, i, tagged.codes.length);
      try {
        const post = await igVisit(igUrls.postPage(code), igScrapePost, { maxComments: 0, maxLoads: 0 });
        const parsed = parsePost(post);
        if (!parsed.owner || producerHandles.has(parsed.owner)) continue;
        addCandidate(candidates, parsed.owner, { type: 'tagged', producer: u, postCode: code, text: parsed.caption.slice(0, 200) });
        producer.stats.tagged++;
      } catch (e) {
        if (isFatalIg(e) || e instanceof StopError) throw e;
        log(`Tagged-пост ${code}: ${e.message}`, 'warn');
      }
    }
    log(`@${u}: из Tagged — ${producer.stats.tagged} постов других аккаунтов`);
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

async function saveLeads() {
  await chrome.storage.local.set({ [KEYS.leads]: leads });
}

async function checkProfiles(candidates, s, producerHandles) {
  job.phase = 'profiles';
  const ordered = [...candidates.entries()]
    .filter(([u]) => !producerHandles.has(u))
    .sort((a, b) => candidateRank(a[1]) - candidateRank(b[1]));
  log(`Кандидатов для проверки: ${ordered.length}`);

  const freshMs = s.recheckDays * 86400000;
  let opened = 0;
  let artists = 0;
  for (let i = 0; i < ordered.length; i++) {
    const [username, sources] = ordered[i];
    if (stopRequested) {
      for (const [cu, src] of ordered.slice(i)) upsertLead(cu, src, null, null);
      await saveLeads();
      checkStop();
    }
    progress('Проверка профилей', i, ordered.length);
    const cached = profileCache[username];
    let profile = cached && Date.now() - cached.checkedAt < freshMs ? cached.profile : null;
    if (!profile && opened < s.maxProfileChecks) {
      try {
        const page = await igVisit(igUrls.profilePage(username), igScrapeGrid, { username, scrolls: 0, maxCodes: 1 });
        opened++;
        if (page.notFound) {
          log(`@${username}: профиль не найден`, 'warn');
          continue;
        }
        profile = profileFromPage(page, username);
        if (profile) {
          profileCache[username] = { checkedAt: Date.now(), profile };
          await chrome.storage.local.set({ [KEYS.profileCache]: profileCache });
        } else {
          log(`@${username}: не удалось прочитать шапку профиля`, 'warn');
        }
      } catch (e) {
        if (isFatalIg(e) || e instanceof StopError) {
          for (const [cu, src] of ordered.slice(i)) upsertLead(cu, src, null, null);
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
  if (opened >= s.maxProfileChecks && ordered.length > opened) {
    log(`Достигнут лимит проверок (${s.maxProfileChecks}). Остальные сохранены как «не проверен» — запустите ещё раз, проверенные профили повторно не открываются.`, 'warn');
  }
  log(`Готово: артистов найдено — ${artists}`, 'success');
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
    if (producers.every((p) => p.status === 'ошибка')) {
      throw new Error('Не удалось открыть ни одного профиля продюсера в Instagram. Проверьте, что instagram.com открывается в этом браузере и вы вошли в аккаунт.');
    }
  } catch (e) {
    // Не теряем уже собранных кандидатов: сохраняем их как «не проверен».
    for (const [cu, sources] of candidates) if (!producerHandles.has(cu)) upsertLead(cu, sources, null, null);
    await saveLeads();
    throw e;
  }
  await checkProfiles(candidates, s, producerHandles);
}

// ---------- Запуск ----------

function parseManualProducers(text) {
  return String(text || '')
    .split(/[\s,;]+/)
    .map((h) => h.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/.*$/, '').toLowerCase())
    .filter(Boolean);
}

// producers — если передан, YouTube пропускается (продолжение после выбора в панели).
async function runJob(s, producers = null) {
  settings = s;
  stopRequested = false;
  leads = await getLeads();
  profileCache = (await chrome.storage.local.get(KEYS.profileCache))[KEYS.profileCache] || {};
  const keptChannels = producers ? job.channels : [];
  job = { ...structuredClone(EMPTY_JOB), running: true, status: 'running', startedAt: Date.now(), channels: keptChannels };
  await saveJob(true);
  startKeepAlive();
  try {
    let list = producers;
    if (!list) {
      const manual = parseManualProducers(s.manualProducers);
      if (manual.length) {
        list = manual.map((username) => ({ username, channelName: '(вручную)' }));
      } else {
        const channels = await youtubePhase(s);
        if (!s.autoSelect) {
          job.status = 'select';
          job.message = 'Отметьте продюсеров в списке и нажмите «Сканировать Instagram».';
          log(`Найдено каналов: ${channels.length}. Выберите продюсеров в панели.`, 'success');
          return;
        }
        list = channels.filter((c) => c.selected).map(channelToProducer);
        if (!list.length) throw new Error(`Нет каналов с Instagram и ≥ ${s.minSubscribers} подписчиков. Выберите продюсеров вручную.`);
      }
    }
    job.producers = list;
    log(`Сканирую Instagram: ${list.map((p) => '@' + p.username).join(', ')}`);
    await instagramPhase(list, s);
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

async function startWith(msgSettings) {
  const s = { ...(await getSettings()), ...(msgSettings || {}) };
  await chrome.storage.local.set({ [KEYS.settings]: s });
  return s;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case 'start': {
        if (job.running) return { ok: false, error: 'Уже запущено' };
        runJob(await startWith(msg.settings));
        return { ok: true };
      }
      case 'scanSelected': {
        if (job.running) return { ok: false, error: 'Уже запущено' };
        const producers = (msg.producers || [])
          .map((p) => ({ ...p, username: parseManualProducers(p.username)[0] }))
          .filter((p) => p.username);
        if (!producers.length) return { ok: false, error: 'Не выбрано ни одного продюсера с Instagram' };
        const saved = (await chrome.storage.local.get(KEYS.job))[KEYS.job];
        if (saved?.channels && !job.channels.length) job.channels = saved.channels;
        if (msg.channels) job.channels = msg.channels;
        runJob(await startWith(msg.settings), producers);
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
  } else if (saved && !job.running) {
    job = { ...structuredClone(EMPTY_JOB), ...saved };
  }
})();
