'use strict';

const $ = (id) => document.getElementById(id);
let files = [];
let running = false;
let outDir = '';

function renderFiles() {
  const box = $('files');
  box.innerHTML = '';
  files.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'file';
    const name = document.createElement('span');
    name.textContent = f;
    name.title = f;
    const rm = document.createElement('button');
    rm.textContent = '✕';
    rm.onclick = () => { files.splice(i, 1); renderFiles(); };
    row.append(name, rm);
    box.append(row);
  });
  $('start').disabled = running || files.length === 0;
  $('status').textContent = files.length ? `Файлов: ${files.length}` : '';
}

function addFiles(list) {
  for (const f of list) if (!files.includes(f)) files.push(f);
  renderFiles();
}

async function refreshLuts() {
  const info = await window.api.lutsInfo();
  $('lutInfo').textContent = `LUT в библиотеке: ${info.count}` + (info.count ? '' : ' (создадутся автоматически)');
}

function num(id, fallback) {
  const v = parseFloat($(id).value);
  return Number.isFinite(v) ? v : fallback;
}

function collectOpts() {
  let sMin = num('speedMin', 1), sMax = num('speedMax', 1);
  if (sMin > sMax) [sMin, sMax] = [sMax, sMin];
  let lMin = num('lutMin', 0.5), lMax = num('lutMax', 1);
  if (lMin > lMax) [lMin, lMax] = [lMax, lMin];
  const codec = $('codec').value;
  return {
    speedMin: Math.max(0.5, sMin), speedMax: Math.min(2, sMax),
    fit: $('fit').value,
    lutEnabled: $('lutOn').checked,
    lutStrengthMin: Math.max(0.05, lMin), lutStrengthMax: Math.min(1, lMax),
    daysA: Math.max(0, num('daysA', 10)), daysB: Math.max(0, num('daysB', 150)),
    codec, crf: 18, preset: 'medium', bitrate: '12000k', fps: 30,
  };
}

function jobEl(id) {
  let el = document.getElementById('job' + id);
  if (!el) {
    el = document.createElement('div');
    el.className = 'job';
    el.id = 'job' + id;
    el.innerHTML = '<div class="top"><span class="name"></span><span class="pct"></span></div><div class="bar"><i></i></div><div class="info"></div>';
    $('jobs').prepend(el);
  }
  return el;
}

window.api.onJob((d) => {
  const el = jobEl(d.id);
  el.className = 'job ' + (d.state === 'run' ? '' : d.state);
  el.querySelector('.name').textContent = `${d.id + 1}/${d.total} · ${d.name}`;
  el.querySelector('.pct').textContent = d.state === 'error' ? 'ошибка' : d.percent + '%';
  el.querySelector('.bar > i').style.width = d.percent + '%';
  const info = el.querySelector('.info');
  info.textContent = d.state === 'error' ? d.error : (d.info || '');
  if (d.state === 'done' && d.file) {
    const a = document.createElement('a');
    a.textContent = ' · показать в Finder';
    a.onclick = () => window.api.showFile(d.file);
    info.append(a);
  }
});

async function start() {
  if (running || !files.length) return;
  running = true;
  $('start').disabled = true;
  $('cancel').hidden = false;
  $('jobs').innerHTML = '';
  $('status').textContent = 'Обработка…';
  try {
    const r = await window.api.run({
      files: [...files], outDir,
      copies: Math.max(1, Math.min(50, Math.floor(num('copies', 1)))),
      opts: collectOpts(),
    });
    $('status').textContent = `${r.stopped ? 'Остановлено. ' : ''}Готово: ${r.ok}, ошибок: ${r.fail}`;
  } catch (e) {
    $('status').textContent = 'Ошибка: ' + (e.message || e);
  }
  running = false;
  $('cancel').hidden = true;
  renderFiles();
  refreshLuts();
}

(async () => {
  const d = await window.api.defaults();
  outDir = d.outDir;
  $('outDir').value = outDir;
  await refreshLuts();

  $('pick').onclick = async () => addFiles(await window.api.pickFiles());
  $('pickOut').onclick = async () => {
    const p = await window.api.pickOutput();
    if (p) { outDir = p; $('outDir').value = p; }
  };
  $('openOut').onclick = () => window.api.openPath(outDir);
  $('openLuts').onclick = async () => window.api.openPath((await window.api.lutsInfo()).dir);
  $('genLuts').onclick = async () => { await window.api.genLuts(12); refreshLuts(); };
  $('start').onclick = start;
  $('cancel').onclick = () => window.api.cancel();

  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => {
    e.preventDefault(); drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => {
    e.preventDefault(); drop.classList.remove('over');
  }));
  document.addEventListener('drop', async (e) => {
    const paths = window.api.pathsFromDrop(e.dataTransfer.files);
    addFiles(await window.api.expand(paths));
  });
})();
