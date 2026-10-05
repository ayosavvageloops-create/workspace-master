import { KEYS, LEAD_STATUSES, SOURCE_LABELS, getLeads, sortedLeads } from '../lib/store.js';
import { download, el, exportCsv, formatCount, postUrl, priorityBadge } from './common.js';

const $ = (id) => document.getElementById(id);
let leads = {};
let statuses = {};

for (const [value, label] of Object.entries(LEAD_STATUSES)) {
  $('statusFilter').append(el('option', { value }, label));
}

function sourceCell(lead) {
  const items = lead.sources
    .slice()
    .sort((a, b) => (b.intent || 0) - (a.intent || 0))
    .slice(0, 4)
    .map((s) =>
      el('div', { class: 'src' },
        el('span', { class: `chip chip-${s.type}` }, SOURCE_LABELS[s.type]),
        ' ',
        el('a', { href: postUrl(s.postCode), target: '_blank', class: 'muted' }, `@${s.producer}`),
        s.type === 'comment'
          ? el('div', { class: 'quote' }, `«${s.text}»`, el('span', { class: 'muted' }, ` · намерение ${s.intent}: ${(s.labels || []).join(', ')}`))
          : null,
      ),
    );
  const more = lead.sources.length - items.length;
  return [items, more > 0 ? el('div', { class: 'muted' }, `+ ещё ${more}`) : null];
}

function artistCell(lead) {
  if (lead.isArtist == null) return el('span', { class: 'muted' }, 'не проверен');
  return el('div', {},
    el('strong', {}, lead.isArtist ? `Да (${lead.artistScore})` : `Нет (${lead.artistScore})`),
    el('div', { class: 'muted small-text', title: (lead.artistReasons || []).join('\n') },
      (lead.artistReasons || []).slice(0, 3).join(', ')),
  );
}

function statusSelect(lead) {
  const select = el('select', {
    onchange: async (e) => {
      statuses[lead.username] = e.target.value;
      await chrome.storage.local.set({ [KEYS.leadStatus]: statuses });
    },
  });
  for (const [value, label] of Object.entries(LEAD_STATUSES)) {
    select.append(el('option', { value, selected: (statuses[lead.username] || 'new') === value }, label));
  }
  return select;
}

function matches(lead) {
  const pf = $('priority').value;
  if (pf === 'artists' && !(lead.priority === 'hot' || lead.priority === 'warm')) return false;
  if (pf !== 'artists' && pf !== 'all' && lead.priority !== pf) return false;
  const sf = $('source').value;
  if (sf && !lead.sources.some((s) => s.type === sf)) return false;
  const prod = $('producer').value;
  if (prod && !lead.sources.some((s) => s.producer === prod)) return false;
  const st = $('statusFilter').value;
  if (st && (statuses[lead.username] || 'new') !== st) return false;
  const q = $('search').value.trim().toLowerCase();
  if (q) {
    const hay = [lead.username, lead.fullName, lead.bio, lead.category, ...lead.sources.map((s) => s.text)].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function render() {
  const all = sortedLeads(leads);
  const producers = [...new Set(all.flatMap((l) => l.sources.map((s) => s.producer)))].sort();
  const prodSelect = $('producer');
  const current = prodSelect.value;
  prodSelect.replaceChildren(el('option', { value: '' }, 'Все продюсеры'), ...producers.map((p) => el('option', { value: p, selected: p === current }, `@${p}`)));

  const by = (p) => all.filter((l) => l.priority === p).length;
  $('counts').replaceChildren(
    el('span', { class: 'badge badge-hot' }, `Горячих ${by('hot')}`),
    el('span', { class: 'badge badge-warm' }, `Артистов ${by('warm')}`),
    el('span', { class: 'badge badge-unchecked' }, `Не проверено ${by('unchecked')}`),
    el('span', { class: 'muted' }, `Всего ${all.length}`),
  );

  const rows = all.filter(matches).map((l) =>
    el('tr', {},
      el('td', {}, priorityBadge(l.priority)),
      el('td', {},
        el('a', { href: l.url, target: '_blank', class: 'handle' }, `@${l.username}`),
        l.isVerified ? ' ✔' : null,
        el('div', { class: 'muted' }, l.fullName || ''),
        l.category ? el('div', { class: 'muted small-text' }, l.category) : null,
      ),
      el('td', {}, formatCount(l.followers), l.isPrivate ? el('div', { class: 'muted small-text' }, 'закрытый') : null),
      el('td', {}, artistCell(l)),
      el('td', {}, [...new Set(l.sources.map((s) => SOURCE_LABELS[s.type]))].join(', ')),
      el('td', { class: 'wide' }, sourceCell(l)),
      el('td', { class: 'bio' },
        l.bio || '',
        l.externalUrl ? el('div', {}, el('a', { href: l.externalUrl, target: '_blank' }, l.externalUrl.replace(/^https?:\/\//, '').slice(0, 40))) : null,
      ),
      el('td', {}, statusSelect(l)),
    ),
  );
  document.querySelector('#table tbody').replaceChildren(...rows);
  $('empty').hidden = rows.length > 0;
}

for (const id of ['search', 'priority', 'source', 'producer', 'statusFilter']) {
  $(id).addEventListener('input', render);
}
$('exportCsv').addEventListener('click', () => exportCsv(leads));
$('exportJson').addEventListener('click', () =>
  download(`type-beat-leads-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(sortedLeads(leads).map((l) => ({ ...l, status: statuses[l.username] || 'new' })), null, 2),
    'application/json'),
);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[KEYS.leads]) {
    leads = changes[KEYS.leads].newValue || {};
    render();
  }
  if (changes[KEYS.leadStatus]) statuses = changes[KEYS.leadStatus].newValue || {};
});

(async () => {
  leads = await getLeads();
  statuses = (await chrome.storage.local.get(KEYS.leadStatus))[KEYS.leadStatus] || {};
  render();
})();
