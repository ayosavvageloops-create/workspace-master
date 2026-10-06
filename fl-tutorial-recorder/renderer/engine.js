// Renders the tutorial (intro → steps → full beat) onto a 1080x1920 canvas
// and keeps the recording's <video> players in sync with the timeline.
(function () {
  const W = 1080, H = 1920;
  const FONT = 'Arial, "Liberation Sans", "Helvetica Neue", Helvetica, sans-serif';

  function defaults() {
    return {
      ink: '#0b063b',
      bg: '#ffffff',
      bgImage: null,
      font: 'Arial',
      fonts: [],                    // custom fonts: [{ family, file }]
      band: { y: 420, h: 1035 },
      bandStyle: { margin: 0, radius: 0, border: 0, borderColor: '#0b063b', brightness: 1, contrast: 1, saturate: 1 },
      overlays: [],                 // free texts/images: { id, kind, where, from, to, ...style }
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

  // Older project files lack newer fields; fill them in without touching what's there.
  function migrate(p) {
    const d = defaults();
    for (const k of Object.keys(d)) if (p[k] === undefined) p[k] = d[k];
    p.bandStyle = { ...d.bandStyle, ...p.bandStyle };
    p.steps.forEach(s => { if (!s.id) s.id = uid(); });
    p.overlays.forEach(o => { if (!o.id) o.id = uid(); });
    return p;
  }
  const uid = () => Math.random().toString(36).slice(2, 9);

  const ease = {
    out: (k) => 1 - Math.pow(1 - k, 3),
    back: (k) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); },
  };

  function create(canvas) {
    const ctx = canvas.getContext('2d');
    let P = null;                 // project
    let players = [];             // two <video> elements on the same recording
    let actx = null, master = null, recDest = null;
    const gains = new WeakMap();
    const images = new Map();     // file path -> HTMLImageElement
    const bandCache = document.createElement('canvas');
    let bandCacheOk = false;
    let hits = [], hover = null, selected = null, exporting = false;
    let T = 0, playing = false, last = 0, raf = 0, onEnd = null, drawQueued = false;
    const listeners = { time: [], change: [], select: [] };

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
    const family = (f) => `"${f || P.font}", ${FONT}`;

    // Appear animation: returns {alpha, scale, dy, chars} for an element `age` seconds after it shows up.
    function anim(o, age) {
      const type = o.anim || 'none', dur = Math.max(0.05, o.animDur || 0.3);
      const k = Math.max(0, Math.min(1, age / dur));
      switch (type) {
        case 'pop': return { alpha: Math.min(1, k * 3), scale: 0.6 + 0.4 * ease.back(k), dy: 0 };
        case 'fade': return { alpha: ease.out(k), scale: 1, dy: 0 };
        case 'slide': return { alpha: ease.out(k), scale: 1, dy: (1 - ease.out(k)) * 90 };
        case 'zoom': return { alpha: ease.out(k), scale: 1.35 - 0.35 * ease.out(k), dy: 0 };
        case 'type': return { alpha: 1, scale: 1, dy: 0, chars: k };
        default: return { alpha: 1, scale: 1, dy: 0 };
      }
    }

    // Text: o.x/o.y = left edge (or centre if align=center) / baseline, o.sx = horizontal stretch.
    // `owner` names where the words come from when o is a shared style (step label, title…).
    function text(str, o, age = 99, owner = null, role = '') {
      if (str == null || str === '') return;
      const a = anim(o, age);
      const shown = a.chars != null ? str.slice(0, Math.ceil(str.length * a.chars)) : str;
      ctx.save();
      ctx.font = `${o.italic ? 'italic ' : ''}${o.bold ? 700 : 400} ${o.size}px ${family(o.font)}`;
      const w = ctx.measureText(str).width * o.sx;
      const center = o.align === 'center' || (o.align == null && o.center);
      const x = center ? o.x - w / 2 : o.x;
      const top = o.y - o.size * 0.74, h = o.size * 0.95;
      ctx.globalAlpha = a.alpha;
      // scale around the text's middle so "pop"/"zoom" grow from the centre
      ctx.translate(x + w / 2, top + h / 2 + a.dy);
      ctx.scale(a.scale, a.scale);
      ctx.translate(-w / 2, -h / 2 + o.size * 0.74);
      ctx.scale(o.sx, 1);
      if (o.shadow) { ctx.shadowColor = o.shadowColor || 'rgba(0,0,0,.5)'; ctx.shadowBlur = o.shadow; ctx.shadowOffsetY = o.shadow * 0.3; }
      if (o.stroke) {
        ctx.lineJoin = 'round'; ctx.lineWidth = o.stroke * 2; ctx.strokeStyle = o.strokeColor || '#ffffff';
        ctx.strokeText(shown, 0, 0);
        ctx.shadowColor = 'transparent';
      }
      ctx.fillStyle = o.color || P.ink;
      ctx.fillText(shown, 0, 0);
      ctx.restore();
      hits.push({ ref: o, kind: 'text', role, owner, x, y: top, w, h });
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      if (r > 0) ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); else ctx.rect(x, y, w, h);
    }
    function cover(img, x, y, w, h, scale = 1) {
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      const s = Math.max(w / iw, h / ih) * scale, dw = iw * s, dh = ih * s;
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    }
    // Picture in a box with optional rounded corners, border, shadow and appear animation.
    function photo(o, file, age = 99, extraScale = 1, blur = 0, owner = null, role = '') {
      const img = image(file);
      const a = anim(o, age);
      ctx.save();
      ctx.globalAlpha = a.alpha;
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2 + a.dy;
      ctx.translate(cx, cy); ctx.scale(a.scale, a.scale); ctx.translate(-o.w / 2, -o.h / 2);
      if (o.shadow) {
        ctx.save();
        ctx.shadowColor = o.shadowColor || 'rgba(0,0,0,.45)'; ctx.shadowBlur = o.shadow; ctx.shadowOffsetY = o.shadow * 0.35;
        roundRect(0, 0, o.w, o.h, o.radius || 0); ctx.fillStyle = P.bg; ctx.fill();
        ctx.restore();
      }
      ctx.save();
      roundRect(0, 0, o.w, o.h, o.radius || 0); ctx.clip();
      if (img) {
        if (blur > 0.3) ctx.filter = `blur(${blur}px)`;
        cover(img, 0, 0, o.w, o.h, extraScale);
      } else if (!exporting) {
        ctx.fillStyle = '#e4e3ee'; ctx.fillRect(0, 0, o.w, o.h);
        ctx.strokeStyle = '#a9a7c4'; ctx.lineWidth = 4; ctx.setLineDash([14, 10]); ctx.strokeRect(2, 2, o.w - 4, o.h - 4); ctx.setLineDash([]);
        ctx.fillStyle = '#7b78a0'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `600 ${Math.round(o.w / 4)}px system-ui, sans-serif`; ctx.fillText('+', o.w / 2, o.h / 2 - o.w / 9);
        ctx.font = `500 ${Math.round(o.w / 10)}px system-ui, sans-serif`; ctx.fillText('добавить фото', o.w / 2, o.h / 2 + o.w / 7);
      }
      ctx.restore();
      if (o.border) {
        roundRect(o.border / 2, o.border / 2, o.w - o.border, o.h - o.border, Math.max(0, (o.radius || 0) - o.border / 2));
        ctx.lineWidth = o.border; ctx.strokeStyle = o.borderColor || P.ink; ctx.stroke();
      }
      ctx.restore();
      hits.push({ ref: o, kind: 'image', role, owner, empty: !img, x: o.x, y: o.y, w: o.w, h: o.h });
    }

    // Crop is stored as fractions of the recording: {x, y, w}; height follows the band's aspect.
    function bandW() { return W - 2 * (P.bandStyle.margin || 0); }
    function cropRect(v, crop) {
      const vw = v.videoWidth, vh = v.videoHeight, aspect = bandW() / P.band.h;
      let w, h, x, y;
      if (crop) { w = crop.w * vw; h = w / aspect; x = crop.x * vw; y = crop.y * vh; }
      else { h = vh; w = h * aspect; if (w > vw) { w = vw; h = w / aspect; } x = 0; y = (vh - h) / 2; }
      w = Math.min(w, vw); h = Math.min(h, vh);
      x = Math.max(0, Math.min(vw - w, x)); y = Math.max(0, Math.min(vh - h, y));
      return { x, y, w, h };
    }
    // The cropped recording goes into bandCache first; styling (corners, border, colour) is applied
    // when the cache is drawn, so a frame held during a seek looks identical.
    function band(src, v) {
      const { y, h } = P.band, bs = P.bandStyle, m = bs.margin || 0, bw = bandW();
      if (v && v.readyState >= 2 && v.videoWidth) {
        const r = cropRect(v, src.crop);
        if (bandCache.width !== bw || bandCache.height !== h) { bandCache.width = bw; bandCache.height = h; }
        bandCache.getContext('2d').drawImage(v, r.x, r.y, r.w, r.h, 0, 0, bw, h);
        bandCacheOk = true;
      }
      ctx.save();
      roundRect(m, y, bw, h, bs.radius || 0); ctx.clip();
      if (bandCacheOk) {
        const f = [];
        if (bs.brightness !== 1) f.push(`brightness(${bs.brightness})`);
        if (bs.contrast !== 1) f.push(`contrast(${bs.contrast})`);
        if (bs.saturate !== 1) f.push(`saturate(${bs.saturate})`);
        if (f.length) ctx.filter = f.join(' ');
        ctx.drawImage(bandCache, m, y, bw, h);
      } else {
        ctx.fillStyle = '#1f2333'; ctx.fillRect(m, y, bw, h);
      }
      ctx.restore();
      if (bs.border) {
        ctx.save();
        roundRect(m + bs.border / 2, y + bs.border / 2, bw - bs.border, h - bs.border, Math.max(0, (bs.radius || 0) - bs.border / 2));
        ctx.lineWidth = bs.border; ctx.strokeStyle = bs.borderColor || P.ink; ctx.stroke();
        ctx.restore();
      }
    }

    function overlayVisible(o, seg) {
      const w = o.where || 'all';
      if (w === 'all') return true;
      if (w === 'intro' || w === 'final') return seg.type === w;
      if (w === 'steps') return seg.type === 'step';
      if (w.startsWith('step:')) return seg.type === 'step' && P.steps[seg.i] && P.steps[seg.i].id === w.slice(5);
      return false;
    }

    function draw(t, v) {
      hits = [];
      const seg = segAt(t), local = t - seg.start;
      ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H);
      if (P.bgImage) { const bi = image(P.bgImage); if (bi) cover(bi, 0, 0, W, H); }
      if (seg.type === 'intro') {
        for (const it of P.intro.items) {
          if (local < it.at) continue;
          if (it.kind === 'text') text(it.text, it, local - it.at, { obj: it, key: 'text' }, 'Текст интро');
          else photo(it, it.file, local - it.at, 1, 0, { obj: it, key: 'file' }, 'Фото интро');
        }
      } else if (seg.type === 'step') {
        const st = P.steps[seg.i], L = P.layout;
        band(st, v);
        text(st.label, L.label, local, { obj: st, key: 'label' }, 'Номер шага (стиль общий для всех шагов)');
        text(st.name, L.name, local, { obj: st, key: 'name' }, 'Название слоя (стиль общий для всех шагов)');
        if (st.note && local >= st.noteFrom && local < st.noteTo) text(st.note, L.note, local - st.noteFrom, { obj: st, key: 'note' }, 'Подпись');
      } else {
        const f = P.final, L = P.layout;
        band(f, v);
        text(f.title, L.finalTitle, local, { obj: f, key: 'title' }, 'Заголовок финала');
        const n = f.images.length;
        const interval = 60 / Math.max(1, f.bpm) * Math.max(0.25, f.beatsPer);
        if (n) {
          const idx = Math.floor(local / interval) % n;
          const k = Math.min(1, (local % interval) / 0.15), e = ease.out(k);
          photo(L.finalImg, f.images[idx], local, f.pop ? 1.1 - 0.1 * e : 1, f.pop ? (1 - e) * 10 : 0, null, 'Обложки финала');
        } else photo(L.finalImg, null, local, 1, 0, null, 'Обложки финала');
      }
      for (const o of P.overlays) {
        if (!overlayVisible(o, seg)) continue;
        const from = o.from || 0;
        if (local < from || (o.to != null && o.to !== '' && local >= o.to)) continue;
        if (o.kind === 'text') text(o.text, o, local - from, { obj: o, key: 'text' }, 'Своя надпись');
        else photo(o, o.file, local - from, 1, 0, { obj: o, key: 'file' }, 'Своя картинка');
      }
      if (!exporting) {
        const sel = selected && hits.find(h => h.ref === selected);
        for (const [h, dash] of [[hover, true], [sel, false]]) {
          if (!h) continue;
          ctx.save(); ctx.strokeStyle = '#6b5cff'; ctx.lineWidth = 4;
          if (dash) ctx.setLineDash([12, 8]);
          ctx.strokeRect(h.x - 6, h.y - 6, h.w + 12, h.h + 12); ctx.restore();
        }
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
    function select(h) {
      selected = h ? h.ref : null;
      listeners.select.forEach(fn => fn(h ? { ref: h.ref, kind: h.kind, role: h.role, owner: h.owner, empty: h.empty } : null));
      requestDraw();
    }
    canvas.addEventListener('pointerdown', (e) => {
      const p = toFrame(e), h = hitAt(p);
      if (exporting) return;
      select(h);
      if (!h) return;
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
      exporting = true; hover = null; select(null);
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
      select(ref) { selected = ref; requestDraw(); },
      hitAtClient(e) { return hitAt(toFrame(e)); },
      toFrame,
      setRecording,
      timeline, segAt, seek, play, stop, record, requestDraw, ensureAudio,
      get time() { return T; },
      get playing() { return playing; },
      get exporting() { return exporting; },
      on(ev, fn) { listeners[ev].push(fn); },
    };
  }

  window.Engine = { create, defaults, migrate, uid, W, H };
})();
