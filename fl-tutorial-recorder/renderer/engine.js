// Renders the tutorial (intro → steps → full beat) onto a 1080x1920 canvas
// and keeps the recording's <video> players in sync with the timeline.
(function () {
  const W = 1080, H = 1920;
  const FONT = 'Arial, "Liberation Sans", "Helvetica Neue", Helvetica, sans-serif';

  function defaults() {
    return {
      ink: '#0b063b',
      bg: '#ffffff',
      band: { y: 420, h: 1035 },
      clipVol: 1,
      intro: {
        enabled: true,
        dur: 3,
        audioFromFinal: true,
        items: [
          { kind: 'text', text: 'how i make', x: 221, y: 581, size: 300, sx: 0.25, bold: false, at: 0 },
          { kind: 'text', text: 'beats', x: 604, y: 862, size: 205, sx: 0.62, bold: true, at: 0.83 },
          { kind: 'text', text: 'for', x: 465, y: 1147, size: 190, sx: 0.44, bold: false, at: 1.0 },
          { kind: 'image', file: null, x: 619, y: 341, w: 289, h: 289, at: 1.17 },
          { kind: 'image', file: null, x: 240, y: 652, w: 289, h: 289, at: 1.25 },
          { kind: 'text', text: 'artist', x: 390, y: 1481, size: 340, sx: 0.33, bold: false, at: 1.33 },
        ],
      },
      layout: {
        label: { x: 131, y: 300, size: 190, sx: 0.39 },
        name: { x: 439, y: 366, size: 196, sx: 0.36 },
        note: { x: 515, y: 1781, size: 350, sx: 0.2, center: true },
        finalTitle: { x: 142, y: 394, size: 375, sx: 0.2 },
        finalImg: { x: 581, y: 253, w: 379, h: 375 },
      },
      steps: [],
      final: { title: 'full beat', offset: 0, dur: 12, crop: null, images: [], bpm: 140, beatsPer: 2, pop: true },
    };
  }

  function create(canvas) {
    const ctx = canvas.getContext('2d');
    let P = null;                 // project
    let players = [];             // two <video> elements on the same recording
    let actx = null, master = null, recDest = null;
    const gains = new WeakMap();
    const images = new Map();     // file path -> HTMLImageElement
    const bandCache = document.createElement('canvas');
    let bandCacheOk = false;
    let hits = [], hover = null, exporting = false;
    let T = 0, playing = false, last = 0, raf = 0, onEnd = null, drawQueued = false;
    const listeners = { time: [], change: [] };

    // ---------- media ----------
    function setRecording(url) {
      players.forEach(v => { v.pause(); v.removeAttribute('src'); v.load(); });
      players = [0, 1].map(() => {
        const v = document.createElement('video');
        v.preload = 'auto'; v.playsInline = true; v.src = url;
        v.addEventListener('loadeddata', requestDraw);
        v.addEventListener('seeked', requestDraw);
        return v;
      });
      bandCacheOk = false;
    }
    function image(file) {
      if (!file) return null;
      let img = images.get(file);
      if (!img) {
        img = new Image();
        img.onload = requestDraw;
        images.set(file, img);
        window.api.fileUrl(file).then(u => { img.src = u; });
      }
      return img.naturalWidth ? img : null;
    }
    function ensureAudio() {
      if (!actx) {
        actx = new AudioContext();
        master = actx.createGain();
        master.connect(actx.destination);
        recDest = actx.createMediaStreamDestination();
        master.connect(recDest);
      }
      if (actx.state === 'suspended') actx.resume();
      for (const v of players) {
        if (!gains.has(v)) {
          const g = actx.createGain();
          actx.createMediaElementSource(v).connect(g);
          g.connect(master);
          gains.set(v, g);
        }
      }
    }
    function setVolume(v, vol) { const g = gains.get(v); if (g) g.gain.value = vol; }

    // ---------- timeline ----------
    function timeline() {
      const segs = []; let t = 0;
      if (P.intro.enabled) { segs.push({ type: 'intro', start: t, dur: P.intro.dur }); t += P.intro.dur; }
      P.steps.forEach((st, i) => { segs.push({ type: 'step', i, start: t, dur: st.dur }); t += st.dur; });
      segs.push({ type: 'final', start: t, dur: P.final.dur }); t += P.final.dur;
      return { segs, total: t };
    }
    function locate(t) {
      const { segs } = timeline();
      let idx = segs.findIndex(s => t < s.start + s.dur);
      if (idx < 0) idx = segs.length - 1;
      return { segs, idx, seg: segs[idx] };
    }
    const segAt = (t) => locate(t).seg;
    const srcOf = (seg) => seg.type === 'step' ? P.steps[seg.i] : seg.type === 'final' ? P.final : null;
    // Where in the recording a segment plays from (intro borrows the full beat's audio).
    function sourceTime(seg, local) {
      if (seg.type === 'intro') return P.intro.audioFromFinal ? P.final.offset + local : null;
      return srcOf(seg).offset + local;
    }

    // ---------- drawing ----------
    function text(str, o, bold = false) {
      ctx.save();
      ctx.fillStyle = P.ink;
      ctx.font = `${bold ? 700 : 400} ${o.size}px ${FONT}`;
      const w = ctx.measureText(str).width * o.sx;
      const x = o.center ? o.x - w / 2 : o.x;
      ctx.translate(x, o.y);
      ctx.scale(o.sx, 1);
      ctx.fillText(str, 0, 0);
      ctx.restore();
      hits.push({ ref: o, x, y: o.y - o.size * 0.74, w, h: o.size * 0.95 });
    }
    function cover(img, x, y, w, h, scale = 1) {
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const s = Math.max(w / iw, h / ih) * scale, dw = iw * s, dh = ih * s;
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      ctx.restore();
    }
    function photo(o, file, scale = 1, blur = 0) {
      const img = image(file);
      if (img) {
        if (blur > 0.3) ctx.filter = `blur(${blur}px)`;
        cover(img, o.x, o.y, o.w, o.h, scale);
        ctx.filter = 'none';
      } else if (!exporting) {
        ctx.save();
        ctx.fillStyle = '#d9d9e3'; ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.fillStyle = '#8a8aa0'; ctx.font = `500 ${Math.round(o.w / 7)}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('фото', o.x + o.w / 2, o.y + o.h / 2);
        ctx.restore();
      }
      hits.push({ ref: o, x: o.x, y: o.y, w: o.w, h: o.h });
    }

    // Crop is stored as fractions of the recording: {x, y, w}; height follows the band's aspect.
    function cropRect(v, crop) {
      const vw = v.videoWidth, vh = v.videoHeight, aspect = W / P.band.h;
      let w, h, x, y;
      if (crop) { w = crop.w * vw; h = w / aspect; x = crop.x * vw; y = crop.y * vh; }
      else { h = vh; w = h * aspect; if (w > vw) { w = vw; h = w / aspect; } x = 0; y = (vh - h) / 2; }
      w = Math.min(w, vw); h = Math.min(h, vh);
      x = Math.max(0, Math.min(vw - w, x)); y = Math.max(0, Math.min(vh - h, y));
      return { x, y, w, h };
    }
    function band(src, v) {
      const { y, h } = P.band;
      if (v && v.readyState >= 2 && v.videoWidth) {
        const r = cropRect(v, src.crop);
        ctx.drawImage(v, r.x, r.y, r.w, r.h, 0, y, W, h);
        bandCache.width = W; bandCache.height = h;
        bandCache.getContext('2d').drawImage(canvas, 0, y, W, h, 0, 0, W, h);
        bandCacheOk = true;
      } else if (bandCacheOk) {
        ctx.drawImage(bandCache, 0, y); // hold the last frame while the player seeks
      } else {
        ctx.fillStyle = '#1f2333'; ctx.fillRect(0, y, W, h);
      }
    }

    function draw(t, v) {
      hits = [];
      const seg = segAt(t), local = t - seg.start;
      ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H);
      if (seg.type === 'intro') {
        for (const it of P.intro.items) {
          if (local < it.at) continue;
          if (it.kind === 'text') text(it.text, it, it.bold); else photo(it, it.file);
        }
      } else if (seg.type === 'step') {
        const st = P.steps[seg.i], L = P.layout;
        band(st, v);
        text(st.label, L.label);
        text(st.name, L.name);
        if (st.note && local >= st.noteFrom && local < st.noteTo) text(st.note, L.note);
      } else {
        const f = P.final, L = P.layout;
        band(f, v);
        text(f.title, L.finalTitle);
        const n = f.images.length;
        if (n) {
          const interval = 60 / Math.max(1, f.bpm) * Math.max(0.25, f.beatsPer);
          const idx = Math.floor(local / interval) % n;
          const k = Math.min(1, (local % interval) / 0.15), e = 1 - Math.pow(1 - k, 3);
          photo(L.finalImg, f.images[idx], f.pop ? 1.1 - 0.1 * e : 1, f.pop ? (1 - e) * 10 : 0);
        } else photo(L.finalImg, null);
      }
      if (!exporting && hover) {
        ctx.save(); ctx.strokeStyle = '#6b5cff'; ctx.setLineDash([12, 8]); ctx.lineWidth = 4;
        ctx.strokeRect(hover.x - 6, hover.y - 6, hover.w + 12, hover.h + 12); ctx.restore();
      }
    }

    // ---------- sync ----------
    // Segments alternate between the two players, so the next one can be pre-seeked
    // while the current one is still on screen.
    function sync(t, isPlaying) {
      const { segs, idx, seg } = locate(t);
      const local = t - seg.start;
      const active = players.length ? players[idx % 2] : null;
      const other = players.length ? players[(idx + 1) % 2] : null;
      const want = sourceTime(seg, local);
      if (other) {
        const next = segs[idx + 1];
        const nextWant = next ? sourceTime(next, 0) : null;
        if (!other.paused) other.pause();
        if (nextWant != null && seg.start + seg.dur - t < 1.5 && Math.abs(other.currentTime - nextWant) > 0.05 && !other.seeking) {
          other.currentTime = nextWant;
        }
      }
      if (active) {
        if (want == null) { if (!active.paused) active.pause(); return null; }
        setVolume(active, P.clipVol);
        if (Math.abs(active.currentTime - want) > (isPlaying ? 0.25 : 0.03)) active.currentTime = want;
        if (isPlaying && active.paused) active.play().catch(() => {});
        if (!isPlaying && !active.paused) active.pause();
      }
      return seg.type === 'intro' ? null : active;
    }

    function frame(isPlaying) {
      const v = sync(T, isPlaying);
      draw(T, v);
      listeners.time.forEach(fn => fn(T, timeline().total, segAt(T)));
    }
    function requestDraw() {
      if (playing || drawQueued || !P) return;
      drawQueued = true;
      requestAnimationFrame(() => { drawQueued = false; frame(false); });
    }
    function loop(now) {
      const total = timeline().total;
      T = Math.min(total, T + (now - last) / 1000);
      last = now;
      frame(true);
      if (T >= total) { stop(); if (onEnd) { const f = onEnd; onEnd = null; f(); } return; }
      raf = requestAnimationFrame(loop);
    }
    function play() {
      ensureAudio();
      if (T >= timeline().total - 0.01) T = 0;
      playing = true; last = performance.now();
      raf = requestAnimationFrame(loop);
    }
    function stop() {
      playing = false; cancelAnimationFrame(raf);
      players.forEach(v => v.pause());
      frame(false);
    }
    function seek(t) { T = Math.max(0, Math.min(timeline().total, t)); if (!playing) frame(false); }

    // ---------- drag & wheel on the preview ----------
    let drag = null;
    const toFrame = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
    const hitAt = (p) => { for (let i = hits.length - 1; i >= 0; i--) { const h = hits[i]; if (p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) return h; } return null; };
    const changed = () => listeners.change.forEach(fn => fn());
    canvas.addEventListener('pointerdown', (e) => {
      const p = toFrame(e), h = hitAt(p);
      if (!h || exporting) return;
      if (playing) stop();
      drag = { ref: h.ref, sx: p.x, sy: p.y, ox: h.ref.x, oy: h.ref.y };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = toFrame(e);
      if (drag) {
        drag.ref.x = Math.round(drag.ox + p.x - drag.sx);
        drag.ref.y = Math.round(drag.oy + p.y - drag.sy);
        changed(); requestDraw(); return;
      }
      const h = hitAt(p);
      canvas.style.cursor = h ? 'move' : 'default';
      if ((h && h.ref) !== (hover && hover.ref)) { hover = h; requestDraw(); }
    });
    canvas.addEventListener('pointerup', () => { drag = null; });
    canvas.addEventListener('pointerleave', () => { if (!drag && hover) { hover = null; requestDraw(); } });
    canvas.addEventListener('wheel', (e) => {
      const h = hitAt(toFrame(e));
      if (!h || exporting) return;
      e.preventDefault();
      const k = e.deltaY < 0 ? 1.04 : 1 / 1.04, o = h.ref;
      if (e.altKey && o.sx) o.sx = +(o.sx * k).toFixed(3);
      else if (o.size) o.size = Math.round(o.size * k);
      else { o.w = Math.round(o.w * k); o.h = Math.round(o.h * k); }
      changed(); requestDraw();
    }, { passive: false });

    // ---------- export ----------
    // Real-time capture of the canvas plus the recording's audio. Resolves with a Blob stream
    // via onChunk so long videos never sit in memory.
    async function record(onChunk) {
      ensureAudio();
      if (playing) stop();
      const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
      const mime = types.find(t => MediaRecorder.isTypeSupported(t));
      exporting = true; hover = null;
      T = 0; frame(false);
      await settle();
      const stream = canvas.captureStream(30);
      recDest.stream.getAudioTracks().forEach(tr => stream.addTrack(tr));
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 20e6, audioBitsPerSecond: 256e3 });
      let chain = Promise.resolve();
      rec.ondataavailable = (e) => { if (e.data.size) { const d = e.data; chain = chain.then(() => d.arrayBuffer()).then(onChunk); } };
      return new Promise((resolve) => {
        rec.onstop = () => chain.then(() => { exporting = false; requestDraw(); resolve(timeline().total); });
        onEnd = () => setTimeout(() => rec.stop(), 150);
        rec.start(500);
        play();
      });
    }
    function settle() {
      const ready = (v) => new Promise(r => { const c = () => (!v.seeking && v.readyState >= 2) ? r() : setTimeout(c, 50); c(); });
      return Promise.race([Promise.all(players.map(ready)), new Promise(r => setTimeout(r, 8000))])
        .then(() => new Promise(r => setTimeout(r, 150)));
    }

    return {
      W, H,
      setProject(p) { P = p; T = Math.min(T, timeline().total); requestDraw(); },
      setRecording,
      timeline, segAt, seek, play, stop, record, requestDraw, ensureAudio,
      get time() { return T; },
      get playing() { return playing; },
      get exporting() { return exporting; },
      on(ev, fn) { listeners[ev].push(fn); },
    };
  }

  window.Engine = { create, defaults, W, H };
})();
