// Эвристики: (1) намерение купить в комментарии, (2) является ли профиль артистом, (3) релевантность поста продюсера.

const normalize = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

// [регулярка, вес, метка]. Вес ≥ 4 — сильный сигнал покупки.
const INTENT_RULES = [
  [/\b(check|chek|chk|look at|peep)\s*(ur|your|you|yo|ya|the)?\s*(dm|dms|inbox|messages?|pm|requests?)\b/, 5, 'check DM'],
  [/\b(dm'?d|dmed|dm'?ed you|sent (you|u|ya) (a )?(dm|message|msg)|in (ur|your) dms?|slid (in )?(ur|your) dms?)\b/, 4, 'написал в DM'],
  [/\b(trying to|tryin to|tryna|trynna|try to|wanna|want to|need to|finna|gonna|bout to|about to|ready to|looking to)\s+(buy|cop|purchase|lease|get (this|that|dis|it|the|a|one|some) ?(beat|one)?)\b/, 5, 'хочет купить'],
  [/\bwhere\s+(can|do|could|would)\s+i\s+(buy|get|find|cop|purchase|lease)\b/, 5, 'где купить'],
  [/\bhow\s+(much|mutch|much is|much for|do i (buy|get|purchase))\b/, 5, 'сколько стоит'],
  [/\b(price|pricing|prices|cost|costs|rates?)\b|\$\s?\d+/, 4, 'цена'],
  [/\b(buy|purchase|cop|lease|leasing|exclusive rights?|exclusives?)\b/, 3, 'покупка'],
  [/\b(is (this|it|that|dis)( beat)? (still )?(available|avail|for sale|sold))|\bstill available\b|\bavailable\s*\??$/, 4, 'доступен ли бит'],
  [/\b(send|drop|share)\s+(me|us)?\s*(the|that|this|dis|some|a|ur|your)?\s*(beat|beats|pack|link|loops?|instrumental)\b/, 4, 'просит прислать бит'],
  [/\b(need|want|gotta have)\s+(this|that|dis|the|a|some|ur|your)?\s*(beat|beats|instrumental|pack)\b/, 4, 'нужен бит'],
  [/\b(i|ima|i'?m|i'?ll|let me|lemme)\s*(need to|want to|wanna|gotta|going to|gonna|finna|bout to|about to)?\s*(hop|jump|get|go|rap|sing|ride)\s+on\s+(this|that|dis|it)\b/, 3, 'хочет записаться'],
  [/\b(can|could|may)\s+i\s+(use|have|get|record|hop on|rap on)\b/, 3, 'можно использовать'],
  [/\b(lets|let'?s|we (gotta|need to|should))\s+(work|collab|link|cook|lock in)\b|\bwork together\b/, 3, 'работать вместе'],
  [/\b(my (new )?(song|track|single|album|ep|mixtape|project)|for my (song|album|ep|project|tape))\b/, 3, 'про свой релиз'],
  [/\b(hmu|hit me up|hit my (dm|line|phone)|email me|link up|contact (me|you))\b/, 2, 'на связь'],
  [/\b(beatstars|airbit|link\s*\?)/, 2, 'спрашивает ссылку'],
];

// Спам других продюсеров и пустые реакции.
const NEGATIVE_INTENT = [
  [/\b(check (out )?my (page|channel|beats|profile|bio|ig)|i make beats|producer here|follow (me|back)|sub(scribe)? to my|send (me )?(your )?(drums|kits?|loops) )/, -5],
  [/\b(i (sent|send) (you )?(some )?(beats|loops|melodies))\b/, -4],
];

export function analyzeComment(rawText) {
  const t = normalize(rawText);
  if (!t || t.length < 3) return { score: 0, labels: [] };
  let score = 0;
  const labels = [];
  for (const [re, weight, label] of INTENT_RULES) {
    if (re.test(t)) {
      score += weight;
      labels.push(label);
    }
  }
  for (const [re, weight] of NEGATIVE_INTENT) if (re.test(t)) score += weight;
  return { score: Math.max(0, Math.min(score, 15)), labels };
}

// ---------- Артист или нет ----------

const MUSIC_LINK_RE =
  /(open\.spotify\.com|spotify\.link|music\.apple\.com|itunes\.apple\.com|soundcloud\.com|on\.soundcloud|audiomack\.com|tidal\.com|deezer\.com|music\.youtube\.com|hyperfollow|distrokid|ffm\.to|lnk\.to|unitedmasters|songwhip|bfan\.link|smarturl|toneden|fanlink|orcd\.co|too\.fm|found\.ee|ditto\.fm)/i;
const LINK_HUB_RE = /(linktr\.ee|beacons\.ai|stan\.store|snipfeed|komi\.io|hoo\.be|lnk\.bio|linkin\.bio)/i;

const ARTIST_CATEGORY_RE = /(musician|band|artist|singer|rapper|songwriter|hip.?hop|entertainer)/i;
const PRODUCER_CATEGORY_RE = /(producer|production|recording studio|record label|\bdj\b|audio|sound engineer|music lessons)/i;
const OTHER_CATEGORY_RE = /(photograph|videograph|video creator|clothing|shopping|retail|brand|barber|beauty|salon|restaurant|real estate|fitness|coach|gaming|blogger|media\/news|news & media|tattoo)/i;

const BIO_POSITIVE = [
  [/\b(artist|rapper|singer|songwriter|vocalist|r&b|rnb|hip ?hop|emcee|musician|recording artist)\b/i, 3, 'артист в био'],
  [/\b(new (single|song|music|album|ep|mixtape|video)|out now|stream(ing)? (now|it|my)|listen (now|here|to)|available (now|everywhere)|watch (the|my) video|new music)\b/i, 2, 'релизы в био'],
  [/\b(booking|bookings|features?|mgmt|management|signed|label|ent\.?|entertainment|for shows)\b/i, 2, 'букинг/фиты'],
  [/(🎤|🎙|🎶|🎵|💿|📀|🎧)/u, 1, 'музыкальные эмодзи'],
  [/\b(spotify|apple music|soundcloud|audiomack|tidal|youtube)\b/i, 1, 'площадки в био'],
];

const BIO_NEGATIVE = [
  [/\b(producer|prod\.?|beat ?maker|beats|type beats?|instrumentals?|808s?|drum ?kits?|sample ?packs?|loop ?kits?|melodies|beatstars|airbit|cook ?ups?)\b/i, -4, 'продюсер'],
  [/\b(mix(ing)?\s*(&|and|\/|\+)\s*master(ing)?|audio engineer|engineer|recording studio|studio sessions?)\b/i, -3, 'звукорежиссёр/студия'],
  [/\b(photographer|videographer|director|dop|editor|model|clothing|apparel|brand|shop|store|barber|tattoo|nails|real estate|crypto|forex|trader|coach|promo(tion)?s?|repost)\b/i, -3, 'не музыкант'],
];

const PRODUCER_USERNAME_RE = /(beats?|beatz|prod|producer|onthe(beat|track)|made(it)?by|808|keys|loops|\bmix\b|engineer|studio)/i;

export function followerTier(followers) {
  if (followers == null) return 'unknown';
  if (followers < 1000) return 'micro';
  if (followers < 10000) return 'small';
  if (followers < 100000) return 'mid';
  if (followers < 1000000) return 'large';
  return 'star';
}

// profile — нормализованный профиль (см. instagram.js → normalizeProfile).
export function classifyArtist(profile, threshold = 3) {
  let score = 0;
  const reasons = [];
  const push = (w, r) => {
    score += w;
    reasons.push(`${w > 0 ? '+' : ''}${w} ${r}`);
  };
  const category = profile.category || '';
  if (PRODUCER_CATEGORY_RE.test(category)) push(-5, `категория «${category}»`);
  else if (ARTIST_CATEGORY_RE.test(category)) push(4, `категория «${category}»`);
  else if (OTHER_CATEGORY_RE.test(category)) push(-3, `категория «${category}»`);

  const bio = `${profile.fullName || ''}\n${profile.bio || ''}`;
  for (const [re, w, r] of BIO_POSITIVE) if (re.test(bio)) push(w, r);
  for (const [re, w, r] of BIO_NEGATIVE) if (re.test(bio)) push(w, r);

  const links = [profile.externalUrl, ...(profile.links || [])].filter(Boolean).join(' ');
  if (MUSIC_LINK_RE.test(links)) push(3, 'ссылка на стриминг');
  else if (LINK_HUB_RE.test(links)) push(1, 'мультиссылка');

  if (PRODUCER_USERNAME_RE.test(profile.username || '')) push(-3, 'ник продюсера');
  if (profile.postCount === 0) push(-2, 'нет постов');

  const tier = followerTier(profile.followers);
  return { score, isArtist: score >= threshold, reasons, tier };
}

// ---------- Релевантность поста продюсера (бит / плейсмент) ----------

const POST_KEYWORDS_RE =
  /\b(beat|beats|prod\.?|produced|placement|out now|type beat|cook ?up|link in bio|beatstars|lease|exclusive|available|pack|kit|studio|session|instrumental|dm (me|to)|new music|snippet|unreleased)\b|🔥|🎹|🎛/i;

export function scorePost(post) {
  let score = 0;
  if (POST_KEYWORDS_RE.test(post.caption || '')) score += 3;
  if (post.isVideo) score += 2;
  if ((post.mentions || []).length || (post.taggedUsers || []).length) score += 2; // вероятный плейсмент
  score += Math.log10((post.commentCount || 0) + 1) * 2;
  return score;
}

export function extractMentions(textValue) {
  const out = new Set();
  for (const m of String(textValue || '').matchAll(/@([A-Za-z0-9_.]{2,30})/g)) {
    out.add(m[1].replace(/\.+$/, '').toLowerCase());
  }
  return [...out];
}
