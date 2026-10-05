'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { config: null, profiles: [], selected: [], run: null, templates: [] };

const STATUS_RU = { new: 'новый', queued: 'в работе', sent: 'отправлено', failed: 'ошибка', skipped: 'пропущен' };
const PHASE_RU = { waiting: 'ждёт', starting: 'запуск', sending: 'рассылка', done: 'готово', error: 'ошибка', blocked: 'ограничение IG', skipped: 'пропуск', stopped: 'остановлен', manual: 'вручную' };

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
function flash(el, text, isErr) { el.textContent = text; el.style.color = isErr ? 'var(--err)' : ''; }

// ---------- вкладки ----------
document.querySelectorAll('#tabs button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${b.dataset.tab}`));
    if (b.dataset.tab === 'artists') loadArtists();
    if (b.dataset.tab === 'templates') loadTemplates();
  };
});

// ---------- состояние ----------
async function loadState() {
  const st = await api('/api/state');
  S.config = st.config; S.profiles = st.profiles; S.selected = st.selected; S.run = st.run;
  renderStats(st.stats); renderProfiles(); renderRun(); fillSettings();
  $('log').innerHTML = ''; st.log.forEach(addLog);
  if (!$('runConc').value) $('runConc').value = S.config.run.concurrency;
  if (!$('runPer').value) $('runPer').value = S.config.run.artistsPerProfile;
}

function renderStats(s) {
  $('stats').innerHTML = `артистов <b>${s.total}</b> · новых <b>${s.new}</b> · отправлено <b>${s.sent}</b> · пропущено <b>${s.skipped}</b> · ошибок <b>${s.failed}</b>`;
}

function addLog(l) {
  const box = $('log');
  const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
  const div = document.createElement('div');
  div.className = `l-${l.level}`;
  div.innerHTML = `<time>${new Date(l.ts).toLocaleTimeString()}</time>${esc(l.text)}`;
  box.appendChild(div);
  while (box.children.length > 600) box.firstChild.remove();
  if (stick) box.scrollTop = box.scrollHeight;
}

const ev = new EventSource('/api/events');
ev.addEventListener('log', (e) => addLog(JSON.parse(e.data)));
ev.addEventListener('run', (e) => { S.run = JSON.parse(e.data); renderRun(); });
ev.addEventListener('stats', (e) => renderStats(JSON.parse(e.data)));

// ---------- запуск ----------
function renderRun() {
  const r = S.run;
  $('btnStart').disabled = !!r?.running;
  $('btnStop').disabled = !r?.running;
  $('runSelInfo').textContent = `выбрано профилей: ${S.selected.length}`;
  if (!r || !r.slots?.length) return;
  $('slots').innerHTML = r.slots.map((s) => {
    const t = Math.max(1, s.total);
    const manual = s.phase === 'manual'
      ? `<div class="manual-list">${s.artists.map((a) => `<div><label><input type="checkbox" class="mchk" data-p="${esc(s.profileId)}" value="${esc(a.username)}" checked> <b>@${esc(a.username)}</b></label><br>${esc(a.opener)}</div>`).join('')}</div>
         <div class="row"><button class="mdone" data-p="${esc(s.profileId)}">Отмеченным отправлено</button></div>` : '';
    return `<div class="slot">
      <div class="head"><span>${esc(s.name)}</span><span class="pill p-${s.phase}">${PHASE_RU[s.phase] || s.phase}</span></div>
      <div class="bar"><i class="s" style="width:${(s.sent / t) * 100}%"></i><i class="k" style="width:${(s.skipped / t) * 100}%"></i><i class="f" style="width:${(s.failed / t) * 100}%"></i></div>
      <div>✅ ${s.sent} · ⏭ ${s.skipped} · ❌ ${s.failed} · ⏳ ${s.pending} из ${s.total}</div>
      <div class="msg">${esc(s.message)}</div>${manual}</div>`;
  }).join('');
  document.querySelectorAll('.mdone').forEach((b) => {
    b.onclick = async () => {
      const p = b.dataset.p;
      const boxes = [...document.querySelectorAll(`.mchk[data-p="${CSS.escape(p)}"]`)];
      await api('/api/run/manual-finish', { profileId: p, sent: boxes.filter((x) => x.checked).map((x) => x.value) });
    };
  });
}

$('btnPlan').onclick = async () => {
  try {
    const plan = await api('/api/run/plan', { profileIds: S.selected, perProfile: +$('runPer').value });
    const total = plan.reduce((n, p) => n + p.take, 0);
    $('plan').innerHTML = `<table class="tbl plan-tbl"><tr><th>#</th><th>Профиль</th><th>Получит артистов</th><th>Сегодня уже</th></tr>${plan.map((p, i) =>
      `<tr><td>${i + 1}</td><td>${esc(p.name)}</td><td>${p.blocked ? '<span class="p-blocked">ограничение сегодня</span>' : p.take}</td><td>${p.sentToday}</td></tr>`).join('')}</table>
      <p class="muted">Всего уйдёт: <b>${total}</b>. Окон одновременно: ${$('runConc').value}.</p>`;
  } catch (e) { $('plan').textContent = e.message; }
};
$('btnStart').onclick = async () => {
  if (!S.selected.length) return alert('Выбери профили на вкладке «Профили»');
  try {
    await api('/api/run/start', { profileIds: S.selected, concurrency: +$('runConc').value, perProfile: +$('runPer').value });
    $('plan').innerHTML = '';
  } catch (e) { alert(e.message); }
};
$('btnStop').onclick = () => api('/api/run/stop', {});

// ---------- артисты ----------
let artTimer;
async function loadArtists() {
  const q = encodeURIComponent($('artQ').value.trim());
  const st = $('artStatus').value;
  const r = await api(`/api/artists?status=${st}&q=${q}`);
  $('artCount').textContent = `показано ${r.items.length} из ${r.total}`;
  $('artAll').checked = false;
  $('artBody').innerHTML = r.items.map((a) => `<tr>
    <td><input type="checkbox" class="achk" value="${esc(a.username)}"></td>
    <td><a href="https://www.instagram.com/${esc(a.username)}/" target="_blank" rel="noopener">@${esc(a.username)}</a><div class="sub">${esc(a.name)}</div></td>
    <td class="op" data-u="${esc(a.username)}">${esc(a.opener) || '<span class="muted">— нет опенера —</span>'}</td>
    <td><span class="pill p-${a.status}">${STATUS_RU[a.status] || a.status}</span>${a.error ? `<div class="sub">${esc(a.error)}</div>` : ''}</td>
    <td class="sub">${esc(a.profileName)}${a.sentAt ? `<br>${new Date(a.sentAt).toLocaleString()}` : ''}</td></tr>`).join('');
  document.querySelectorAll('td.op').forEach((td) => {
    td.onclick = () => {
      if (td.querySelector('textarea')) return;
      const u = td.dataset.u;
      const cur = r.items.find((x) => x.username === u)?.opener || '';
      td.innerHTML = '';
      const ta = document.createElement('textarea');
      ta.value = cur;
      td.appendChild(ta);
      ta.focus();
      ta.onblur = async () => {
        if (ta.value !== cur) await api('/api/artists/update', { username: u, patch: { opener: ta.value } });
        loadArtists();
      };
    };
  });
}
const selectedArtists = () => [...document.querySelectorAll('.achk:checked')].map((x) => x.value);
$('artQ').oninput = () => { clearTimeout(artTimer); artTimer = setTimeout(loadArtists, 250); };
$('artStatus').onchange = loadArtists;
$('artAll').onchange = () => document.querySelectorAll('.achk').forEach((c) => { c.checked = $('artAll').checked; });
$('btnArtReset').onclick = async () => { await api('/api/artists/reset', { usernames: selectedArtists() }); loadArtists(); };
$('btnArtDelete').onclick = async () => {
  const u = selectedArtists();
  if (!u.length || !confirm(`Удалить ${u.length} артист(ов)?`)) return;
  await api('/api/artists/delete', { usernames: u }); loadArtists();
};
$('btnRegen').onclick = async () => {
  if (!confirm('Пересобрать опенеры для всех новых артистов из шаблонов? Ручные/из CSV не трогаются.')) return;
  const r = await api('/api/artists/regenerate', {}); alert(`Пересобрано: ${r.regenerated}`); loadArtists();
};
$('importFile').onchange = async () => {
  const f = $('importFile').files[0];
  if (!f) return;
  const buf = await f.arrayBuffer();
  const b = new Uint8Array(buf);
  const enc = b[0] === 0xff && b[1] === 0xfe ? 'utf-16le' : b[0] === 0xfe && b[1] === 0xff ? 'utf-16be' : 'utf-8';
  $('importText').value = new TextDecoder(enc).decode(buf).replace(/^﻿/, '');
};
$('btnImport').onclick = async () => {
  try {
    const r = await api('/api/artists/import', { text: $('importText').value });
    flash($('importResult'), `добавлено ${r.added}, дублей ${r.duplicates.length}, не распознано ${r.invalidCount}${r.invalid.length ? ': ' + r.invalid.slice(0, 5).join('; ') : ''}`);
    if (r.added) $('importText').value = '';
    loadArtists(); loadState();
  } catch (e) { flash($('importResult'), e.message, true); }
};

// ---------- шаблоны ----------
async function loadTemplates() { S.templates = await api('/api/templates'); renderTemplates(); }
function renderTemplates() {
  $('tplList').innerHTML = S.templates.map((t, i) => `<div class="tpl" data-i="${i}">
    <div class="row"><input class="name" value="${esc(t.name)}"> вес <input class="weight" type="number" min="1" value="${t.weight}">
      <label><input type="checkbox" class="enabled" ${t.enabled ? 'checked' : ''}> вкл</label>
      <button class="prev">Превью</button><button class="del danger">✕</button></div>
    <textarea class="text" rows="3">${esc(t.text)}</textarea><div class="preview"></div></div>`).join('');
  document.querySelectorAll('.tpl').forEach((el) => {
    const i = +el.dataset.i;
    const sync = () => Object.assign(S.templates[i], {
      name: el.querySelector('.name').value, weight: +el.querySelector('.weight').value || 1,
      enabled: el.querySelector('.enabled').checked, text: el.querySelector('.text').value,
    });
    el.querySelectorAll('input,textarea').forEach((x) => { x.oninput = sync; x.onchange = sync; });
    el.querySelector('.del').onclick = () => { S.templates.splice(i, 1); renderTemplates(); };
    el.querySelector('.prev').onclick = async () => {
      sync();
      const out = await api('/api/templates/preview', { text: S.templates[i].text });
      el.querySelector('.preview').innerHTML = out.map((o) => `<div><b>@${esc(o.username)}</b>: ${esc(o.text)}${o.missing.length ? ` <span style="color:var(--warn)">(нет: ${esc(o.missing.join(', '))})</span>` : ''}</div>`).join('');
    };
  });
}
$('btnTplAdd').onclick = () => { S.templates.push({ name: `Шаблон ${S.templates.length + 1}`, text: '', weight: 1, enabled: true }); renderTemplates(); };
$('btnTplSave').onclick = async () => {
  try { S.templates = await api('/api/templates', { templates: S.templates }); renderTemplates(); flash($('tplResult'), 'сохранено'); }
  catch (e) { flash($('tplResult'), e.message, true); }
};

// ---------- профили ----------
function profMatches(p) {
  const f = $('profFilter').value.trim().toLowerCase();
  return !f || p.name.toLowerCase().includes(f) || (p.tags || []).some((t) => String(t).toLowerCase().includes(f)) || String(p.id) === f;
}
function renderProfiles() {
  const list = S.profiles.filter(profMatches);
  $('profList').innerHTML = list.length ? list.map((p) => {
    const order = S.selected.indexOf(String(p.id));
    return `<div class="prof ${order >= 0 ? 'sel' : ''}" data-id="${esc(p.id)}">
      <span class="order">${order >= 0 ? order + 1 : ''}</span>
      <div><div>${esc(p.name)}</div><div class="tags">${esc((p.tags || []).join(', '))} · id ${esc(p.id)}</div></div>
      <div class="meta">${p.sentToday}/${S.config.run.dailyLimitPerProfile}${p.blockedToday ? `<br><a href="#" class="unblock" data-id="${esc(p.id)}" style="color:var(--err)">ограничение — снять</a>` : ''}</div></div>`;
  }).join('') : '<p class="muted">Нет профилей. Укажи API-токен в «Настройках» и нажми «Загрузить из Dolphin» (или добавь ID вручную).</p>';
  document.querySelectorAll('.prof').forEach((el) => {
    el.onclick = (e) => {
      if (e.target.classList.contains('unblock')) return;
      const id = el.dataset.id;
      const i = S.selected.indexOf(id);
      if (i >= 0) S.selected.splice(i, 1); else S.selected.push(id);
      saveSelection();
    };
  });
  document.querySelectorAll('.unblock').forEach((a) => {
    a.onclick = async (e) => { e.preventDefault(); await api('/api/profiles/unblock', { id: a.dataset.id }); loadState(); };
  });
  $('runSelInfo').textContent = `выбрано профилей: ${S.selected.length}`;
}
async function saveSelection() { renderProfiles(); await api('/api/profiles/select', { ids: S.selected }); }
$('profFilter').oninput = renderProfiles;
$('btnProfSelFiltered').onclick = () => {
  for (const p of S.profiles.filter(profMatches)) if (!S.selected.includes(String(p.id))) S.selected.push(String(p.id));
  saveSelection();
};
$('btnProfSelNone').onclick = () => { S.selected = []; saveSelection(); };
$('btnProfRefresh').onclick = async () => {
  flash($('profResult'), 'загружаю…');
  try { const r = await api('/api/profiles/refresh', {}); flash($('profResult'), `профилей: ${r.count}`); loadState(); }
  catch (e) { flash($('profResult'), e.message, true); }
};
$('btnProfManual').onclick = async () => {
  try { await api('/api/profiles/manual', { id: $('manId').value, name: $('manName').value }); $('manId').value = ''; $('manName').value = ''; loadState(); }
  catch (e) { alert(e.message); }
};

// ---------- настройки ----------
function fillSettings() {
  const c = S.config;
  $('cfgTokenHint').textContent = c.dolphin.tokenSet ? `сохранён (${c.dolphin.tokenHint}), пусто — не менять` : 'не задан';
  $('cfgLocal').value = c.dolphin.localApi;
  $('cfgHeadless').checked = c.dolphin.headless;
  $('cfgConc').value = c.run.concurrency; $('cfgPer').value = c.run.artistsPerProfile; $('cfgDaily').value = c.run.dailyLimitPerProfile;
  $('cfgStagger').value = c.run.startStaggerSec; $('cfgTimeout').value = c.run.profileTimeoutMin; $('cfgClose').checked = c.run.closeWhenDone;
  $('cfgMode').value = c.extension.mode; $('cfgExtName').value = c.extension.name; $('cfgExtId').value = c.extension.id; $('cfgOpenUrl').value = c.extension.openUrl;
  $('cfgDMin').value = c.extension.delays?.min ?? ''; $('cfgDMax').value = c.extension.delays?.max ?? '';
  const m = c.extension.methods;
  $('cfgMethods').value = m ? Object.keys(m).filter((k) => m[k]).join(',') : '';
}
$('btnCfgSave').onclick = async () => {
  const dmin = $('cfgDMin').value, dmax = $('cfgDMax').value;
  const ms = $('cfgMethods').value;
  const body = {
    dolphin: { token: $('cfgToken').value.trim(), localApi: $('cfgLocal').value.trim(), headless: $('cfgHeadless').checked },
    run: {
      concurrency: +$('cfgConc').value, artistsPerProfile: +$('cfgPer').value, dailyLimitPerProfile: +$('cfgDaily').value,
      startStaggerSec: +$('cfgStagger').value, profileTimeoutMin: +$('cfgTimeout').value, closeWhenDone: $('cfgClose').checked,
    },
    extension: {
      mode: $('cfgMode').value, name: $('cfgExtName').value.trim(), id: $('cfgExtId').value.trim(), openUrl: $('cfgOpenUrl').value.trim(),
      delays: dmin && dmax ? { min: +dmin, max: +dmax } : null,
      methods: ms ? { dm: ms.includes('dm'), story: ms.includes('story'), post: ms.includes('post') } : null,
    },
  };
  try {
    S.config = await api('/api/config', body);
    $('cfgToken').value = ''; fillSettings(); flash($('cfgResult'), 'сохранено');
    $('runConc').value = S.config.run.concurrency; $('runPer').value = S.config.run.artistsPerProfile;
  } catch (e) { flash($('cfgResult'), e.message, true); }
};

loadState().catch((e) => alert(`Сервер недоступен: ${e.message}`));
