import { KEYS, SOURCE_LABELS, sortedLeads } from '../lib/store.js';
import { csvEscape, formatCount } from '../lib/util.js';

export const send = (msg) => chrome.runtime.sendMessage(msg);

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const PRIORITY_LABELS = { hot: 'Горячий', warm: 'Тёплый', cold: 'Не артист', unchecked: 'Не проверен' };

export function priorityBadge(p) {
  return el('span', { class: `badge badge-${p}` }, PRIORITY_LABELS[p] || p);
}

export function sourceBadges(lead) {
  const types = [...new Set(lead.sources.map((s) => s.type))];
  return types.map((t) => el('span', { class: `chip chip-${t}` }, SOURCE_LABELS[t] || t));
}

export function bestComment(lead) {
  return lead.sources
    .filter((s) => s.type === 'comment')
    .sort((a, b) => (b.intent || 0) - (a.intent || 0))[0];
}

export const postUrl = (code) => `https://www.instagram.com/p/${code}/`;

export function leadsToCsv(leadsMap, statuses = {}) {
  const header = [
    'priority', 'username', 'profile_url', 'full_name', 'followers', 'tier', 'is_artist', 'artist_score',
    'category', 'bio', 'external_url', 'sources', 'producers', 'best_comment', 'comment_intent', 'comment_post',
    'artist_reasons', 'status', 'first_seen',
  ];
  const rows = sortedLeads(leadsMap).map((l) => {
    const c = bestComment(l);
    return [
      l.priority, l.username, l.url, l.fullName, l.followers, l.tier, l.isArtist, l.artistScore,
      l.category, l.bio, l.externalUrl,
      [...new Set(l.sources.map((s) => s.type))].join(' '),
      [...new Set(l.sources.map((s) => s.producer))].join(' '),
      c?.text, c?.intent, c ? postUrl(c.postCode) : '',
      (l.artistReasons || []).join('; '), statuses[l.username] || 'new', new Date(l.firstSeen).toISOString(),
    ];
  });
  return '\ufeff' + [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
}

export function download(filename, content, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportCsv(leadsMap) {
  const { [KEYS.leadStatus]: statuses } = await chrome.storage.local.get(KEYS.leadStatus);
  download(`type-beat-leads-${new Date().toISOString().slice(0, 10)}.csv`, leadsToCsv(leadsMap, statuses || {}));
}

export { formatCount };
