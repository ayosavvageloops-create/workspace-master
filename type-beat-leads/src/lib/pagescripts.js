// Функции, которые выполняются ВНУТРИ открытых вкладок (chrome.scripting.executeScript).
// Никаких запросов к API: только ожидание отрисовки, прокрутка, клики «показать ещё» и чтение страницы.
// Каждая функция должна быть самодостаточной — chrome сериализует её текст, внешние переменные недоступны.

// ---------- YouTube ----------

export async function ytScrapeSearch(opts) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const CARD = 'ytd-video-renderer, yt-lockup-view-model';
  for (let t = 0; t < 50 && !document.querySelector(CARD); t++) await sleep(300);
  for (let i = 0; i < ((opts && opts.scrolls) || 0); i++) {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await sleep(2000);
  }
  const CHANNEL = 'a[href^="/@"], a[href^="/channel/"], a[href^="/c/"], a[href^="/user/"]';
  const videos = [];
  const seen = new Set();
  for (const card of document.querySelectorAll(CARD)) {
    const link = card.querySelector('a[href*="/watch?v="]');
    const m = link && link.getAttribute('href').match(/[?&]v=([\w-]{6,})/);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    const titleEl = card.querySelector('#video-title, h3 a, h3');
    const channelLinks = [...card.querySelectorAll(CHANNEL)];
    const named = card.querySelector('ytd-channel-name a') || channelLinks.find((a) => a.textContent.trim());
    const anyChannel = named || channelLinks[0];
    const vm = card.innerText.match(/(\d{1,3}(?:[,\s ]\d{3})+|\d+(?:[.,]\d+)?)\s*([KMB]|тыс\.?|млн)?\s*(?:views|просмотр)/i);
    const views = vm ? vm[1] + (vm[2] || '') : '';
    videos.push({
      videoId: m[1],
      title: ((titleEl && (titleEl.getAttribute('title') || titleEl.textContent)) || '').trim(),
      channelPath: anyChannel ? anyChannel.getAttribute('href').split('?')[0] : null,
      channelName: named ? named.textContent.trim() : '',
      viewsText: views,
    });
  }
  window.scrollTo(0, 0);
  // Если карточки не распознались (YouTube поменял вёрстку) — отдаём данные, с которыми загрузилась страница.
  const script = videos.length
    ? ''
    : [...document.scripts].map((s) => s.textContent || '').find((t) => t.includes('var ytInitialData')) || '';
  return { url: location.href, videos, script };
}

export async function ytScrapeChannelAbout() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let t = 0; t < 50; t++) {
    if (document.querySelector('ytd-about-channel-renderer, yt-page-header-renderer, #page-header')) break;
    await sleep(300);
  }
  await sleep(1500);
  const about = document.querySelector('ytd-about-channel-renderer');
  const header = document.querySelector('yt-page-header-renderer, #page-header');
  const links = [];
  for (const scope of [about, header]) {
    if (!scope) continue;
    for (const a of scope.querySelectorAll('a[href]')) links.push(`${a.href} ${a.innerText || ''}`);
  }
  // Данные, с которыми загрузилась сама страница (тот же HTML, что видит браузер).
  const script = [...document.scripts].map((s) => s.textContent || '').find((t) => t.includes('var ytInitialData')) || '';
  return {
    url: location.href,
    aboutText: about ? about.innerText : '',
    headerText: header ? header.innerText : '',
    links,
    script,
  };
}

export async function ytScrapeVideo() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let t = 0; t < 50 && !document.querySelector('ytd-watch-metadata, #description'); t++) await sleep(300);
  await sleep(1500);
  for (const v of document.querySelectorAll('video')) {
    v.muted = true;
    v.pause();
  }
  // Блок описания (не SVG с тем же id): перебираем селекторы по порядку.
  const findDesc = () =>
    [
      'ytd-watch-metadata #description-inline-expander',
      '#description-inline-expander',
      'ytd-watch-metadata ytd-text-inline-expander',
      'ytd-watch-metadata #description',
      'ytd-video-secondary-info-renderer #description',
    ]
      .map((sel) => document.querySelector(sel))
      .find((e) => e && typeof e.innerText === 'string' && e.innerText.trim());
  let desc = findDesc();
  const expand = desc && desc.querySelector('#expand, tp-yt-paper-button#expand, button[aria-label*="more" i]');
  if (expand) {
    expand.click();
    await sleep(800);
    desc = findDesc() || desc;
  }
  const script = [...document.scripts].map((s) => s.textContent || '').find((t) => t.includes('"shortDescription"')) || '';
  const m = script.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
  return {
    url: location.href,
    text: desc ? desc.innerText : '',
    links: desc ? [...desc.querySelectorAll('a[href]')].map((a) => `${a.href} ${a.innerText || ''}`) : [],
    shortDescription: m ? m[1] : '',
  };
}

// ---------- Instagram ----------

// Профиль или вкладка Tagged: шапка профиля + сетка постов (с прокруткой).
export async function igScrapeGrid(opts) {
  const o = opts || {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const bodyText = () => (document.body && document.body.innerText) || '';
  const NOT_FOUND = /Sorry, this page isn.t available|Profile isn.t available|Эта страница недоступна|Страница недоступна|Профиль недоступен/i;
  for (let t = 0; t < 50; t++) {
    if (document.querySelector('main header') || NOT_FOUND.test(bodyText().slice(0, 3000))) break;
    await sleep(300);
  }
  await sleep(1500);

  const codes = [];
  const seen = new Set();
  const collect = () => {
    for (const a of document.querySelectorAll('main a[href]')) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]{5,})/);
      if (!m || seen.has(m[1])) continue;
      seen.add(m[1]);
      const img = a.querySelector('img');
      codes.push({
        code: m[1],
        alt: (img && img.getAttribute('alt')) || '',
        isVideo: /\/reel\//.test(href) || !!a.querySelector('svg[aria-label*="Reel"], svg[aria-label*="Clip"], svg[aria-label*="Video"], svg[aria-label*="Видео"]'),
      });
    }
  };
  collect();
  const max = o.maxCodes || 0;
  for (let i = 0; i < (o.scrolls || 0) && codes.length < max; i++) {
    window.scrollBy(0, window.innerHeight * 2);
    await sleep(2000);
    collect();
  }
  window.scrollTo(0, 0);

  const header = document.querySelector('main header');
  const meta = (sel) => (document.querySelector(sel) && document.querySelector(sel).getAttribute('content')) || '';
  const text = bodyText();
  const u = (o.username || '').toLowerCase();
  const blobs = [];
  if (u) {
    for (const s of document.querySelectorAll('script[type="application/json"]')) {
      const t = s.textContent || '';
      if (t.includes(`"username":"${u}"`) && t.includes('"biography"')) {
        blobs.push(t);
        if (blobs.length >= 3) break;
      }
    }
  }
  return {
    url: location.href,
    loginWall: /\/accounts\/login/.test(location.pathname) || !!document.querySelector('input[name="password"]'),
    challenge: /\/challenge\//.test(location.pathname),
    rateLimited: /Please wait a few minutes|Подождите несколько минут/i.test(text.slice(0, 3000)),
    notFound: NOT_FOUND.test(text.slice(0, 3000)),
    isPrivate: /This account is private|Это закрытый аккаунт/i.test(text),
    verified: !!(header && header.querySelector('svg[aria-label="Verified"], svg[aria-label*="Подтвержд"]')),
    headerText: header ? header.innerText : '',
    headerLinks: header ? [...header.querySelectorAll('a[href]')].map((a) => ({ href: a.href, text: (a.innerText || '').trim() })) : [],
    metaDescription: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
    ogTitle: meta('meta[property="og:title"]'),
    codes: max ? codes.slice(0, max) : codes,
    blobs,
  };
}

// Страница поста: автор, подпись, комментарии. Догружает комментарии кликами «ещё» и прокруткой.
export async function igScrapePost(opts) {
  const o = opts || {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let t = 0; t < 50 && !document.querySelector('main time, article time'); t++) await sleep(300);
  await sleep(1500);
  for (const v of document.querySelectorAll('video')) {
    v.muted = true;
    v.pause();
  }
  const root = () => document.querySelector('main') || document.body;
  const PROFILE_RE = /^\/([A-Za-z0-9_.]{1,30})\/$/;
  // Ссылка-ник: href="/nick/" и видимый текст совпадает с ником (аватарки и @упоминания не считаются).
  const nameOf = (a) => {
    const m = (a.getAttribute('href') || '').match(PROFILE_RE);
    if (!m) return null;
    return (a.innerText || '').trim().toLowerCase() === m[1].toLowerCase() ? m[1].toLowerCase() : null;
  };
  // Блок комментария = самый верхний предок ника, в котором нет ников других людей.
  const extract = () => {
    const out = [];
    const used = new Set();
    for (const a of root().querySelectorAll('a[href]')) {
      const handle = nameOf(a);
      if (!handle) continue;
      let block = null;
      let el = a;
      for (let k = 0; k < 12 && el.parentElement && el.parentElement !== document.body; k++) {
        const parent = el.parentElement;
        const foreign = [...parent.querySelectorAll('a[href]')].some((b) => {
          const h = nameOf(b);
          return h && h !== handle;
        });
        if (foreign) break;
        el = parent;
        block = parent;
      }
      if (!block || used.has(block)) continue;
      used.add(block);
      out.push({
        handle,
        text: block.innerText || '',
        mentions: [...block.querySelectorAll('a[href]')].map((b) => (b.innerText || '').trim()).filter((t) => t.startsWith('@')),
      });
    }
    return out;
  };
  const clickLoadMore = () => {
    const icon = [...root().querySelectorAll('svg[aria-label]')].find((s) =>
      /load more comments|more comments|загрузить другие|ещё комментари|больше комментари/i.test(s.getAttribute('aria-label')),
    );
    const btn = icon && (icon.closest('button, [role="button"]') || icon.parentElement);
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  };

  const maxComments = o.maxComments || 50;
  for (let i = 0; i < (o.maxLoads || 0); i++) {
    const before = extract().length;
    if (before >= maxComments) break;
    const clicked = clickLoadMore();
    const names = [...root().querySelectorAll('a[href]')].filter(nameOf);
    if (names.length) names[names.length - 1].scrollIntoView({ block: 'end' });
    await sleep(2000);
    if (!clicked && extract().length <= before) break;
  }

  const headerAnchor = [...document.querySelectorAll('main header a[href], article header a[href]')].find(nameOf);
  const meta = (sel) => (document.querySelector(sel) && document.querySelector(sel).getAttribute('content')) || '';
  const text = (document.body && document.body.innerText) || '';
  return {
    url: location.href,
    loginWall: /\/accounts\/login/.test(location.pathname) || !!document.querySelector('input[name="password"]'),
    challenge: /\/challenge\//.test(location.pathname),
    rateLimited: /Please wait a few minutes|Подождите несколько минут/i.test(text.slice(0, 3000)),
    notFound: /Sorry, this page isn.t available|Эта страница недоступна|Страница недоступна/i.test(text.slice(0, 3000)),
    ownerHint: headerAnchor ? nameOf(headerAnchor) : null,
    metaDescription: meta('meta[property="og:description"]') || meta('meta[name="description"]'),
    blocks: extract(),
  };
}
