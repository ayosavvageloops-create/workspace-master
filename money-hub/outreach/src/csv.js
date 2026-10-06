// Импорт артистов: CSV/TSV с заголовком, либо просто список ников/ссылок построчно.

export function parseCsv(text) {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const delim = [',', ';', '\t'].reduce(
    (best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best),
    ',',
  );
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

const ALIASES = {
  username: ['username', 'user', 'login', 'nick', 'nickname', 'handle', 'instagram', 'ig', 'link', 'url', 'profile', 'ник', 'юзернейм', 'ссылка', 'инстаграм'],
  name: ['name', 'artist', 'artist_name', 'artistname', 'full_name', 'fullname', 'имя', 'артист'],
  opener: ['opener', 'message', 'dm', 'text', 'first_message', 'опенер', 'сообщение', 'текст'],
};

function canonical(header) {
  const h = header.toLowerCase().replace(/[\s-]+/g, '_');
  for (const [key, list] of Object.entries(ALIASES)) if (list.includes(h)) return key;
  return null;
}

/** instagram.com/foo/?hl=en, @foo, "foo " → foo */
export function normalizeUsername(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  const m = s.match(/(?:instagram\.com|instagr\.am)\/([^/?#\s]+)/i);
  if (m) s = m[1];
  s = s.replace(/^@/, '').replace(/\/+$/, '').trim().toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(s)) return '';
  return s;
}

/** → { artists: [{username,name,opener,fields}], invalid: [строки] } */
export function parseArtists(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { artists: [], invalid: [] };
  const header = rows[0].map(canonical);
  const hasHeader = header.includes('username');
  const cols = hasHeader ? rows[0] : null;
  const body = hasHeader ? rows.slice(1) : rows;
  const artists = [];
  const invalid = [];
  for (const r of body) {
    let a;
    if (hasHeader) {
      a = { fields: {} };
      r.forEach((v, i) => {
        const key = header[i];
        if (key) { if (!a[key]) a[key] = v; }
        else if (cols[i]) a.fields[cols[i].trim().toLowerCase().replace(/\s+/g, '_')] = v;
      });
    } else {
      a = { username: r[0], name: r[1] || '', opener: r[2] || '', fields: {} };
    }
    const username = normalizeUsername(a.username);
    if (!username) { invalid.push(r.join(' | ')); continue; }
    artists.push({ username, name: a.name || '', opener: a.opener || '', fields: a.fields });
  }
  return { artists, invalid };
}

export function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n');
}
