// Renderer, UI wiring and video export.
(function () {
  const $ = (id) => document.getElementById(id);
  const canvas = $('stage');
  const g = canvas.getContext('2d');
  const audio = new AudioEngine();

  const SIZES = {
    '16:9': [1920, 1080],
    '9:16': [1080, 1920],
    '1:1': [1080, 1080],
    '4:5': [1080, 1350],
  };

  const opt = {
    mode: MODES[0].id,
    aspect: '16:9',
    color1: '#ff3d7f',
    color2: '#7c4dff',
    bgColor: '#0b0b12',
    bgBlur: 18,
    bgDim: 0.55,
    barCount: 64,
    intensity: 1,
    glow: true,
    zoomPulse: true,
    shake: false,
    flash: false,
    showProgress: true,
    title: '',
    artist: '',
    font: 'Inter',
  };

  let coverImg = null, bgImg = null;
  let modeState = {};
  let lastFrame = performance.now(), startTime = performance.now();

  // ---------- drawing ----------

  function drawImageCover(img, x, y, w, h) {
    const s = Math.max(w / img.width, h / img.height);
    const iw = img.width * s, ih = img.height * s;
    g.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  }

  function drawBackground(w, h) {
    g.fillStyle = opt.bgColor;
    g.fillRect(0, 0, w, h);
    const img = bgImg || coverImg;
    if (!img) return;
    const z = 1.08 + (opt.zoomPulse ? audio.beat * 0.04 * opt.intensity : 0);
    g.save();
    g.filter = opt.bgBlur > 0 ? `blur(${opt.bgBlur}px)` : 'none';
    drawImageCover(img, w * (1 - z) / 2, h * (1 - z) / 2, w * z, h * z);
    g.restore();
    g.fillStyle = `rgba(0,0,0,${opt.bgDim})`;
    g.fillRect(0, 0, w, h);
  }

  function roundedClip(x, y, w, h, r) {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
    g.clip();
  }

  function drawCover(mode, w, h, unit) {
    const centered = mode.coverLayout === 'center';
    let size, x, y, r;
    if (centered) {
      size = unit * 0.36 * (1 + audio.beat * 0.03 * opt.intensity);
      x = w / 2 - size / 2; y = h / 2 - size / 2; r = size / 2;
    } else {
      size = unit * 0.16;
      x = unit * 0.06; y = unit * 0.06; r = size * 0.12;
    }
    if (coverImg) {
      g.save();
      g.shadowBlur = 40; g.shadowColor = 'rgba(0,0,0,0.6)';
      roundedClip(x, y, size, size, r);
      drawImageCover(coverImg, x, y, size, size);
      g.restore();
    }
    return { centered, x, y, size };
  }

  function drawText(box, w, h, unit) {
    if (!opt.title && !opt.artist) return;
    g.save();
    g.fillStyle = '#fff';
    g.shadowBlur = 12; g.shadowColor = 'rgba(0,0,0,0.6)';
    const tSize = Math.round(unit * 0.045), aSize = Math.round(unit * 0.03);
    if (box.centered) {
      g.textAlign = 'center';
      const y = h / 2 + unit * 0.42;
      g.font = `700 ${tSize}px ${opt.font}, sans-serif`;
      g.fillText(opt.title, w / 2, y);
      g.globalAlpha = 0.75;
      g.font = `400 ${aSize}px ${opt.font}, sans-serif`;
      g.fillText(opt.artist, w / 2, y + aSize * 1.5);
    } else {
      g.textAlign = 'left';
      const x = coverImg ? box.x + box.size + unit * 0.03 : box.x;
      const y = box.y + box.size / 2;
      g.font = `700 ${tSize}px ${opt.font}, sans-serif`;
      g.fillText(opt.title, x, y);
      g.globalAlpha = 0.75;
      g.font = `400 ${aSize}px ${opt.font}, sans-serif`;
      g.fillText(opt.artist, x, y + aSize * 1.5);
    }
    g.restore();
  }

  function drawProgress(w, h) {
    if (!opt.showProgress || !audio.duration) return;
    const p = audio.time / audio.duration, y = h - 10;
    g.fillStyle = 'rgba(255,255,255,0.15)';
    g.fillRect(0, y, w, 10);
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, opt.color1); gr.addColorStop(1, opt.color2);
    g.fillStyle = gr;
    g.fillRect(0, y, w * p, 10);
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    audio.update(now);

    const w = canvas.width, h = canvas.height, unit = Math.min(w, h);
    const mode = MODES.find((m) => m.id === opt.mode) || MODES[0];

    g.save();
    if (opt.shake && audio.beat > 0.3) {
      const k = audio.beat * unit * 0.008 * opt.intensity;
      g.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
    }
    drawBackground(w, h);

    g.save();
    mode.draw(g, { audio, w, h, cx: w / 2, cy: h / 2, unit, opt,
                   t: (now - startTime) / 1000, dt, state: modeState });
    g.restore();

    const box = drawCover(mode, w, h, unit);
    drawText(box, w, h, unit);
    g.restore();

    if (opt.flash && audio.beat > 0.5) {
      g.fillStyle = `rgba(255,255,255,${(audio.beat - 0.5) * 0.25 * opt.intensity})`;
      g.fillRect(0, 0, w, h);
    }
    drawProgress(w, h);
    updateTransport();
    requestAnimationFrame(frame);
  }

  // ---------- UI ----------

  function setAspect(a) {
    const [w, h] = SIZES[a];
    canvas.width = w; canvas.height = h;
    canvas.style.aspectRatio = `${w} / ${h}`;
    modeState = {};
  }

  function readImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  function fmt(t) {
    t = Math.max(0, t | 0);
    return `${(t / 60) | 0}:${String(t % 60).padStart(2, '0')}`;
  }

  function updateTransport() {
    $('time').textContent = `${fmt(audio.time)} / ${fmt(audio.duration)}`;
    if (!seeking && audio.duration) $('seek').value = (audio.time / audio.duration) * 1000;
    $('play').textContent = audio.playing ? 'Pause' : 'Play';
  }

  // Mode picker
  const modeList = $('modes');
  MODES.forEach((m) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = m.name;
    b.dataset.id = m.id;
    b.onclick = () => {
      opt.mode = m.id;
      modeState = {};
      modeList.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    };
    if (m.id === opt.mode) b.classList.add('active');
    modeList.appendChild(b);
  });

  // Bind simple inputs to `opt`.
  document.querySelectorAll('[data-opt]').forEach((el) => {
    const key = el.dataset.opt;
    if (el.type === 'checkbox') el.checked = opt[key]; else el.value = opt[key];
    el.addEventListener('input', () => {
      opt[key] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? parseFloat(el.value) : el.value;
      if (key === 'aspect') setAspect(opt.aspect);
    });
  });
  $('sensitivity').addEventListener('input', (e) => { audio.sensitivity = parseFloat(e.target.value); });

  $('audioFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    audio.load(f);
    if (!opt.title) {
      opt.title = f.name.replace(/\.[^.]+$/, '');
      $('title').value = opt.title;
    }
    $('play').disabled = $('export').disabled = false;
  });
  $('coverFile').addEventListener('change', async (e) => {
    if (e.target.files[0]) coverImg = await readImage(e.target.files[0]);
  });
  $('bgFile').addEventListener('change', async (e) => {
    if (e.target.files[0]) bgImg = await readImage(e.target.files[0]);
  });
  $('clearBg').onclick = () => { bgImg = null; $('bgFile').value = ''; };

  $('play').onclick = () => (audio.playing ? audio.pause() : audio.play());
  let seeking = false;
  $('seek').addEventListener('input', (e) => { seeking = true; audio.seek((e.target.value / 1000) * audio.duration); });
  $('seek').addEventListener('change', () => { seeking = false; });

  // ---------- export ----------

  function pickMime() {
    const list = [
      'video/mp4;codecs=avc1.640028,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    return list.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  }

  let recorder = null;

  async function startExport() {
    if (!audio.el.src) return;
    audio.ensureContext();
    const mime = pickMime();
    const fps = parseInt($('fps').value, 10);
    const from = Math.max(0, parseFloat($('expFrom').value) || 0);
    const len = parseFloat($('expLen').value) || 0;
    const until = len > 0 ? Math.min(audio.duration, from + len) : audio.duration;

    const stream = new MediaStream([
      ...canvas.captureStream(fps).getVideoTracks(),
      ...audio.recordDest.stream.getAudioTracks(),
    ]);
    const chunks = [];
    recorder = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 12e6, audioBitsPerSecond: 256e3 });
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      const type = recorder.mimeType || mime || 'video/webm';
      const blob = new Blob(chunks, { type });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(opt.title || 'visualizer').replace(/[^\w\-а-яё ]+/gi, '')}-${opt.aspect.replace(':', 'x')}.${type.includes('mp4') ? 'mp4' : 'webm'}`;
      a.click();
      setExporting(false);
      recorder = null;
    };

    audio.pause();
    audio.seek(from);
    modeState = {};
    setExporting(true);
    recorder.start(250);
    await audio.play();

    const tick = () => {
      if (!recorder) return;
      const p = (audio.time - from) / (until - from);
      $('expStatus').textContent = `Recording… ${Math.min(100, Math.round(p * 100))}%`;
      if (audio.time >= until || audio.el.ended) stopExport(); else setTimeout(tick, 100);
    };
    tick();
  }

  function stopExport() {
    if (!recorder) return;
    audio.pause();
    recorder.stop();
  }

  function setExporting(on) {
    document.body.classList.toggle('exporting', on);
    $('export').textContent = on ? 'Stop & save' : 'Export video';
    $('expStatus').textContent = on ? 'Recording…' : '';
  }

  $('export').onclick = () => (recorder ? stopExport() : startExport());

  setAspect(opt.aspect);
  requestAnimationFrame(frame);
})();
