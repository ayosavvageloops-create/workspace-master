// Опенеры: шаблоны со спинтаксом и переменными.
//   Спинтакс:   {Yo|Hey|What's good}   — случайный вариант (можно вкладывать)
//   Переменные: {{name}}  {{first_name}}  {{username}}  {{любая_колонка_из_CSV}}
//   Фолбэк:     {{first_name:bro}}      — если значения нет, подставится «bro»

const VAR_RE = /\{\{\s*([\w.-]+)\s*(?::([^}]*))?\}\}/g;

export function artistVars(artist) {
  const name = (artist.name || '').trim();
  return {
    ...(artist.fields || {}),
    username: artist.username,
    name,
    first_name: name.split(/\s+/)[0] || '',
    url: artist.url || `https://www.instagram.com/${artist.username}/`,
  };
}

export function substituteVars(text, vars) {
  const missing = [];
  const out = text.replace(VAR_RE, (_, key, fallback) => {
    const v = vars[key] ?? vars[key.toLowerCase()];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    if (fallback !== undefined) return fallback;
    missing.push(key);
    return '';
  });
  return { text: out, missing };
}

export function spin(text, rng = Math.random) {
  let s = text;
  // Раскрываем самые внутренние {a|b} пока они есть. {без_палки} оставляем как есть.
  for (let guard = 0; guard < 1000; guard++) {
    let changed = false;
    s = s.replace(/\{([^{}]*\|[^{}]*)\}/, (_, body) => {
      changed = true;
      const opts = body.split('|');
      return opts[Math.floor(rng() * opts.length)];
    });
    if (!changed) break;
  }
  return s;
}

function tidy(s) {
  return s
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([,.!?])/g, '$1')
    .replace(/,\s*([!?.])/g, '$1')
    .trim();
}

/** Рендер шаблона для конкретного артиста. Переменные подставляются ДО спинтакса, чтобы {{x}} не путались с {a|b}. */
export function renderOpener(templateText, artist, rng = Math.random) {
  const { text, missing } = substituteVars(templateText, artistVars(artist));
  return { text: tidy(spin(text, rng)), missing };
}

export function pickTemplate(templates, rng = Math.random) {
  const pool = templates.filter((t) => t.enabled !== false && t.text && t.text.trim());
  if (!pool.length) return null;
  const total = pool.reduce((s, t) => s + (Number(t.weight) > 0 ? Number(t.weight) : 1), 0);
  let r = rng() * total;
  for (const t of pool) {
    r -= Number(t.weight) > 0 ? Number(t.weight) : 1;
    if (r < 0) return t;
  }
  return pool[pool.length - 1];
}

