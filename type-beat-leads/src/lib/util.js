// Общие утилиты. Чистые функции — без chrome.* API, чтобы их можно было тестировать в node.

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const randomBetween = (min, max) =>
  Math.round(min + Math.random() * Math.max(0, max - min));

// "1.2M subscribers" -> 1200000, "12,345 views" -> 12345, "987K" -> 987000.
export function parseCount(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const match = String(value)
    .replace(/ /g, ' ')
    .match(/(\d[\d.,\s]*)\s*([KMB])?/i);
  if (!match) return null;
  const suffix = (match[2] || '').toUpperCase();
  let digits = match[1].trim();
  digits = suffix ? digits.replace(',', '.').replace(/\s/g, '') : digits.replace(/[.,\s]/g, '');
  const num = parseFloat(digits);
  if (Number.isNaN(num)) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[suffix] || 1;
  return Math.round(num * mult);
}

export function formatCount(n) {
  if (n == null) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return String(n);
}

// Итеративный обход JSON (YouTube отдаёт очень глубокие деревья).
export function walk(root, visit) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (visit(node) === false) continue;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
    } else {
      const keys = Object.keys(node);
      for (let i = keys.length - 1; i >= 0; i--) stack.push(node[keys[i]]);
    }
  }
}

// Достаёт JSON-объект, начинающийся с первой "{" после маркера, с учётом строк и экранирования.
export function extractJsonAfter(text, marker) {
  const idx = text.indexOf(marker);
  if (idx === -1) return null;
  const start = text.indexOf('{', idx + marker.length);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function csvEscape(value) {
  if (value == null) return '';
  const s = String(value);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
