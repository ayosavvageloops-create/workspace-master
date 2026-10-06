'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let snap = null;
let logFor = null;
const busy = new Set();

// ---------- навигация ----------
function show(view) {
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  document.querySelectorAll('section').forEach((s) => s.classList.toggle('on', s.id === view));
}
document.querySelectorAll('nav button').forEach((b) => (b.onclick = () => show(b.dataset.view)));

function toast(text, err = false) {
  const t = $('#toast');
  t.textContent = text;
  t.className = `show${err ? ' err' : ''}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.className = ''), err ? 6000 : 2500);
}

// ---------- программы ----------
const STATUS = { running: 'работает', starting: 'запускается…', failed: 'ошибка', idle: 'выключено', done: 'завершено', tool: '' };

function moduleButtons(m) {
  const b = (act, label, cls = '') =>
    `<button class="btn ${cls}" data-mod="${m.id}" data-act="${act}" ${busy.has(m.id + act) ? 'disabled' : ''}>${label}</button>`;
  const out = [];
  if (!m.found) out.push(`<span class="warn-text note">Папка не найдена: ${esc(m.dir)}. Укажи её в Настройках.</span>`);
  if (m.kind === 'server') {
    if (m.status === 'running') {
      if (m.outreach?.running) out.push(b('outreach-stop', '⏹ Остановить рассылку', 'danger'));
      else out.push(b('outreach-start', '▶ Запустить рассылку', 'pri'));
      out.push(b('import-leads', 'Перенести лиды'), b('panel', 'Открыть панель'));
      if (!m.external) out.push(b('stop', 'Выключить'));
    } else out.push(b('start', 'Включить', 'pri'));
  } else if (m.kind === 'process') {
    out.push(m.status === 'running' ? b('stop', 'Остановить', 'danger') : b('start', 'Запустить', 'pri'));
  } else if (m.kind === 'app') {
    out.push(b('start', m.status === 'running' ? 'Показать' : 'Открыть', m.status === 'running' ? '' : 'pri'));
  } else {
    out.push(b('start', 'Открыть', 'pri'));
  }
  if (m.log) out.push(`<button class="btn" data-log="${m.id}">Лог</button>`);
  return out.join('');
}

function moduleExtra(m) {
  if (m.outreach) {
    const o = m.outreach;
    return `<div class="stats">
      <div><span>Отправлено сегодня</span><b>${o.sentToday}</b></div>
      <div><span>В очереди</span><b>${o.queue}</b></div>
      <div><span>Профилей</span><b>${o.profilesSelected}${o.profilesBlocked ? `<small class="warn-text"> −${o.profilesBlocked}</small>` : ''}</b></div>
    </div>${o.lastLog ? `<div class="note">${esc(o.lastLog)}</div>` : ''}`;
  }
  if (m.kind === 'chrome') {
    const e = m.latestExport;
    if (!e) return '<div class="note">Экспортов в «Загрузках» пока нет. В таблице лидов нажми «Экспорт CSV».</div>';
    const when = new Date(e.mtimeMs).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `<div class="note">Последний экспорт: ${esc(e.name)} · ${when} · ${e.imported ? 'перенесён в рассылку ✓' : '<b>ещё не перенесён</b>'}</div>`;
  }
  return '';
}

function renderModules() {
  $('#modules').innerHTML = snap.modules.map((m) => `
    <div class="card">
      <div class="mod-head">
        <span class="dot ${m.status}"></span>
        <div class="t"><b>${esc(m.title)}</b><div class="r">${esc(m.role)}</div></div>
        <span class="status ${m.status}">${STATUS[m.status] ?? ''}${m.external ? ' (снаружи)' : ''}</span>
      </div>
      ${moduleExtra(m)}
      <div class="actions">${moduleButtons(m)}</div>
    </div>`).join('');
}

$('#modules').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.log) return openLog(btn.dataset.log);
  const { mod, act } = btn.dataset;
  if (!mod) return;
  busy.add(mod + act);
  renderModules();
  try {
    const r = await window.hub.action(mod, act);
    if (act === 'import-leads') toast(r.note || 'Готово');
    else if (typeof r === 'string') toast(r);
  } catch (err) {
    toast(err.message, true);
  } finally {
    busy.delete(mod + act);
    refresh();
  }
});

// ---------- сценарии ----------
const STEP = { wait: 'ждёт', active: 'выполняется…', ok: 'готово', fail: 'ошибка', skip: 'пропущен', off: 'выключен', cancel: 'не выполнялся' };

function renderScenarios() {
  $('#scenarioList').innerHTML = snap.scenarios.map((s) => {
    const run = s.run;
    const steps = s.steps.map((st, i) => {
      const r = run?.steps[i];
      const off = s.disabled.includes(i);
      return `<li>
        <input type="checkbox" data-sc="${s.id}" data-i="${i}" ${off ? '' : 'checked'} ${run?.running ? 'disabled' : ''}>
        <span class="n">${i + 1}</span>
        <span class="s">${esc(st.title)}${r?.note ? `<span class="nt ${r.status}">${esc(r.note)}</span>` : ''}</span>
        ${r ? `<span class="st ${r.status}">${STEP[r.status]}</span>` : ''}
      </li>`;
    }).join('');
    return `<div class="card">
      <div class="sc-head">
        <div class="t"><h3>${esc(s.title)}</h3><div class="note">${esc(s.about)}</div></div>
        <button class="btn pri" data-run="${s.id}" ${run?.running ? 'disabled' : ''}>${run?.running ? 'Идёт…' : '▶ Запустить'}</button>
      </div>
      <ol class="steps">${steps}</ol>
    </div>`;
  }).join('');
}

$('#scenarioList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-run]');
  if (btn) {
    try { await window.hub.runScenario(btn.dataset.run); } catch (err) { toast(err.message, true); }
  }
});
$('#scenarioList').addEventListener('change', async (e) => {
  const c = e.target;
  if (c.dataset.sc) await window.hub.setStep(c.dataset.sc, Number(c.dataset.i), c.checked);
});

// ---------- настройки ----------
function renderSettings() {
  const s = snap.settings;
  $('#wsDir').textContent = s.workspaceDir;
  $('#dlDir').textContent = s.downloadsDir;
  if (document.activeElement !== $('#port')) $('#port').value = s.outreachPort;
  $('#pathList').innerHTML = snap.modules.filter((m) => m.dir).map((m) => `
    <div class="pathrow"><b>${esc(m.title)}</b><code>${esc(m.dir)}</code>
      <button class="btn" data-pick="${m.id}">Выбрать…</button>
      ${s.paths[m.id] ? `<button class="btn" data-reset="${m.id}">Сбросить</button>` : ''}
    </div>`).join('');
}

async function pick(current, apply) {
  const dir = await window.hub.pickDir(current);
  if (dir) { await window.hub.saveSettings(apply(dir)); toast('Сохранено'); }
}
$('#pickWs').onclick = () => pick(snap.settings.workspaceDir, (d) => ({ workspaceDir: d }));
$('#pickDl').onclick = () => pick(snap.settings.downloadsDir, (d) => ({ downloadsDir: d }));
$('#savePort').onclick = async () => { await window.hub.saveSettings({ outreachPort: Number($('#port').value) || 4747 }); toast('Сохранено'); };
$('#pathList').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const paths = { ...snap.settings.paths };
  if (b.dataset.reset) { delete paths[b.dataset.reset]; await window.hub.saveSettings({ paths }); return; }
  const m = snap.modules.find((x) => x.id === b.dataset.pick);
  await pick(m.dir, (d) => ({ paths: { ...paths, [m.id]: d } }));
});

// ---------- лог ----------
async function openLog(id) {
  logFor = id;
  $('#drawerTitle').textContent = `Лог: ${snap.modules.find((m) => m.id === id)?.title || id}`;
  $('#drawer').classList.add('open');
  await loadLog();
}
async function loadLog() {
  if (!logFor) return;
  const pre = $('#drawerLog');
  const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 20;
  pre.textContent = (await window.hub.log(logFor)) || '(пусто)';
  if (atEnd) pre.scrollTop = pre.scrollHeight;
}
$('#drawerClose').onclick = () => { logFor = null; $('#drawer').classList.remove('open'); };
window.hub.onLog((id) => { if (id === logFor) loadLog(); });

// ---------- обновление ----------
let pending = false;
async function refresh() {
  if (pending) return;
  pending = true;
  try {
    snap = await window.hub.snapshot();
    renderModules();
    renderScenarios();
    renderSettings();
  } catch (err) {
    toast(err.message, true);
  } finally {
    pending = false;
  }
}
window.hub.onChange(refresh);
setInterval(refresh, 4000); // статусы внешних программ (Dolphin Anty, панель рассылки)
setInterval(() => ($('#clock').textContent = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })), 1000);
refresh();
