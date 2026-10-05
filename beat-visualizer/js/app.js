// App shell: loading beats and MIDI, preview playback, look picker, options and export.
(function () {
  const $ = (id) => document.getElementById(id);
  const SIZES = { '9:16': [1080, 1920], '16:9': [1920, 1080], '4:5': [1080, 1350], '1:1': [1080, 1080] };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('bv.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('bv.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  const state = {
    buffer: null, A: null, parts: [], beatName: '',
    meta: { title: '', bpm: 0, key: '', handle: store.get('handle', '') },
    format: store.get('format', '9:16'),
    look: store.get('look', null),
    opt: store.get('opt', {}),
    clipStart: 0, clipLen: 15,
    fps: 60, normalize: true, quality: store.get('quality', 0.5),
    playing: false, t: 0, version: 1,
    cacheStore: {},
    filter: 'all',
  };

  // ---------- context ----------
  function ctx() {
    const [w, h] = SIZES[state.format];
    return { A: state.A, parts: state.parts, meta: state.meta, w, h, clipStart: state.clipStart, clipLen: state.clipLen,
             fps: state.fps, opt: state.opt, cacheStore: state.cacheStore, version: state.version };
  }
  function bump() { state.version++; state.cacheStore = {}; }
  const currentLook = () => Looks.get(state.look) || Looks.list[0];

  // ---------- audio playback ----------
  let ac = null, src = null, startedAt = 0, startT = 0;
  function audioCtx() { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); return ac; }
  function play() {
    if (!state.buffer) return;
    const a = audioCtx(); a.resume();
    stopSource();
    if (state.t < state.clipStart || state.t >= state.clipStart + state.clipLen - 0.02) state.t = state.clipStart;
    src = a.createBufferSource(); src.buffer = state.buffer; src.connect(a.destination);
    startedAt = a.currentTime + 0.03; startT = state.t;
    src.start(startedAt, state.t, state.clipStart + state.clipLen - state.t);
    src.onended = () => { if (state.playing && nowT() >= state.clipStart + state.clipLen - 0.05) { state.t = state.clipStart; play(); } };
    state.playing = true; ui.play();
  }
  function stopSource() { if (src) { src.onended = null; try { src.stop(); } catch (e) { /* not started */ } src = null; } }
  function pause() { state.t = nowT(); stopSource(); state.playing = false; ui.play(); }
  function nowT() { return state.playing && ac ? startT + Math.max(0, ac.currentTime - startedAt) : state.t; }
  function seek(t) {
    state.t = Math.max(state.clipStart, Math.min(state.clipStart + state.clipLen - 0.001, t));
    if (state.playing) play();
  }

  // ---------- loading ----------
  async function loadBeat(file) {
    $('beatStatus').textContent = `Decoding ${file.name}…`;
    const arr = await file.arrayBuffer();
    const buffer = await audioCtx().decodeAudioData(arr);
    const meta = U.parseFilename(file.name);
    state.beatName = file.name;
    state.parts = state.parts.filter((p) => p.source === 'midi');
    await setBeat(buffer, { title: meta.title, bpm: meta.bpm, key: meta.key || '' });
  }
  async function setBeat(buffer, meta) {
    pause();
    state.buffer = buffer;
    state.meta.title = meta.title; state.meta.key = meta.key || '';
    const hasMidi = state.parts.some((p) => p.source === 'midi');
    state.A = await Analysis.analyze(buffer, {
      bpm: meta.bpm || state.parts.bpm || 0, beatOffset: hasMidi ? 0 : undefined,
      onProgress: (k) => { $('beatStatus').textContent = `Analysing… ${Math.round(k * 100)}%`; },
    });
    state.meta.bpm = Math.round(state.A.bpm * 10) / 10;
    if (!hasMidi) state.parts = Parts.fromAudio(state.A);
    state.clipStart = 0;
    state.clipLen = Math.min(Math.round(buffer.duration * 10) / 10, Math.max(15, Math.min(30, buffer.duration)), 210);
    state.t = 0;
    bump();
    const L = state.A.lufs;
    $('beatStatus').textContent = `${state.beatName || meta.title} · ${U.fmtTime(buffer.duration)} · ${state.meta.bpm} BPM · ${L.integrated.toFixed(1)} LUFS`;
    ui.fields(); ui.parts(); ui.ready();
  }
  async function addMidi(files) {
    let added = [];
    for (const f of files) {
      try { const ps = Parts.fromMidiFile(await f.arrayBuffer(), f.name); added = added.concat(ps); if (ps.bpm) state.parts.bpm = ps.bpm; }
      catch (e) { alert(`${f.name}: ${e.message}`); }
    }
    if (!added.length) return;
    const midi = state.parts.filter((p) => p.source === 'midi');
    state.parts = midi.concat(added);
    state.parts.bpm = added.bpm || state.parts.bpm;
    if (state.A) state.A.setTempo(null, 0); // MIDI starts with the beat
    bump(); ui.parts();
  }
  async function loadDemo() {
    $('beatStatus').textContent = 'Rendering demo beat…';
    const d = await Demo.load();
    state.parts = d.parts;
    state.beatName = d.meta.filename;
    await setBeat(d.buffer, d.meta);
    state.clipLen = Math.round(d.buffer.duration * 10) / 10 - 1;
    ui.fields();
  }

  // ---------- rendering ----------
  const canvas = $('preview'), g = canvas.getContext('2d', { alpha: false });
  let lastFrameMs = 0;
  function sizeCanvas() {
    const [w, h] = SIZES[state.format], q = state.quality;
    const cw = Math.round(w * q), ch = Math.round(h * q);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    canvas.style.aspectRatio = `${w} / ${h}`;
    ui.safe();
  }
  function drawPreview() {
    sizeCanvas();
    const look = currentLook();
    if (!look) return;
    const c = ctx();
    if (!state.A) { g.fillStyle = '#0b0b0d'; g.fillRect(0, 0, canvas.width, canvas.height); return; }
    const t = nowT();
    const t0 = performance.now();
    g.setTransform(state.quality, 0, 0, state.quality, 0, 0);
    Looks.render(g, look, Looks.scene(look, c, t, Math.round((t - state.clipStart) * state.fps)));
    g.setTransform(1, 0, 0, 1, 0, 0);
    lastFrameMs = lastFrameMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  // thumbnails: rendered round-robin so the grid stays live without stalling playback
  let thumbIdx = 0;
  function drawThumbs(n) {
    if (!state.A) return;
    const tiles = [...document.querySelectorAll('.tile:not([hidden])')];
    if (!tiles.length) return;
    const c = ctx(), t = nowT();
    for (let k = 0; k < n; k++) {
      const tile = tiles[thumbIdx++ % tiles.length];
      const look = Looks.get(tile.dataset.id), cv = tile.querySelector('canvas'), cg = cv.getContext('2d', { alpha: false });
      const s = cv.width / c.w;
      if (cv.height !== Math.round(c.h * s)) cv.height = Math.round(c.h * s);
      cg.setTransform(s, 0, 0, s, 0, 0);
      Looks.render(cg, look, Looks.scene(look, c, t, 0));
    }
  }

  let lastUi = 0;
  function loop(now) {
    if (state.playing) {
      const t = nowT();
      if (t >= state.clipStart + state.clipLen) { state.t = state.clipStart; play(); }
    }
    drawPreview();
    drawThumbs(state.playing ? 1 : 3);
    if (now - lastUi > 50) { ui.time(); lastUi = now; }
    requestAnimationFrame(loop);
  }

  // ---------- UI ----------
  const ui = {
    play() { $('playBtn').textContent = state.playing ? 'pause' : 'play'; },
    ready() {
      $('emptyState').classList.add('hidden');
      $('exportBtn').disabled = false;
    },
    time() {
      const t = nowT(), ct = t - state.clipStart;
      const f = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(3).padStart(6, '0')}`;
      $('timeLabel').textContent = `${f(Math.max(0, ct))} / ${f(state.clipLen)}`;
      $('scrubFill').style.width = `${Math.max(0, Math.min(1, ct / state.clipLen)) * 100}%`;
      $('perfLabel').textContent = state.A ? `${lastFrameMs.toFixed(1)} ms/frame` : '';
    },
    fields() {
      $('title').value = state.meta.title; $('bpm').value = state.meta.bpm || ''; $('key').value = state.meta.key;
      $('handle').value = state.meta.handle; $('clipLen').value = state.clipLen; $('clipStart').value = state.clipStart;
      $('format').value = state.format; $('quality').value = String(state.quality);
    },
    parts() {
      const box = $('partsList');
      box.innerHTML = '';
      if (!state.parts.length) return;
      const allAudio = state.parts.every((p) => p.source === 'audio');
      const head = document.createElement('div');
      head.className = 'muted small';
      head.textContent = allAudio ? 'Parts guessed from the audio — add MIDI for exact notes:' : `${state.parts.length} part(s) from MIDI:`;
      box.appendChild(head);
      for (const p of state.parts) {
        const row = document.createElement('div');
        row.className = 'part';
        row.innerHTML = `<input type="checkbox" ${p.enabled ? 'checked' : ''} title="draw this part">
          <input type="color" value="${p.color}"><input type="text" value="${p.name}">
          <select>${['bass', 'chords', 'lead', 'drums', 'other'].map((r) => `<option ${r === p.role ? 'selected' : ''}>${r}</option>`).join('')}</select>
          <button class="x" title="remove">×</button>`;
        const [en, col, name, role, x] = row.querySelectorAll('input, select, button');
        en.onchange = () => { p.enabled = en.checked; bump(); };
        col.oninput = () => { p.color = col.value; bump(); };
        name.onchange = () => { p.name = name.value; bump(); };
        role.onchange = () => { p.role = role.value; bump(); };
        x.onclick = () => { state.parts = state.parts.filter((q) => q !== p); if (!state.parts.length && state.A) state.parts = Parts.fromAudio(state.A); bump(); ui.parts(); };
        box.appendChild(row);
      }
    },
    grid() {
      const grid = $('lookGrid');
      grid.innerHTML = '';
      for (const look of Looks.list) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'tile'; b.dataset.id = look.id; b.dataset.g = look.group;
        b.innerHTML = `<canvas width="96" height="170"></canvas>${look.name}<span class="tag">${look.group === 'midi' ? 'midi' : 'audio'}</span>`;
        b.onclick = () => selectLook(look.id);
        grid.appendChild(b);
      }
      $('lookCount').textContent = `${Looks.list.length} looks`;
      ui.filter();
    },
    filter() {
      document.querySelectorAll('.tile').forEach((t) => { t.hidden = !(state.filter === 'all' || t.dataset.g === state.filter); });
      document.querySelectorAll('#filters button').forEach((b) => b.classList.toggle('on', b.dataset.f === state.filter));
    },
    selected() {
      document.querySelectorAll('.tile').forEach((t) => t.classList.toggle('on', t.dataset.id === currentLook().id));
    },
    opts() {
      const look = currentLook(), box = $('lookOpts');
      const o = state.opt[look.id] || (state.opt[look.id] = {});
      box.innerHTML = `<p class="desc">${look.name}${look.desc ? ' — ' + look.desc : ''}${look.group === 'midi' && !state.parts.some((p) => p.source === 'midi') ? ' <br><em>Reads MIDI: add .mid files for exact notes (now guessing from audio).</em>' : ''}</p>`;
      const controls = [{ key: 'accent', label: 'Accent', type: 'color' }, ...look.controls.filter((c) => c.key !== 'accent')];
      for (const c of controls) {
        const val = o[c.key] ?? look.defaults[c.key];
        const f = document.createElement('div');
        f.className = 'field'; f.dataset.k = `${c.label} ${c.key} ${look.name}`.toLowerCase();
        let input;
        if (c.type === 'select') {
          input = document.createElement('select');
          for (const op of c.options) { const v = typeof op === 'object' ? op.value : op; const l = typeof op === 'object' ? op.label : op; input.add(new Option(l, v, false, String(v) === String(val))); }
        } else {
          input = document.createElement('input');
          input.type = c.type === 'toggle' ? 'checkbox' : c.type === 'range' ? 'range' : c.type === 'color' ? 'color' : 'text';
          if (c.type === 'range') { input.min = c.min; input.max = c.max; input.step = c.step || 1; }
          if (c.type === 'toggle') input.checked = !!val; else input.value = val ?? '';
        }
        input.addEventListener('input', () => {
          o[c.key] = c.type === 'toggle' ? input.checked : c.type === 'range' ? parseFloat(input.value) : input.value;
          store.set('opt', state.opt);
        });
        const lab = document.createElement('label'); lab.textContent = c.label;
        f.append(lab, input);
        box.appendChild(f);
      }
      const reset = document.createElement('button');
      reset.className = 'btn'; reset.type = 'button'; reset.textContent = 'Reset look';
      reset.onclick = () => { state.opt[look.id] = {}; store.set('opt', state.opt); ui.opts(); };
      box.appendChild(reset);
    },
    safe() {
      const el = $('safeGuide'), r = canvas.getBoundingClientRect(), wr = $('canvasWrap').getBoundingClientRect();
      const [w, h] = SIZES[state.format];
      // Reels/TikTok UI covers ~14% top, ~20% bottom, ~12% right; YouTube ~6% all round
      const m = state.format === '9:16' ? [0.14, 0.12, 0.2, 0.06] : [0.06, 0.06, 0.06, 0.06];
      el.style.left = `${r.left - wr.left + r.width * m[3]}px`; el.style.top = `${r.top - wr.top + r.height * m[0]}px`;
      el.style.width = `${r.width * (1 - m[1] - m[3])}px`; el.style.height = `${r.height * (1 - m[0] - m[2])}px`;
      void w; void h;
    },
  };

  function selectLook(id) {
    state.look = id; store.set('look', id);
    ui.selected(); ui.opts();
  }

  // ---------- wiring ----------
  $('playBtn').onclick = () => (state.playing ? pause() : play());
  $('safeBtn').onclick = () => { $('safeGuide').classList.toggle('on'); $('safeBtn').classList.toggle('on'); ui.safe(); };
  $('format').onchange = (e) => { state.format = e.target.value; store.set('format', state.format); bump(); };
  $('quality').onchange = (e) => { state.quality = parseFloat(e.target.value); store.set('quality', state.quality); };
  $('demoBtn').onclick = $('demoBtn2').onclick = loadDemo;
  $('beatFile').onchange = (e) => e.target.files[0] && loadBeat(e.target.files[0]);
  $('midiFile').onchange = (e) => addMidi([...e.target.files]);
  $('title').oninput = (e) => { state.meta.title = e.target.value; bump(); };
  $('key').oninput = (e) => { state.meta.key = e.target.value; bump(); };
  $('handle').oninput = (e) => { state.meta.handle = e.target.value; store.set('handle', e.target.value); };
  $('bpm').onchange = (e) => { const v = parseFloat(e.target.value); if (v > 30 && state.A) { state.A.setTempo(v); state.meta.bpm = v; bump(); } };
  $('clipLen').onchange = (e) => { state.clipLen = Math.max(1, Math.min(210, parseFloat(e.target.value) || 15)); bump(); seek(state.t); };
  $('clipStart').onchange = (e) => { state.clipStart = Math.max(0, parseFloat(e.target.value) || 0); state.t = state.clipStart; bump(); if (state.playing) play(); };
  $('normalize').onchange = (e) => { state.normalize = e.target.checked; };
  $('fps').onchange = (e) => { state.fps = parseInt(e.target.value, 10); };
  document.querySelectorAll('#filters button').forEach((b) => (b.onclick = () => { state.filter = b.dataset.f; ui.filter(); }));
  $('scrub').onpointerdown = (e) => {
    const r = $('scrub').getBoundingClientRect();
    const go = (ev) => seek(state.clipStart + Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * state.clipLen);
    go(e);
    const mv = (ev) => go(ev), up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  };
  addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); state.playing ? pause() : play(); }
    if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key === 'k')) { e.preventDefault(); $('search').focus(); }
  });
  addEventListener('resize', () => ui.safe());

  // settings search: jumps to the matching control
  $('search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('.field.hit').forEach((f) => f.classList.remove('hit'));
    if (!q) return;
    const hit = [...document.querySelectorAll('.field')].find((f) => (f.dataset.k + ' ' + f.textContent).toLowerCase().includes(q));
    if (hit) { hit.classList.add('hit'); hit.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  });

  // drag & drop anywhere
  let dragDepth = 0;
  addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
  addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', async (e) => {
    e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
    const files = [...e.dataTransfer.files];
    const midi = files.filter((f) => /\.midi?$/i.test(f.name));
    const audio = files.find((f) => !/\.midi?$/i.test(f.name));
    if (midi.length) await addMidi(midi);
    if (audio) await loadBeat(audio);
  });

  // export
  let exporting = null;
  $('exportBtn').onclick = async () => {
    if (exporting) { exporting.abort(); return; }
    if (!state.buffer) return;
    pause();
    const look = currentLook();
    const c = ctx(); c.cacheStore = {}; // fresh caches at export resolution
    const name = `${(state.meta.title || 'beat').replace(/[^\w\-. а-яё]+/gi, '').trim() || 'beat'}_${look.id}_${state.format.replace(':', 'x')}_${state.fps}fps.mp4`;
    exporting = new AbortController();
    $('exportBtn').textContent = 'Cancel';
    const bar = $('exportProgress').firstElementChild;
    try {
      await document.fonts.ready;
      const res = await Exporter.exportVideo({
        look, ctx: c, buffer: state.buffer, fps: state.fps, filename: name, normalize: state.normalize, signal: exporting.signal,
        onProgress: (k, label) => { bar.style.width = `${k * 100}%`; $('exportStatus').textContent = `${label} ${Math.round(k * 100)}%`; },
      });
      $('exportStatus').textContent = res.cancelled ? 'Cancelled.' : `Saved ${name} · ${(res.size / 1e6).toFixed(1)} MB in ${res.seconds.toFixed(1)} s`;
    } catch (err) {
      console.error(err);
      $('exportStatus').textContent = `Export failed: ${err.message}`;
    } finally {
      exporting = null; $('exportBtn').textContent = 'Export MP4';
    }
  };

  // ---------- boot ----------
  ui.grid();
  if (!Looks.get(state.look)) state.look = Looks.list[0] && Looks.list[0].id;
  ui.selected(); ui.opts(); ui.fields(); ui.play();
  requestAnimationFrame(loop);


  // Test hooks (used by tools/snap.cjs). ?demo=1 loads the demo beat on start.
  const params = new URLSearchParams(location.search);
  if (params.get('format')) state.format = params.get('format');
  if (params.get('look')) state.look = params.get('look');
  // Canvas text never triggers webfont loading, so load every face up front.
  const fontsReady = Promise.all([...document.fonts].map((f) => f.load().catch(() => null))).then(() => document.fonts.ready);
  const ready = params.get('demo') ? fontsReady.then(loadDemo).then(() => {
    if (params.get('nomidi')) { state.parts = Parts.fromAudio(state.A); bump(); }
  }) : Promise.resolve();
  window.__app = {
    state, ready, ctx, Looks,
    // Renders `look` at clip time `ct` at full resolution, returns a PNG data URL.
    snap(lookId, ct, scale = 1) {
      const look = Looks.get(lookId); const c = ctx();
      const cv = document.createElement('canvas'); cv.width = c.w * scale; cv.height = c.h * scale;
      const cg = cv.getContext('2d', { alpha: false }); cg.setTransform(scale, 0, 0, scale, 0, 0);
      const t0 = performance.now();
      Looks.render(cg, look, Looks.scene(look, c, c.clipStart + ct, Math.round(ct * c.fps)));
      return { url: cv.toDataURL('image/png'), ms: performance.now() - t0 };
    },
  };
})();
