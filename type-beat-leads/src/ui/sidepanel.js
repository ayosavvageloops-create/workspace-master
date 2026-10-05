import { EMPTY_JOB, KEYS, getJob, getLeads, getSettings, sortedLeads } from '../lib/store.js';
import { bestComment, el, exportCsv, formatCount, priorityBadge, send, sourceBadges } from './common.js';

const $ = (id) => document.getElementById(id);
const form = $('settings');

const STATUS_LABELS = {
  idle: 'Ожидание',
  running: 'Работает',
  select: 'Выбор продюсеров',
  done: 'Готово',
  stopped: 'Остановлено',
  error: 'Ошибка',
  interrupted: 'Прервано',
};

function fillForm(s) {
  for (const [k, v] of Object.entries(s)) {
    const input = form.elements[k];
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = !!v;
    else input.value = v;
  }
}

function readForm() {
  const out = {};
  for (const input of form.elements) {
    if (!input.name) continue;
    if (input.type === 'checkbox') out[input.name] = input.checked;
    else if (input.type === 'number') out[input.name] = Number(input.value);
    else out[input.name] = input.value.trim();
  }
  if (out.delayMax < out.delayMin) out.delayMax = out.delayMin;
  return out;
}

function renderJob(job) {
  const badge = $('statusBadge');
  badge.textContent = STATUS_LABELS[job.status] || job.status;
  badge.className = `badge status-${job.status}`;
  $('startBtn').hidden = job.running;
  $('stopBtn').hidden = !job.running;
  for (const input of form.elements) if (input.name) input.disabled = job.running;
  $('clearLeads').disabled = job.running;

  $('progressCard').hidden = job.status === 'idle';
  $('message').textContent = job.running ? '' : job.message || '';
  const { label, done, total } = job.progress || {};
  $('progressLabel').textContent = label ? `${label}: ${done}/${total}` : '';
  $('progressFill').style.width = total ? `${Math.round((done / total) * 100)}%` : job.running ? '100%' : '0';
  $('progressFill').classList.toggle('indeterminate', job.running && !total);

  $('producers').replaceChildren(
    ...(job.producers || []).map((p) =>
      el('div', { class: 'producer' },
        el('a', { href: `https://www.instagram.com/${p.username}/`, target: '_blank' }, `@${p.username}`),
        el('span', { class: 'muted' },
          [
            p.subscribers != null ? `YT ${formatCount(p.subscribers)}` : null,
            p.followers != null ? `IG ${formatCount(p.followers)}` : null,
            p.stats ? `💬 ${p.stats.intentComments}/${p.stats.comments}` : null,
            p.stats ? `🏷 ${p.stats.tagged}` : null,
            p.status,
          ].filter(Boolean).join(' · '),
        ),
      ),
    ),
  );

  const logBox = $('log');
  const atBottom = logBox.scrollTop + logBox.clientHeight >= logBox.scrollHeight - 20;
  logBox.replaceChildren(
    ...(job.log || []).slice(-200).map((e) =>
      el('div', { class: `log-${e.level}` },
        el('span', { class: 'muted' }, new Date(e.t).toLocaleTimeString()), ' ', e.msg),
    ),
  );
  if (atBottom) logBox.scrollTop = logBox.scrollHeight;

  renderChannels(job);
}

// ---------- Выбор продюсеров после YouTube ----------

let channels = [];
let channelsVersion = null;

function renderChannels(job) {
  const card = $('channelsCard');
  const list = job.channels || [];
  card.hidden = job.running || !list.length;
  if (card.hidden) return;
  // Пересобираем список только когда пришли новые каналы, чтобы не сбить отметки пользователя.
  const version = list.map((c) => `${c.key}:${c.instagram}`).join('|');
  if (version === channelsVersion) return;
  channelsVersion = version;
  channels = list.map((c) => ({ ...c, selected: !!c.selected, instagram: c.instagram || '' }));
  drawChannels();
}

function drawChannels() {
  const picked = channels.filter((c) => c.selected && c.instagram).length;
  $('channelsCount').textContent = `выбрано ${picked} из ${channels.length}`;
  $('scanSelected').disabled = picked === 0;
  $('channelList').replaceChildren(
    ...channels.map((c, i) =>
      el('div', { class: `channel${c.selected ? ' selected' : ''}` },
        el('input', {
          type: 'checkbox',
          checked: c.selected,
          onchange: (e) => {
            channels[i].selected = e.target.checked;
            drawChannels();
          },
        }),
        el('div', { class: 'channel-body' },
          el('a', { href: c.url, target: '_blank', class: 'channel-name' }, c.name || c.path || c.key),
          el('div', { class: 'muted small-text' },
            [
              c.subscribers != null ? `${formatCount(c.subscribers)} подп.` : 'подписчики ?',
              `${c.videoCount} видео в выдаче`,
              c.igSource ? `IG: ${c.igSource}` : 'IG не найден',
            ].join(' · '),
          ),
          el('input', {
            type: 'text',
            value: c.instagram ? `@${c.instagram}` : '',
            placeholder: '@instagram продюсера',
            oninput: (e) => {
              channels[i].instagram = e.target.value.trim().replace(/^@/, '');
              if (channels[i].instagram && !channels[i].selected) channels[i].selected = true;
              $('scanSelected').disabled = !channels.some((x) => x.selected && x.instagram);
            },
            onchange: drawChannels,
          }),
        ),
      ),
    ),
  );
}

$('scanSelected').addEventListener('click', async () => {
  const producers = channels
    .filter((c) => c.selected && c.instagram)
    .map((c) => ({ username: c.instagram, channelName: c.name, channelUrl: c.url, subscribers: c.subscribers }));
  const res = await send({ type: 'scanSelected', producers, channels, settings: readForm() });
  if (!res?.ok) alert(res?.error || 'Не удалось запустить');
});

let currentLeads = {};

function renderLeads(leads) {
  currentLeads = leads;
  const list = sortedLeads(leads);
  const by = (p) => list.filter((l) => l.priority === p).length;
  $('counts').replaceChildren(
    el('span', { class: 'badge badge-hot' }, `🔥 ${by('hot')}`),
    el('span', { class: 'badge badge-warm' }, `${by('warm')} артистов`),
    el('span', { class: 'muted' }, `всего ${list.length}`),
  );
  const top = list.filter((l) => l.priority === 'hot' || l.priority === 'warm').slice(0, 30);
  $('leadList').replaceChildren(
    ...(top.length
      ? top.map((l) => {
          const c = bestComment(l);
          return el('div', { class: 'lead' },
            el('div', { class: 'lead-head' },
              el('a', { href: l.url, target: '_blank' }, `@${l.username}`),
              priorityBadge(l.priority),
              el('span', { class: 'muted' }, formatCount(l.followers)),
            ),
            el('div', { class: 'chips' }, sourceBadges(l)),
            c ? el('div', { class: 'quote' }, `«${c.text}»`) : null,
          );
        })
      : [el('p', { class: 'hint' }, 'Пока пусто. Запустите поиск.')]),
  );
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await send({ type: 'start', settings: readForm() });
  if (!res?.ok) alert(res?.error || 'Не удалось запустить');
});
$('stopBtn').addEventListener('click', () => send({ type: 'stop' }));
$('openTable').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/results.html') }));
$('exportCsv').addEventListener('click', () => exportCsv(currentLeads));
$('clearLeads').addEventListener('click', async () => {
  if (confirm('Удалить все найденные лиды?')) await send({ type: 'clearLeads' });
});
form.addEventListener('change', () => {
  chrome.storage.local.set({ [KEYS.settings]: readForm() });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[KEYS.job]) renderJob({ ...EMPTY_JOB, ...(changes[KEYS.job].newValue || {}) });
  if (changes[KEYS.leads]) renderLeads(changes[KEYS.leads].newValue || {});
});

(async () => {
  fillForm(await getSettings());
  renderJob(await getJob());
  renderLeads(await getLeads());
})();
