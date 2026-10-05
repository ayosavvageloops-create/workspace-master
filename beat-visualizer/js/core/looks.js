// Look registry and the per-frame scene every look draws from.
//
// Looks.register({
//   id: 'scope', name: 'scope', group: 'audio' | 'midi', theme: 'dark' | 'light',
//   desc: 'one line shown in the picker',
//   defaults: { accent: '#c8f560', ... },          // option values (accent is required)
//   controls: [{ key, label, type: 'color'|'range'|'select'|'toggle'|'text', min, max, step, options }],
//   prepare(S) { return cache },                    // optional; re-run when inputs change
//   draw(g, S) { ... },                             // must be a pure function of S (time included)
// })
//
// Scene S (read-only for looks):
//   w, h            logical canvas size (e.g. 1080×1920); everything is drawn in these units
//   portrait        h > w;  unit = min(w, h);  pad = outer margin (~5% of unit)
//   t               absolute track time (s);  ct = t - clipStart;  clipLen;  prog = ct / clipLen (0..1)
//   A               audio analysis (see analysis.js)
//   parts           enabled parts (see midi.js), ordered bass, chords, lead, other
//   hasMidi         true when parts come from MIDI (false = found in the audio)
//   A.beatOffset    origin of the bar grid (MIDI offset, or the detected first beat); use it for bars
//   meta            { title, bpm, key, handle }
//   opt             merged option values for this look; accent = opt.accent
//   frame, fps      frame index and frame rate (use frame for grain/flicker seeds)
//   cache           whatever prepare() returned
//   spb, bar        seconds per beat / per 4-beat bar
//   sub             'BPM · KEY' string, e.g. '102 BPM · D'
//   timeLabel(fmt)  '0:02 / 0:18' (fmt 2 → '00:02 / 00:18')
//   seed            stable integer seed for this look+track
(function () {
  const list = [];
  const ROLE_ORDER = { bass: 0, chords: 1, lead: 2, drums: 3, other: 4 };

  function register(def) {
    if (!def.id || !def.draw) throw new Error('look needs id and draw');
    def.name = def.name || def.id;
    def.group = def.group || 'audio';
    def.theme = def.theme || 'dark';
    def.defaults = Object.assign({ accent: '#ff4d2e' }, def.defaults || {});
    def.controls = def.controls || [];
    const i = list.findIndex((l) => l.id === def.id);
    if (i >= 0) list[i] = def; else list.push(def);
    return def;
  }
  const get = (id) => list.find((l) => l.id === id);

  // Builds a scene. `ctx` = { A, parts, meta, w, h, clipStart, clipLen, fps, opt, cacheStore }
  function scene(look, ctx, t, frame) {
    const { w, h } = ctx;
    const unit = Math.min(w, h);
    const bpm = (ctx.A && ctx.A.bpm) || ctx.meta.bpm || 120;
    const parts = (ctx.parts || []).filter((p) => p.enabled).sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9));
    const opt = Object.assign({}, look.defaults, (ctx.opt && ctx.opt[look.id]) || {});
    const ct = t - ctx.clipStart;
    const S = {
      w, h, unit, portrait: h > w, pad: Math.round(unit * 0.05),
      t, ct, clipStart: ctx.clipStart, clipLen: ctx.clipLen, prog: Math.max(0, Math.min(1, ct / ctx.clipLen)),
      A: ctx.A, parts, allParts: ctx.parts || [], hasMidi: parts.some((p) => p.source === 'midi'),
      meta: ctx.meta, opt, accent: opt.accent,
      frame: frame || 0, fps: ctx.fps || 60,
      spb: 60 / bpm, bar: 240 / bpm, bpm,
      sub: [`${Math.round(bpm)} BPM`, ctx.meta.key].filter(Boolean).join(' · '),
      seed: U.strSeed(look.id + (ctx.meta.title || '')),
      timeLabel(fmt) {
        const f = fmt === 2 ? U.fmtTime2 : U.fmtTime;
        return `${f(Math.max(0, ct))} / ${f(ctx.clipLen)}`;
      },
    };
    S.layout = layoutOf(ctx);
    S.safe = safeRect(w, h, S.layout.safe.platform);
    S.grid = gridOf(S.safe, S.layout.grid.cols);
    // prepare() cache, keyed on everything that can change its output
    const key = [look.id, w, h, ctx.version, JSON.stringify(opt)].join('|');
    const store = ctx.cacheStore;
    if (look.prepare) {
      if (!store[look.id] || store[look.id].key !== key) store[look.id] = { key, value: look.prepare(S) };
      S.cache = store[look.id].value;
    } else S.cache = null;
    return S;
  }

  // ---------- layout: safe zones, grid, text layer ----------
  // Platform UI covers these fractions of a 9:16 frame [top, right, bottom, left]; other formats
  // get a uniform title-safe margin.
  const SAFE_ZONES = {
    reels: [0.14, 0.13, 0.22, 0.05],
    tiktok: [0.10, 0.15, 0.24, 0.05],
    shorts: [0.12, 0.14, 0.24, 0.05],
    youtube: [0.05, 0.05, 0.05, 0.05],
    off: [0.04, 0.04, 0.04, 0.04],
  };
  const DEFAULT_LAYOUT = {
    mode: 'look',            // 'look' = the look's own text, 'mine' = my text layer only, 'both'
    lookScale: 1,            // size of the look's own text
    font: 'Inter Tight', weight: 600, detailFont: 'JetBrains Mono', color: '', upper: false, spacing: 0, backdrop: 'none',
    items: {
      title: { on: true, size: 1, anchor: 'tl', dx: 0, dy: 0 },
      sub: { on: true, size: 1, anchor: 'tl', dx: 0, dy: 1.5, text: '{bpm} BPM · {key}' },
      handle: { on: true, size: 1, anchor: 'bc', dx: 0, dy: 0 },
    },
    grid: { show: false, snap: true, cols: 12 },
    safe: { platform: 'reels', show: true, fit: false },
  };
  function layoutOf(ctx) {
    const L = ctx.layout || {};
    const d = DEFAULT_LAYOUT;
    return {
      ...d, ...L,
      items: { title: { ...d.items.title, ...(L.items && L.items.title) }, sub: { ...d.items.sub, ...(L.items && L.items.sub) }, handle: { ...d.items.handle, ...(L.items && L.items.handle) } },
      grid: { ...d.grid, ...(L.grid || {}) }, safe: { ...d.safe, ...(L.safe || {}) },
    };
  }
  // Safe rectangle for the current format and platform.
  function safeRect(w, h, platform) {
    const tall = h / w > 1.7;
    const m = tall ? (SAFE_ZONES[platform] || SAFE_ZONES.off) : platform === 'off' ? SAFE_ZONES.off : SAFE_ZONES.youtube;
    const x = Math.round(w * m[3]), y = Math.round(h * m[0]);
    return { x, y, w: Math.round(w * (1 - m[1] - m[3])), h: Math.round(h * (1 - m[0] - m[2])) };
  }
  function gridOf(rect, cols) {
    const unit = rect.w / cols;
    return { ...rect, cols, unit, rows: Math.floor(rect.h / unit) };
  }
  // Anchor point of a 3×3 position inside the safe rect.
  function anchorPoint(G, anchor) {
    const v = anchor[0], hz = anchor[1];
    return {
      x: hz === 'l' ? G.x : hz === 'r' ? G.x + G.w : G.x + G.w / 2,
      y: v === 't' ? G.y : v === 'b' ? G.y + G.h : G.y + G.h / 2,
      align: hz === 'l' ? 'left' : hz === 'r' ? 'right' : 'center', v,
    };
  }

  // Draws the user's text layer; returns the boxes of each item (for dragging in the preview).
  function drawTextLayer(g, look, S, L) {
    const G = S.grid, boxes = {};
    const auto = look.theme === 'light' ? '#141416' : '#f4f4f0';
    const color = L.color || auto;
    const fill = (str) => (L.upper ? str.toUpperCase() : str);
    const bpm = Math.round(S.bpm);
    const subText = String(L.items.sub.text || '').replace(/\{bpm\}/gi, bpm).replace(/\{key\}/gi, S.meta.key || '').replace(/\{title\}/gi, S.meta.title || '')
      .replace(/\s*·\s*$/, '').replace(/^\s*·\s*/, '');
    const items = [
      ['title', S.meta.title, { size: S.unit * 0.062, font: L.font, weight: L.weight, alpha: 1 }],
      ['sub', subText, { size: S.unit * 0.024, font: L.detailFont, weight: 400, alpha: 0.7 }],
      ['handle', S.meta.handle, { size: S.unit * 0.026, font: L.detailFont, weight: 400, alpha: 0.75 }],
    ];
    const saved = U.T.scale; U.T.scale = 1;
    for (const [key, raw, base] of items) {
      const it = L.items[key];
      if (!it.on || !raw) continue;
      const size = base.size * it.size;
      const o = { size, font: base.font, weight: base.weight, color, spacing: L.spacing * size * 0.02 };
      const p = anchorPoint(G, it.anchor);
      let x = p.x + it.dx * G.unit, y = p.y + it.dy * G.unit;
      // fit the text into the safe width that remains on its side of the anchor
      const room = p.align === 'left' ? G.x + G.w - x : p.align === 'right' ? x - G.x : 2 * Math.min(x - G.x, G.x + G.w - x);
      const pillPad = L.backdrop === 'pill' ? size * 0.9 : 0;
      const f = U.fit(g, fill(String(raw)), Math.max(size, Math.min(G.w, room) - pillPad), o);
      const tw = f.width, sz = f.size;
      // vertical: top anchor hangs the text below y, bottom sits it above y, middle centres it
      const asc = sz * 0.78, desc = sz * 0.24;
      let base_y = p.v === 't' ? y + asc : p.v === 'b' ? y - desc : y + (asc - desc) / 2;
      let left = p.align === 'left' ? x : p.align === 'right' ? x - tw : x - tw / 2;
      // never leave the safe rect (a pill backdrop counts as part of the text)
      const ix = L.backdrop === 'pill' ? sz * 0.45 : 0, iy = L.backdrop === 'pill' ? sz * 0.28 : 0;
      left = Math.max(G.x + ix, Math.min(G.x + G.w - tw - ix, left));
      base_y = Math.max(G.y + asc + iy, Math.min(G.y + G.h - desc - iy, base_y));
      if (L.backdrop === 'pill') {
        const px = sz * 0.45, py = sz * 0.28;
        g.save();
        g.fillStyle = U.rgba(look.theme === 'light' ? '#ffffff' : '#000000', 0.62);
        U.rrect(g, left - px, base_y - asc - py, tw + px * 2, asc + desc + py * 2, (asc + desc + py * 2) / 2);
        g.fill();
        g.restore();
      }
      g.save();
      if (L.backdrop === 'shadow') { g.shadowColor = look.theme === 'light' ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.75)'; g.shadowBlur = sz * 0.5; }
      U.text(g, f.str, left, base_y, { ...o, size: sz, align: 'left', alpha: base.alpha });
      g.restore();
      boxes[key] = { x: left, y: base_y - asc, w: tw, h: asc + desc };
    }
    U.T.scale = saved;
    return boxes;
  }

  function render(g, look, S) {
    const L = S.layout;
    g.save();
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none'; g.shadowBlur = 0;
    g.fillStyle = S.opt.bg || (look.theme === 'light' ? '#f4f3ef' : '#08080a');
    g.fillRect(0, 0, S.w, S.h);
    // optionally shrink the whole look into the safe zone, background filling the margins
    if (L && L.safe.fit && L.safe.platform !== 'off') {
      const R = S.safe, k = Math.min(R.w / S.w, R.h / S.h);
      g.translate(R.x + (R.w - S.w * k) / 2, R.y + (R.h - S.h * k) / 2);
      g.scale(k, k);
      g.beginPath(); g.rect(0, 0, S.w, S.h); g.clip();
    }
    // the look's own text: size multiplier, and titles hidden when my text layer replaces them
    U.T.scale = L ? L.lookScale : 1;
    if (L && L.mode === 'mine') {
      const needles = [];
      if (S.meta.title && S.meta.title.trim().length >= 2) needles.push(S.meta.title.trim().toLowerCase());
      needles.push(`${Math.round(S.bpm)} bpm`);
      if (S.meta.handle) needles.push(S.meta.handle.toLowerCase());
      U.T.suppress = needles;
    }
    try {
      look.draw(g, S);
    } catch (e) {
      console.error(`look ${look.id} failed`, e);
      g.restore(); g.save();
      U.text(g, `${look.id}: ${e.message}`, S.pad, S.h / 2, { size: 28, font: U.FONT.MONO, color: '#f55' });
    } finally {
      U.T.scale = 1; U.T.suppress = null;
    }
    g.restore();
    if (L && L.mode !== 'look') {
      S.textBoxes = drawTextLayer(g, look, S, L);
    } else if (S.meta.handle) {
      // Handle watermark (the user's @handle) — bottom centre, inside the safe area.
      const y = S.portrait ? S.h - S.unit * 0.16 : S.h - S.pad * 0.9;
      U.text(g, S.meta.handle, S.w / 2, y, { size: S.unit * 0.026, font: U.FONT.MONO, align: 'center',
        color: look.theme === 'light' ? 'rgba(20,20,22,0.55)' : 'rgba(255,255,255,0.6)', spacing: 1, max: S.w - S.pad * 2 });
    }
  }

  // Preview-only guides: red unsafe zones and the layout grid (never exported).
  function drawGuides(g, S, opts = {}) {
    const L = S.layout, R = S.safe, G = S.grid;
    if (!L) return;
    g.save();
    if (L.safe.show && L.safe.platform !== 'off') {
      g.fillStyle = 'rgba(255, 40, 40, 0.18)';
      g.beginPath();
      g.rect(0, 0, S.w, S.h);
      g.rect(R.x, R.y, R.w, R.h);
      g.fill('evenodd');
      g.setLineDash([14, 10]); g.lineWidth = 3; g.strokeStyle = 'rgba(255, 50, 50, 0.9)';
      g.strokeRect(R.x, R.y, R.w, R.h);
      g.setLineDash([]);
    }
    if (L.grid.show) {
      g.lineWidth = 1.5;
      for (let c = 0; c <= G.cols; c++) {
        g.strokeStyle = c === 0 || c === G.cols || c === G.cols / 2 ? 'rgba(0, 200, 255, 0.55)' : 'rgba(0, 200, 255, 0.22)';
        g.beginPath(); g.moveTo(G.x + c * G.unit, G.y); g.lineTo(G.x + c * G.unit, G.y + G.h); g.stroke();
      }
      for (let r = 0; r <= G.rows; r++) {
        g.strokeStyle = 'rgba(0, 200, 255, 0.18)';
        g.beginPath(); g.moveTo(G.x, G.y + r * G.unit); g.lineTo(G.x + G.w, G.y + r * G.unit); g.stroke();
      }
      g.strokeStyle = 'rgba(0, 200, 255, 0.55)';
      g.beginPath(); g.moveTo(G.x, G.y + G.h / 2); g.lineTo(G.x + G.w, G.y + G.h / 2); g.stroke();
    }
    if (S.textBoxes && opts.highlight !== undefined) {
      for (const [k, b] of Object.entries(S.textBoxes)) {
        const on = k === opts.highlight;
        if (!on && !L.grid.show) continue;
        g.setLineDash(on ? [] : [6, 6]); g.lineWidth = on ? 3 : 1.5; g.strokeStyle = on ? 'rgba(0, 200, 255, 0.95)' : 'rgba(0, 200, 255, 0.5)';
        g.strokeRect(b.x - 8, b.y - 8, b.w + 16, b.h + 16);
      }
      g.setLineDash([]);
    }
    g.restore();
  }

  window.Looks = { register, get, list, scene, render, drawGuides, anchorPoint, layoutOf, DEFAULT_LAYOUT, SAFE_ZONES };
})();
