const $ = (id) => document.getElementById(id);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmt1 = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const COLORS = ['#8f88ff', '#ff8fa3', '#5fd4b0', '#ffc35c', '#6fb7ff', '#d58cff', '#ff9d5c', '#9ee06a', '#ff6bd0'];

const DEFAULT_LABELS = { 1: 'loop', 2: 'kick', 3: 'snare', 4: 'hi-hat', 5: '808', 6: 'melody', 7: 'pad', 8: 'perc', 9: 'fx', 0: 'full beat' };
function loadLabels() {
  try { return { ...DEFAULT_LABELS, ...JSON.parse(localStorage.getItem('labels') || '{}') }; } catch (e) { return { ...DEFAULT_LABELS }; }
}
let labels = loadLabels();
function saveLabels() { try { localStorage.setItem('labels', JSON.stringify(labels)); } catch (e) {} }

// ---------- tabs ----------
function showView(name) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'edit') { drawStrip(); engine.requestDraw(); }
}
document.querySelectorAll('.tab').forEach(b => b.onclick = () => !b.disabled && showView(b.dataset.view));

// ---------- modal ----------
function modal(title, body, progress) {
  $('modal').classList.remove('hidden');
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = '';
  const p = document.createElement('div'); p.className = 'hint'; p.textContent = body || '';
  $('modalBody').append(p);
  if (progress != null) {
    const bar = document.createElement('div'); bar.className = 'bar';
    bar.innerHTML = '<div></div>';
    bar.firstChild.style.width = `${Math.round(progress * 100)}%`;
    $('modalBody').append(bar);
  }
}
function closeModal() { $('modal').classList.add('hidden'); }
function alertModal(title, body) {
  modal(title, body);
  const b = document.createElement('button'); b.textContent = 'OK'; b.className = 'primary'; b.onclick = closeModal;
  $('modalBody').append(b);
}

// =====================================================================
// 1. RECORD
// =====================================================================
let sources = [], selectedId = null, liveStream = null;
let recorder = null, recStreamId = null, recDir = null, recT0 = 0, recTimer = 0, recWrite = Promise.resolve();
let markers = [];
let platform = 'win32';

const isFL = (name) => /FL Studio|FL64|\bFL\b.*\.flp|Image-Line/i.test(name);

async function refreshSources() {
  sources = await api.listSources();
  const fl = sources.find(s => s.kind === 'window' && isFL(s.name));
  if (!selectedId || !sources.some(s => s.id === selectedId)) {
    if (fl) selectSource(fl.id);
  }
  $('srcHint').innerHTML = !sources.length
    ? 'Не вижу ни одного окна. Проверь, что приложению разрешена запись экрана, и нажми «Обновить».'
    : fl
    ?'Нашёл окно <b>FL Studio</b> и выбрал его. Можно выбрать другое окно или весь экран.'
    : 'FL Studio не найден. Открой проект во FL и нажми «Обновить», или выбери окно/экран вручную.';
  renderSources();
}
function renderSources() {
  const box = $('sources'); box.innerHTML = '';
  for (const s of sources) {
    const b = document.createElement('button');
    b.className = 'src' + (s.id === selectedId ? ' sel' : '');
    const img = document.createElement('img'); if (s.thumb) img.src = s.thumb; img.alt = '';
    const nm = document.createElement('div'); nm.className = 'nm' + (isFL(s.name) ? ' fl' : '');
    nm.textContent = (s.kind === 'screen' ? '🖥 ' : '') + s.name;
    b.append(img, nm);
    b.onclick = () => selectSource(s.id);
    box.append(b);
  }
}
async function selectSource(id) {
  if (recorder) return;
  selectedId = id;
  renderSources();
  await api.selectSource(id);
  if (liveStream) liveStream.getTracks().forEach(t => t.stop());
  try {
    liveStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
  } catch (e) {
    // System audio can be unavailable (older macOS, no permission): fall back to picture only.
    try {
      liveStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
    } catch (e2) {
      liveStream = null;
      $('previewEmpty').textContent = 'Не удалось захватить окно: ' + e2.message +
        (platform === 'darwin' ? '. Разреши запись экрана: Системные настройки → Конфиденциальность и безопасность → Запись экрана.' : '');
    }
  }
  $('livePreview').srcObject = liveStream;
  if (liveStream) $('livePreview').play().catch(() => {});
  $('previewEmpty').style.display = liveStream ? 'none' : 'grid';
  $('recBtn').disabled = !liveStream;
  const hasAudio = liveStream && liveStream.getAudioTracks().length > 0;
  $('audioNote').textContent = hasAudio
    ? '🔊 Звук компьютера пишется'
    : platform === 'darwin' ? '🔇 Звук не захвачен: нужен macOS 13+ и разрешение на запись экрана и звука' : '🔇 Звук не захвачен';
}
$('refreshSources').onclick = refreshSources;

function renderLabels() {
  const box = $('labels'); box.innerHTML = '';
  for (const k of [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]) {
    const row = document.createElement('div'); row.className = 'label-row' + (k === 0 ? ' final' : '');
    const kbd = document.createElement('span'); kbd.className = 'kbd'; kbd.textContent = `Ctrl+Shift+${k}`;
    const inp = document.createElement('input'); inp.type = 'text'; inp.value = labels[k];
    inp.oninput = () => { labels[k] = inp.value; saveLabels(); };
    if (k === 0) inp.title = 'Финальный полный бит';
    row.append(kbd, inp);
    box.append(row);
  }
  const help = document.createElement('p'); help.className = 'hint';
  help.innerHTML = '<b>Ctrl+Shift+Z</b> убирает последнюю метку, <b>Ctrl+Shift+R</b> останавливает запись.';
  box.append(help);
}

function renderMarkers() {
  const box = $('markerList'); box.innerHTML = '';
  for (const m of markers) {
    const c = document.createElement('span'); c.className = 'chip';
    c.innerHTML = `${fmt(m.t)} · <b></b>`; c.querySelector('b').textContent = m.label;
    box.append(c);
  }
}

async function startRecording() {
  recDir = await api.createProject();
  recStreamId = await api.openStream(recDir + (recDir.includes('\\') ? '\\' : '/') + 'recording.webm');
  const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  recorder = new MediaRecorder(liveStream, { mimeType: types.find(t => MediaRecorder.isTypeSupported(t)), videoBitsPerSecond: 16e6 });
  recorder.ondataavailable = (e) => {
    if (!e.data.size) return;
    const d = e.data;
    recWrite = recWrite.then(() => d.arrayBuffer()).then(buf => api.writeStream(recStreamId, buf));
  };
  markers = []; renderMarkers();
  recorder.start(1000);
  recT0 = performance.now();
  await api.enableHotkeys();
  await api.showHud();
  $('recBtn').classList.add('on');
  $('recBtn').innerHTML = '<span class="dot"></span> Остановить';
  recTimer = setInterval(tickRec, 250);
}
const recNow = () => (performance.now() - recT0) / 1000;
function tickRec() {
  $('recTime').textContent = fmt(recNow());
  const cur = markers[markers.length - 1];
  api.updateHud({ time: recNow(), current: cur && cur.label, count: markers.length });
}
async function stopRecording() {
  if (!recorder) return;
  const duration = recNow();
  clearInterval(recTimer);
  await new Promise(r => { recorder.onstop = r; recorder.stop(); });
  recorder = null;
  await recWrite;
  await api.closeStream(recStreamId);
  await api.disableHotkeys();
  await api.hideHud();
  $('recBtn').classList.remove('on');
  $('recBtn').innerHTML = '<span class="dot"></span> Начать запись';

  modal('Готовлю запись', 'Перекодирую видео, чтобы по нему можно было быстро перематывать…', 0);
  const off = api.onFinalizeProgress(f => modal('Готовлю запись', 'Перекодирую видео, чтобы по нему можно было быстро перематывать…', f));
  try {
    const file = await api.finalizeRecording(recDir, duration);
    off();
    const p = buildProject(markers, duration);
    p.recording = file;
    await api.saveProject(recDir, p);
    closeModal();
    await openProject(recDir);
  } catch (e) {
    off();
    alertModal('Не получилось обработать запись', String(e.message || e).slice(-600));
  }
}
$('recBtn').onclick = () => recorder ? stopRecording() : startRecording();

api.onHotkey(({ key }) => {
  if (!recorder) return;
  if (key === 'stop') return stopRecording();
  if (key === 'undo') { markers.pop(); renderMarkers(); tickRec(); return; }
  markers.push({ t: +recNow().toFixed(2), key, label: labels[key] || `layer ${key}` });
  renderMarkers(); tickRec();
});

// Markers → tutorial: each layer marker becomes a step that starts just after the key press;
// the "full beat" marker (key 0) becomes the outro.
function buildProject(marks, duration) {
  const p = Engine.defaults();
  p.title = `Бит ${new Date().toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}`;
  p.duration = +duration.toFixed(2);
  p.markers = marks;
  const sorted = [...marks].sort((a, b) => a.t - b.t);
  let n = 0, hasFinal = false;
  sorted.forEach((m, i) => {
    const end = i + 1 < sorted.length ? sorted[i + 1].t : duration;
    const lead = 0.3;
    const len = Math.max(0.5, end - m.t - lead);
    if (m.key === 0) {
      hasFinal = true;
      p.final.title = m.label || 'full beat';
      p.final.offset = +clamp(m.t + lead, 0, Math.max(0, duration - 1)).toFixed(2);
      p.final.dur = +clamp(len, 2, 15).toFixed(2);
    } else {
      n++;
      p.steps.push({
        id: Engine.uid(), label: `step ${n}:`, name: m.label, crop: null,
        offset: +clamp(m.t + lead, 0, Math.max(0, duration - 1)).toFixed(2), dur: +clamp(len, 1, 6).toFixed(2),
        note: n === 1 ? '(full beat at the end)' : '', noteFrom: 1.5, noteTo: 3.5,
      });
    }
  });
  if (!hasFinal) { p.final.dur = +Math.min(12, duration).toFixed(2); p.final.offset = +Math.max(0, duration - p.final.dur).toFixed(2); }
  return p;
}

async function renderRecent() {
  const list = await api.listProjects();
  const box = $('recent'); box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<p class="hint">Пока пусто. Запиши первый бит.</p>'; return; }
  for (const pr of list) {
    const b = document.createElement('button');
    const a = document.createElement('span'); a.textContent = pr.title;
    const t = document.createElement('span'); t.className = 'muted'; t.textContent = new Date(pr.mtime).toLocaleString('ru-RU');
    b.append(a, t);
    b.onclick = () => openProject(pr.dir);
    box.append(b);
  }
}

// =====================================================================
// 2. EDIT
// =====================================================================
const engine = Engine.create($('cv'));
let P = null, projDir = null, saveTimer = 0;

async function openProject(dir) {
  projDir = dir;
  P = Engine.migrate(await api.loadProject(dir));
  await Promise.all(P.fonts.map(loadFont));
  sel = null; engine.select(null); renderInspector();
  engine.setRecording(await api.fileUrl(P.recording));
  engine.setProject(P);
  engine.seek(0);
  $('projTitle').textContent = P.title;
  document.querySelector('.tab[data-view=edit]').disabled = false;
  renderPanel();
  showView('edit');
  renderRecent();
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api.saveProject(projDir, P), 400);
}
function changed(structural = false) {
  save();
  if (structural) renderPanel();
  engine.setProject(P);
  drawStrip();
}
engine.on('change', () => { save(); });

// transport
$('play').onclick = () => engine.playing ? engine.stop() : engine.play();
$('seek').oninput = (e) => { if (engine.playing) engine.stop(); engine.seek(+e.target.value); };
engine.on('time', (t, total, seg) => {
  $('seek').max = total; $('seek').value = t;
  $('time').textContent = `${fmt1(t)} / ${fmt(total)}`;
  $('play').textContent = engine.playing ? '❚❚' : '▶';
  highlightCard(seg);
  drawStrip();
});
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || !$('view-edit').classList.contains('active')) return;
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || engine.exporting) return;
  e.preventDefault(); engine.playing ? engine.stop() : engine.play();
});

// ---------- panel ----------
const panel = $('panel');
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) n[k] = v; else if (k === 'class') n.className = v; else n.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) n.append(k);
  return n;
}
const txt = (o, k, ph = '') => el('input', { type: 'text', value: o[k] ?? '', placeholder: ph, oninput: (e) => { o[k] = e.target.value; changed(); } });
const num = (o, k, step = 0.1, min = 0, max) => el('input', {
  type: 'number', value: o[k], step, min, ...(max != null ? { max } : {}),
  oninput: (e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) { o[k] = max != null ? clamp(v, min, max) : Math.max(min, v); changed(); } },
});
const check = (o, k, label) => el('label', {}, el('input', { type: 'checkbox', ...(o[k] ? { checked: '' } : {}), onchange: (e) => { o[k] = e.target.checked; changed(); } }), ' ' + label);
const row = (label, ...kids) => el('div', { class: 'row' }, label ? el('label', {}, label) : null, ...kids);
const hint = (s) => el('span', { class: 'hint' }, s);
function move(arr, i, d) { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; changed(true); }
function jumpTo(type, i) {
  const s = engine.timeline().segs.find(s => s.type === type && (type !== 'step' || s.i === i));
  if (s) { if (engine.playing) engine.stop(); engine.seek(s.start + 0.01); }
}
function pickImages(multiple) {
  return new Promise(res => {
    const inp = el('input', { type: 'file', accept: 'image/*' });
    inp.multiple = multiple;
    inp.onchange = async () => {
      const out = [];
      for (const f of inp.files) out.push(await api.importFile(projDir, api.pathForFile(f)));
      res(out);
    };
    inp.click();
  });
}

function renderPanel() {
  panel.innerHTML = '';
  const dur = P.duration;

  panel.append(el('h2', {}, 'Проект'), row(null, txt(P, 'title')),
    row(null, el('button', { onclick: () => api.revealProject(projDir) }, 'Открыть папку проекта')));

  // intro
  panel.append(el('h2', {}, 'Интро'));
  const ic = el('div', { class: 'card', 'data-seg': 'intro' });
  ic.append(row(null, check(P.intro, 'enabled', 'показывать интро')),
    row('Длит., с', num(P.intro, 'dur', 0.1, 0.5)),
    row(null, check(P.intro, 'audioFromFinal', 'под интро играет полный бит')));
  P.intro.items.forEach((it, i) => {
    const r = el('div', { class: 'row' },
      it.kind === 'text' ? txt(it, 'text') : el('button', {
        onclick: async () => { const [f] = await pickImages(false); if (f) { it.file = f; changed(true); } },
      }, it.file ? '🖼 ' + it.file.split(/[\\/]/).pop().replace(/^\d+-/, '').slice(0, 18) : 'Загрузить фото'),
      hint('с'), num(it, 'at', 0.05),
      it.kind === 'text' ? check(it, 'bold', 'B') : null,
      el('button', { class: 'icon', onclick: () => move(P.intro.items, i, -1) }, '↑'),
      el('button', { class: 'icon danger', onclick: () => { P.intro.items.splice(i, 1); changed(true); } }, '✕'));
    ic.append(r);
  });
  ic.append(row(null,
    el('button', { onclick: () => { P.intro.items.push({ kind: 'text', text: 'текст', x: 300, y: 1000, size: 240, sx: 0.35, bold: false, at: 0 }); changed(true); } }, '+ текст'),
    el('button', { onclick: () => { P.intro.items.push({ kind: 'image', file: null, x: 400, y: 900, w: 289, h: 289, at: 0 }); changed(true); } }, '+ фото')));
  panel.append(ic);

  // steps
  panel.append(el('h2', {}, 'Шаги'));
  if (!P.steps.length) panel.append(el('p', { class: 'hint' }, 'Меток слоёв не было. Добавь шаг вручную и выбери момент записи на ленте внизу.'));
  P.steps.forEach((st, i) => {
    const c = el('div', { class: 'card', 'data-seg': `step-${i}` });
    c.append(
      el('div', { class: 'head' },
        el('span', {}, el('span', { class: 'swatch', style: `background:${COLORS[i % COLORS.length]}` }), `Шаг ${i + 1}`),
        el('span', {},
          el('button', { class: 'icon', title: 'Показать', onclick: () => jumpTo('step', i) }, '▶'), ' ',
          el('button', { class: 'icon', onclick: () => move(P.steps, i, -1) }, '↑'), ' ',
          el('button', { class: 'icon', onclick: () => move(P.steps, i, 1) }, '↓'), ' ',
          el('button', { class: 'icon danger', onclick: () => { P.steps.splice(i, 1); renumber(); changed(true); } }, '✕'))),
      row(null, txt(st, 'label'), txt(st, 'name')),
      row('Запись', hint('с'), num(st, 'offset', 0.1, 0, dur), hint('длит.'), num(st, 'dur', 0.1, 0.3),
        el('button', { onclick: () => openCrop(st) }, st.crop ? '✂ Кадр*' : '✂ Кадр')),
      row('Подпись', txt(st, 'note', '(full beat at the end)')),
    );
    if (st.note) c.append(row('Показ', hint('с'), num(st, 'noteFrom', 0.1), hint('до'), num(st, 'noteTo', 0.1)));
    panel.append(c);
  });
  panel.append(row(null, el('button', {
    onclick: () => {
      const n = P.steps.length + 1;
      P.steps.push({ id: Engine.uid(), label: `step ${n}:`, name: 'layer', offset: 0, dur: 4, crop: null, note: '', noteFrom: 1.5, noteTo: 3.5 });
      changed(true);
    },
  }, '+ шаг'), el('button', { onclick: () => { renumber(); changed(true); } }, 'Перенумеровать')));

  // final
  const f = P.final;
  panel.append(el('h2', {}, 'Финал'));
  const fc = el('div', { class: 'card', 'data-seg': 'final' });
  fc.append(
    el('div', { class: 'head' }, el('span', {}, el('span', { class: 'swatch', style: 'background:#ececf4' }), 'Полный бит'),
      el('button', { class: 'icon', onclick: () => jumpTo('final') }, '▶')),
    row(null, txt(f, 'title')),
    row('Запись', hint('с'), num(f, 'offset', 0.1, 0, dur), hint('длит.'), num(f, 'dur', 0.1, 0.5),
      el('button', { onclick: () => openCrop(f) }, f.crop ? '✂ Кадр*' : '✂ Кадр')),
    row('Смена', hint('BPM'), num(f, 'bpm', 1, 40), hint('долей'), num(f, 'beatsPer', 0.5, 0.25)),
    row(null, check(f, 'pop', 'эффект появления обложек')),
  );
  const thumbs = el('div', { class: 'thumbs' });
  f.images.forEach((file, i) => {
    const img = el('img', { alt: '' });
    api.fileUrl(file).then(u => img.src = u);
    thumbs.append(el('div', { class: 'thumb' }, img, el('button', { onclick: () => { f.images.splice(i, 1); changed(true); } }, '✕')));
  });
  fc.append(thumbs, row(null, el('button', { onclick: async () => { f.images.push(...await pickImages(true)); changed(true); } }, '+ обложки')));
  panel.append(fc);

  // style
  // free overlays
  panel.append(el('h2', {}, 'Свои надписи и картинки'),
    el('p', { class: 'hint' }, 'Ник, «link in bio», логотип… Поверх любой части видео. Клик по элементу открывает его настройки справа.'));
  P.overlays.forEach((o, i) => {
    const name = o.kind === 'text' ? (o.text || '—') : (o.file ? o.file.split(/[\\/]/).pop().replace(/^\d+-/, '') : 'картинка');
    panel.append(el('div', { class: 'ov' + (sel && sel.ref === o ? ' sel' : '') },
      el('span', {}, o.kind === 'text' ? 'T' : '🖼'),
      el('span', { class: 'nm' }, name),
      el('span', { class: 'hint' }, whereLabel(o.where)),
      el('button', { class: 'icon', onclick: () => selectOverlay(o) }, '✎'),
      el('button', { class: 'icon danger', onclick: () => { P.overlays.splice(i, 1); if (sel && sel.ref === o) { sel = null; engine.select(null); renderInspector(); } changed(true); } }, '✕')));
  });
  panel.append(row(null,
    el('button', { onclick: () => { const o = { id: Engine.uid(), kind: 'text', text: '@yourname', where: 'all', from: 0, to: null, x: 540, y: 1760, size: 110, sx: 0.5, align: 'center', anim: 'none' }; P.overlays.push(o); changed(true); selectOverlay(o); } }, '+ надпись'),
    el('button', { onclick: async () => { const [f] = await pickImages(false); if (!f) return; const o = { id: Engine.uid(), kind: 'image', file: f, where: 'all', from: 0, to: null, x: 760, y: 1560, w: 260, h: 260, anim: 'none' }; P.overlays.push(o); changed(true); selectOverlay(o); } }, '+ картинка')));

  // visuals
  const bs = P.bandStyle;
  panel.append(el('h2', {}, 'Визуал'));
  const fontSel = fontSelect(P, 'font', false);
  panel.append(
    row('Шрифт', fontSel),
    row(null, el('button', { onclick: addFont }, '+ свой шрифт (.ttf / .otf)')),
    row('Цвета', el('input', { type: 'color', value: P.ink, oninput: (e) => { P.ink = e.target.value; changed(); } }), hint('текст'),
      el('input', { type: 'color', value: P.bg, oninput: (e) => { P.bg = e.target.value; changed(); } }), hint('фон')),
    row('Фон', el('button', { onclick: async () => { const [f] = await pickImages(false); if (f) { P.bgImage = f; changed(true); } } }, P.bgImage ? '🖼 заменить' : 'картинка на фон'),
      P.bgImage ? el('button', { class: 'danger', onclick: () => { P.bgImage = null; changed(true); } }, 'убрать') : null),
    el('div', { class: 'hint' }, 'Полоса с записью FL'),
    row('Место', hint('Y'), num(P.band, 'y', 5, 0), hint('высота'), num(P.band, 'h', 5, 100)),
    row('Форма', hint('отступ'), num(bs, 'margin', 2, 0, 400), hint('скругл.'), num(bs, 'radius', 2, 0)),
    row('Рамка', num(bs, 'border', 1, 0), el('input', { type: 'color', value: bs.borderColor, oninput: (e) => { bs.borderColor = e.target.value; changed(); } })),
    row('Яркость', num(bs, 'brightness', 0.05, 0, 3), hint('контраст'), num(bs, 'contrast', 0.05, 0, 3)),
    row('Насыщ.', num(bs, 'saturate', 0.05, 0, 3)),
    el('div', { class: 'hint' }, 'Звук'),
    row('Громкость', num(P, 'clipVol', 0.1, 0)),
    row(null, el('button', {
      onclick: () => {
        const d = Engine.defaults();
        P.layout = d.layout; P.band = d.band; P.bandStyle = d.bandStyle;
        P.intro.items.forEach((it, i) => { const di = d.intro.items[i]; if (di && di.kind === it.kind) Object.assign(it, { x: di.x, y: di.y, size: di.size, sx: di.sx, w: di.w, h: di.h }); });
        changed(true);
      },
    }, 'Сбросить раскладку')),
  );
}
const whereLabel = (w) => {
  if (!w || w === 'all') return 'везде';
  if (w === 'intro') return 'интро';
  if (w === 'steps') return 'все шаги';
  if (w === 'final') return 'финал';
  const i = P.steps.findIndex(s => `step:${s.id}` === w);
  return i >= 0 ? `шаг ${i + 1}` : 'шаг удалён';
};
function whereSelect(o) {
  const opts = [['all', 'Везде'], ['intro', 'Интро'], ['steps', 'Все шаги'], ...P.steps.map((s, i) => [`step:${s.id}`, `Шаг ${i + 1}: ${s.name}`]), ['final', 'Финал']];
  const s = el('select', { onchange: (e) => { o.where = e.target.value; changed(true); } });
  for (const [v, l] of opts) { const op = el('option', { value: v }, l); if ((o.where || 'all') === v) op.selected = true; s.append(op); }
  return s;
}
function selectOverlay(o) {
  sel = { ref: o, kind: o.kind, role: o.kind === 'text' ? 'Своя надпись' : 'Своя картинка', owner: { obj: o, key: o.kind === 'text' ? 'text' : 'file' } };
  engine.select(o);
  const seg = engine.timeline().segs.find(sg => {
    const w = o.where || 'all';
    return w === 'all' || w === sg.type || (w === 'steps' && sg.type === 'step') || (sg.type === 'step' && w === `step:${P.steps[sg.i].id}`);
  });
  if (seg) { if (engine.playing) engine.stop(); engine.seek(seg.start + Math.max(0.01, (o.from || 0) + 0.5)); }
  renderInspector(); renderPanel();
}

// ---------- fonts ----------
const SYSTEM_FONTS = ['Arial', 'Arial Narrow', 'Impact', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Georgia', 'Times New Roman', 'Courier New', 'Comic Sans MS'];
async function loadFont(f) {
  try {
    const face = new FontFace(f.family, `url("${await api.fileUrl(f.file)}")`);
    await face.load();
    document.fonts.add(face);
    engine.requestDraw();
  } catch (e) { console.warn('font', f.family, e); }
}
async function addFont() {
  const inp = el('input', { type: 'file', accept: '.ttf,.otf,.woff,.woff2' });
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    const file = await api.importFile(projDir, api.pathForFile(f));
    const fam = f.name.replace(/\.(ttf|otf|woff2?)$/i, '');
    const entry = { family: fam, file };
    await loadFont(entry);
    P.fonts.push(entry);
    P.font = fam;
    changed(true); renderInspector();
  };
  inp.click();
}
// withDefault: element-level picker where "" means "use the project font"
function fontSelect(o, key, withDefault = true) {
  const s = el('select', { onchange: (e) => { o[key] = e.target.value || null; changed(true); } });
  const all = [...P.fonts.map(f => f.family), ...SYSTEM_FONTS];
  if (withDefault) s.append(el('option', { value: '' }, `По умолчанию (${P.font})`));
  for (const f of all) {
    const op = el('option', { value: f, style: `font-family:"${f}"` }, f);
    if (o[key] === f) op.selected = true;
    s.append(op);
  }
  return s;
}

// ---------- inspector ----------
let sel = null;
const ANIMS = [['none', 'Нет (резко, как в оригинале)'], ['pop', 'Pop с отскоком'], ['fade', 'Плавное появление'], ['slide', 'Выезд снизу'], ['zoom', 'Наезд'], ['type', 'Печатная машинка']];
engine.on('select', (s) => { sel = s; renderInspector(); });
engine.on('change', () => { if (sel) renderInspector(); });
function color(o, key, fallback) {
  return el('input', { type: 'color', value: o[key] || fallback, oninput: (e) => { o[key] = e.target.value; changed(); } });
}
function renderInspector() {
  const box = $('inspector'); box.innerHTML = '';
  box.append(el('h2', {}, 'Выбранный элемент'));
  if (!sel || !P) {
    box.append(el('p', { class: 'hint' }, 'Кликни по любому тексту или картинке на превью. Здесь появятся шрифт, цвет, обводка, тень, позиция и анимация.'));
    return;
  }
  const o = sel.ref, isOverlay = P.overlays.includes(o);
  box.append(el('div', { class: 'role' }, sel.role || ''));
  if (sel.kind === 'text') {
    if (sel.owner) box.append(row('Текст', el('input', {
      type: 'text', value: sel.owner.obj[sel.owner.key] ?? '',
      oninput: (e) => { sel.owner.obj[sel.owner.key] = e.target.value; changed(isOverlay); },
    })));
    box.append(
      row('Шрифт', fontSelect(o, 'font')),
      row('Размер', num(o, 'size', 2, 10), hint('ширина'), num(o, 'sx', 0.01, 0.05, 3)),
      row('Цвет', color(o, 'color', P.ink), el('button', { onclick: () => { delete o.color; changed(); renderInspector(); } }, 'как у всех')),
      row('Стиль', check(o, 'bold', 'жирный'), check(o, 'italic', 'курсив')),
      row('Выравн.', (() => {
        const s = el('select', { onchange: (e) => { o.align = e.target.value; delete o.center; changed(); } });
        const cur = o.align || (o.center ? 'center' : 'left');
        for (const [v, l] of [['left', 'от левого края'], ['center', 'по центру']]) { const op = el('option', { value: v }, l); if (cur === v) op.selected = true; s.append(op); }
        return s;
      })()),
      row('Обводка', num(o, 'stroke', 1, 0), color(o, 'strokeColor', '#ffffff')),
      row('Тень', num(o, 'shadow', 1, 0), color(o, 'shadowColor', '#000000')),
    );
  } else {
    if (sel.owner && sel.owner.key === 'file') box.append(row(null, el('button', {
      onclick: async () => { const [f] = await pickImages(false); if (f) { sel.owner.obj.file = f; changed(true); renderInspector(); } },
    }, 'Заменить картинку')));
    box.append(
      row('Размер', hint('Ш'), num(o, 'w', 2, 10), hint('В'), num(o, 'h', 2, 10)),
      row('Скругл.', num(o, 'radius', 2, 0)),
      row('Рамка', num(o, 'border', 1, 0), color(o, 'borderColor', P.ink)),
      row('Тень', num(o, 'shadow', 1, 0), color(o, 'shadowColor', '#000000')),
    );
  }
  box.append(
    row('Позиция', hint('X'), num(o, 'x', 1, -3000), hint('Y'), num(o, 'y', 1, -3000)),
    row('Появление', (() => {
      const s = el('select', { onchange: (e) => { o.anim = e.target.value; changed(); } });
      for (const [v, l] of ANIMS) { if (v === 'type' && sel.kind !== 'text') continue; const op = el('option', { value: v }, l); if ((o.anim || 'none') === v) op.selected = true; s.append(op); }
      return s;
    })()),
    row('Длит. анимации', Object.assign(num(o, 'animDur', 0.05, 0.05), { placeholder: '0.3' })),
  );
  if (isOverlay) {
    box.append(el('h2', {}, 'Где показывать'),
      row(null, whereSelect(o)),
      row('Секунды', hint('с'), num(o, 'from', 0.1, 0), hint('до'), el('input', {
        type: 'number', step: 0.1, min: 0, value: o.to ?? '', placeholder: 'конец',
        oninput: (e) => { const v = parseFloat(e.target.value); o.to = isNaN(v) ? null : v; changed(); },
      })),
      el('p', { class: 'hint' }, 'Секунды считаются от начала каждой части, где элемент показан.'),
      row(null, el('button', { class: 'danger', onclick: () => { P.overlays.splice(P.overlays.indexOf(o), 1); sel = null; engine.select(null); renderInspector(); changed(true); } }, 'Удалить элемент')));
  }
  if (sel.kind === 'text') {
    box.append(el('h2', {}, 'Стиль на всё'), row(null, el('button', {
      onclick: () => {
        const keys = ['font', 'color', 'bold', 'italic', 'stroke', 'strokeColor', 'shadow', 'shadowColor', 'anim', 'animDur'];
        const texts = [...P.intro.items.filter(i => i.kind === 'text'), P.layout.label, P.layout.name, P.layout.note, P.layout.finalTitle, ...P.overlays.filter(v => v.kind === 'text')];
        for (const t of texts) if (t !== o) for (const k of keys) { if (o[k] === undefined) delete t[k]; else t[k] = o[k]; }
        changed();
      },
    }, 'Применить этот стиль ко всем текстам')));
  }
}

function renumber() { P.steps.forEach((s, i) => { if (/^step \d+:$/.test(s.label)) s.label = `step ${i + 1}:`; }); }
let lastCardKey = '';
function highlightCard(seg) {
  const key = seg.type === 'step' ? `step-${seg.i}` : seg.type;
  if (key === lastCardKey) return;
  lastCardKey = key;
  panel.querySelectorAll('.card').forEach(c => c.classList.toggle('cur', c.dataset.seg === key));
}

// ---------- strip: the whole recording with markers and the parts each step uses ----------
const strip = $('strip');
let stripDrag = null;
function stripBlocks() {
  const blocks = P.steps.map((s, i) => ({ ref: s, color: COLORS[i % COLORS.length], name: s.name, lane: i % 2 }));
  blocks.push({ ref: P.final, color: '#ececf4', name: P.final.title, lane: 0 });
  return blocks;
}
function drawStrip() {
  if (!P || !strip.clientWidth) return;
  const dpr = window.devicePixelRatio || 1;
  const w = strip.clientWidth, h = strip.clientHeight;
  if (strip.width !== Math.round(w * dpr)) { strip.width = Math.round(w * dpr); strip.height = Math.round(h * dpr); }
  const c = strip.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const dur = Math.max(1, P.duration), X = (t) => t / dur * w;
  // seconds grid
  c.fillStyle = '#2c2c3e';
  const stepS = dur > 600 ? 60 : dur > 120 ? 10 : 5;
  for (let t = 0; t < dur; t += stepS) c.fillRect(X(t), 0, 1, h);
  // markers
  c.font = '11px system-ui, sans-serif';
  for (const m of P.markers || []) {
    c.fillStyle = m.key === 0 ? '#ececf4' : '#9a9ab0';
    c.fillRect(X(m.t), 0, 2, 22);
    c.fillText(m.label, X(m.t) + 4, 14);
  }
  // blocks
  for (const b of stripBlocks()) {
    const y = 28 + b.lane * 32;
    c.globalAlpha = 0.85; c.fillStyle = b.color;
    c.fillRect(X(b.ref.offset), y, Math.max(3, X(b.ref.dur)), 26);
    c.globalAlpha = 1; c.fillStyle = '#0b0b14';
    c.save(); c.beginPath(); c.rect(X(b.ref.offset), y, Math.max(3, X(b.ref.dur)), 26); c.clip();
    c.fillText(b.name, X(b.ref.offset) + 5, y + 17);
    c.restore();
  }
  // where the preview currently reads from the recording
  const seg = engine.segAt(engine.time);
  const src = seg.type === 'step' ? P.steps[seg.i] : seg.type === 'final' ? P.final : null;
  if (src) {
    c.fillStyle = '#7cff9e';
    c.fillRect(X(src.offset + engine.time - seg.start), 0, 2, h);
  }
  $('stripTime').textContent = `запись ${fmt(P.duration)}`;
}
function stripHit(e) {
  const r = strip.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  const dur = Math.max(1, P.duration), t = x / r.width * dur;
  const blocks = stripBlocks();
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i], by = 28 + b.lane * 32;
    if (y >= by && y <= by + 26 && t >= b.ref.offset && t <= b.ref.offset + b.ref.dur) return { b, t };
  }
  return { b: null, t };
}
strip.addEventListener('pointerdown', (e) => {
  const { b, t } = stripHit(e);
  if (!b) return;
  if (engine.playing) engine.stop();
  stripDrag = { ref: b.ref, grab: t - b.ref.offset };
  strip.setPointerCapture(e.pointerId);
  showRef(b.ref);
});
strip.addEventListener('pointermove', (e) => {
  if (!stripDrag) { strip.style.cursor = stripHit(e).b ? 'grab' : 'default'; return; }
  const r = strip.getBoundingClientRect(), t = (e.clientX - r.left) / r.width * P.duration;
  stripDrag.ref.offset = +clamp(t - stripDrag.grab, 0, Math.max(0, P.duration - stripDrag.ref.dur)).toFixed(2);
  engine.setProject(P); showRef(stripDrag.ref); drawStrip();
});
strip.addEventListener('pointerup', () => { if (stripDrag) { stripDrag = null; changed(true); } });
function showRef(ref) {
  const i = P.steps.indexOf(ref);
  jumpTo(i >= 0 ? 'step' : 'final', i);
}
window.addEventListener('resize', drawStrip);

// ---------- crop ----------
let cropTarget = null, cropDraft = null;
const cropVideo = $('cropVideo'), cropRectEl = $('cropRect');
async function openCrop(target) {
  cropTarget = target;
  if (engine.playing) engine.stop();
  $('cropModal').classList.remove('hidden');
  if (!cropVideo.src) cropVideo.src = await api.fileUrl(P.recording);
  await new Promise(r => cropVideo.readyState >= 1 ? r() : cropVideo.addEventListener('loadedmetadata', r, { once: true }));
  $('cropScrub').max = P.duration;
  $('cropScrub').value = target.offset + Math.min(1, target.dur / 2);
  cropVideo.currentTime = +$('cropScrub').value;
  cropDraft = target.crop ? { ...target.crop } : defaultCrop();
  layoutCrop();
}
const bandAspect = () => (1080 - 2 * (P.bandStyle.margin || 0)) / P.band.h;
function defaultCrop() {
  const vw = cropVideo.videoWidth, vh = cropVideo.videoHeight, a = bandAspect();
  let h = vh, w = h * a;
  if (w > vw) { w = vw; h = w / a; }
  return { x: 0, y: (vh - h) / 2 / vh, w: w / vw };
}
function shown() {
  // where the video picture actually sits inside the element (object-fit: contain)
  const r = cropVideo.getBoundingClientRect(), s = $('cropStage').getBoundingClientRect();
  const vw = cropVideo.videoWidth, vh = cropVideo.videoHeight;
  const k = Math.min(r.width / vw, r.height / vh);
  return { left: r.left - s.left + (r.width - vw * k) / 2, top: r.top - s.top + (r.height - vh * k) / 2, k, vw, vh };
}
function clampCrop() {
  const { vw, vh } = shown(), a = bandAspect();
  cropDraft.w = clamp(cropDraft.w, 0.05, Math.min(1, vh * a / vw));
  const hFrac = cropDraft.w * vw / a / vh;
  cropDraft.x = clamp(cropDraft.x, 0, 1 - cropDraft.w);
  cropDraft.y = clamp(cropDraft.y, 0, 1 - hFrac);
}
function layoutCrop() {
  clampCrop();
  const { left, top, k, vw } = shown(), a = bandAspect();
  const wpx = cropDraft.w * vw * k;
  Object.assign(cropRectEl.style, {
    left: `${left + cropDraft.x * vw * k}px`, top: `${top + cropDraft.y * cropVideo.videoHeight * k}px`,
    width: `${wpx}px`, height: `${wpx / a}px`,
  });
}
let cropDrag = null;
cropRectEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  cropDrag = { resize: e.target.classList.contains('handle'), sx: e.clientX, sy: e.clientY, o: { ...cropDraft } };
  cropRectEl.setPointerCapture(e.pointerId);
});
cropRectEl.addEventListener('pointermove', (e) => {
  if (!cropDrag) return;
  const { k, vw, vh } = shown();
  const dx = (e.clientX - cropDrag.sx) / k, dy = (e.clientY - cropDrag.sy) / k;
  if (cropDrag.resize) cropDraft.w = cropDrag.o.w + dx / vw;
  else { cropDraft.x = cropDrag.o.x + dx / vw; cropDraft.y = cropDrag.o.y + dy / vh; }
  layoutCrop();
});
cropRectEl.addEventListener('pointerup', () => { cropDrag = null; });
$('cropScrub').oninput = (e) => { cropVideo.currentTime = +e.target.value; };
cropVideo.addEventListener('loadeddata', () => cropTarget && layoutCrop());
window.addEventListener('resize', () => cropTarget && layoutCrop());
function closeCrop() { $('cropModal').classList.add('hidden'); cropTarget = null; }
$('cropCancel').onclick = closeCrop;
$('cropReset').onclick = () => { cropTarget.crop = null; closeCrop(); changed(true); };
$('cropOk').onclick = () => { cropTarget.crop = { ...cropDraft }; closeCrop(); changed(true); };
$('cropAll').onclick = () => { for (const s of P.steps) s.crop = { ...cropDraft }; cropTarget.crop = { ...cropDraft }; closeCrop(); changed(true); };

// ---------- export ----------
$('exportBtn').onclick = async () => {
  if (engine.exporting) return;
  const sep = projDir.includes('\\') ? '\\' : '/';
  const tmp = `${projDir}${sep}export.tmp.webm`;
  const sid = await api.openStream(tmp);
  const total = engine.timeline().total;
  modal('Записываю видео', 'Идёт запись в реальном времени. Не сворачивай окно.', 0);
  const tick = setInterval(() => modal('Записываю видео', 'Идёт запись в реальном времени. Не сворачивай окно.', engine.time / total), 250);
  try {
    await engine.record(buf => api.writeStream(sid, buf));
    clearInterval(tick);
    await api.closeStream(sid);
    modal('Сохранение', 'Выбери, куда сохранить MP4…');
    const off = api.onExportProgress(f => modal('Кодирую MP4', 'Почти готово…', f));
    const out = await api.finishExport(projDir, tmp, total);
    off();
    if (out) alertModal('Готово', `Видео сохранено: ${out}`); else closeModal();
  } catch (e) {
    clearInterval(tick);
    alertModal('Экспорт не удался', String(e.message || e).slice(-600));
  }
};

// ---------- boot ----------
(async () => {
  platform = await api.platform();
  renderLabels();
  await refreshSources();
  renderRecent();
})();
