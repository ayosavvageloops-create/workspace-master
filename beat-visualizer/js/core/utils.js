// Shared helpers for looks and core: math, seeded randomness, noise, colour, text.
(function () {
  const TAU = Math.PI * 2;

  const FONT = {
    SANS: 'Inter',
    TIGHT: 'Inter Tight',
    MONO: 'JetBrains Mono',
    PLEX: 'IBM Plex Mono',
    SERIF: 'Instrument Serif',
    PIXEL: 'VT323',
    HAND: 'Caveat',
  };

  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
  const smooth = (e0, e1, x) => { const k = clamp((x - e0) / (e1 - e0)); return k * k * (3 - 2 * k); };
  const fract = (x) => x - Math.floor(x);
  const easeOut = (k) => 1 - Math.pow(1 - clamp(k), 3);
  const easeInOut = (k) => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };

  // Deterministic PRNG (mulberry32).
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Stateless hash of integers -> [0,1).
  function hash(...n) {
    let h = 2166136261;
    for (const v of n) { h ^= (v | 0) + 0x9e3779b9; h = Math.imul(h, 16777619); h ^= h >>> 13; }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function strSeed(s) { let h = 7; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 2654435761); return h >>> 0; }

  // Smooth value noise in 1–3 dimensions, output in [-1, 1].
  function vnoise(x, y = 0, z = 0) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const c = (a, b, d) => hash(xi + a, yi + b, zi + d) * 2 - 1;
    const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u), x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
    const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u), x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
    return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
  }
  function fbm(x, y = 0, z = 0, oct = 4) {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, z * f); n += a; a *= 0.5; f *= 2; }
    return s / n;
  }

  // ---------- colour ----------
  function hexToRgb(hex) {
    hex = String(hex).replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) { return '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join(''); }
  function rgba(hex, a = 1) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
  function mix(h1, h2, k) { const a = hexToRgb(h1), b = hexToRgb(h2); return rgbToHex(lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)); }
  function hsl(h, s, l, a = 1) { return `hsla(${h},${s}%,${l}%,${a})`; }

  // ---------- text ----------
  // Global text controls set by the core around a look's draw():
  //   textScale — multiplies every size; suppress — lower-case needles whose texts are skipped.
  const T = { scale: 1, suppress: null };
  function font(size, family = FONT.SANS, weight = 400, style = '') {
    size *= T.scale;
    return `${style} ${weight} ${Math.round(size)}px "${family}", ${family === FONT.MONO || family === FONT.PLEX ? 'monospace' : 'sans-serif'}`.trim();
  }
  // Draws text with optional letter spacing; returns its width.
  // o.max: maximum width — the text first shrinks (down to 75%), then is cut with an ellipsis.
  function text(g, str, x, y, o = {}) {
    str = String(str ?? '');
    if (T.suppress && str) {
      const low = str.toLowerCase();
      // contains a needle, or is a shortened ("…") start of one (looks fit long titles before drawing)
      const cut = low.replace(/[….\s]+$/, '');
      // …or a wrapped line of one (a fragment of at least 6 characters that the needle contains)
      if (T.suppress.some((n) => low.includes(n) || (cut.length >= 4 && low !== cut && n.startsWith(cut)) || (cut.trim().length >= 6 && n.includes(cut.trim())))) return 0;
    }
    if (o.max > 0 && str) {
      const fitted = fit(g, str, o.max, o);
      if (fitted.str !== str || fitted.size !== o.size) { o = { ...o, size: fitted.size, max: 0 }; str = fitted.str; }
    }
    g.save();
    g.font = font(o.size || 24, o.font || FONT.SANS, o.weight || 400, o.style || '');
    g.fillStyle = o.color || '#000';
    g.textBaseline = o.baseline || 'alphabetic';
    if (o.alpha != null) g.globalAlpha *= o.alpha;
    const ls = (o.spacing || 0) * T.scale;
    let w;
    if (ls && 'letterSpacing' in g) {
      g.letterSpacing = `${ls}px`;
      w = g.measureText(str).width;
      g.textAlign = 'left';
      const x0 = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
      g.fillText(str, x0, y);
    } else if (ls) {
      w = 0;
      for (const ch of str) w += g.measureText(ch).width + ls;
      let cx = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
      g.textAlign = 'left';
      for (const ch of str) { g.fillText(ch, cx, y); cx += g.measureText(ch).width + ls; }
    } else {
      g.textAlign = o.align || 'left';
      w = g.measureText(str).width;
      g.fillText(str, x, y);
    }
    g.restore();
    return w;
  }
  // Width of `str` as text() would draw it (letter spacing included).
  function textWidth(g, str, o = {}) {
    g.save();
    g.font = font(o.size || 24, o.font || FONT.SANS, o.weight || 400, o.style || '');
    let w = g.measureText(str).width;
    if (o.spacing) w += o.spacing * T.scale * [...str].length;
    g.restore();
    return w;
  }
  // Fits `str` into `max` px: shrinks the size down to 75%, then truncates with an ellipsis.
  function fit(g, str, max, o = {}) {
    let size = o.size || 24;
    let w = textWidth(g, str, { ...o, size });
    if (w <= max) return { str, size, width: w };
    size = Math.max(size * 0.75, size * (max / w));
    w = textWidth(g, str, { ...o, size });
    if (w <= max) return { str, size, width: w };
    let cut = [...str];
    while (cut.length > 1 && textWidth(g, cut.join('').trimEnd() + '…', { ...o, size }) > max) cut.pop();
    const out = cut.join('').trimEnd() + '…';
    return { str: out, size, width: textWidth(g, out, { ...o, size }) };
  }
  function measure(g, str, size, family = FONT.SANS, weight = 400) {
    g.save(); g.font = font(size, family, weight); const w = g.measureText(String(str)).width; g.restore(); return w;
  }

  function rrect(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // Soft radial blob (for pastel backgrounds and glows).
  function glowBlob(g, x, y, r, color, a = 1) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rgba(color, a));
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Film grain overlay drawn from a cached noise tile; `seed` changes per frame.
  const grainTiles = {};
  function grain(g, w, h, amount = 0.05, seed = 0, dark = false) {
    const key = dark ? 'd' : 'l';
    if (!grainTiles[key]) {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const cx = c.getContext('2d'), im = cx.createImageData(256, 256), r = rng(dark ? 3 : 7);
      for (let i = 0; i < im.data.length; i += 4) {
        const v = r() * 255;
        im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255;
      }
      cx.putImageData(im, 0, 0);
      grainTiles[key] = c;
    }
    g.save();
    g.globalAlpha = amount;
    g.globalCompositeOperation = 'overlay';
    const ox = Math.floor(hash(seed) * 256), oy = Math.floor(hash(seed, 1) * 256);
    g.translate(-ox, -oy);
    g.fillStyle = g.createPattern(grainTiles[key], 'repeat');
    g.fillRect(0, 0, w + 256, h + 256);
    g.restore();
  }

  // Off-screen layer for static artwork (backgrounds, grids). Build it in a look's
  // prepare() and blit with g.drawImage(layer, 0, 0, w, h) every frame.
  function layer(w, h, paint, scale = 1) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
    const cg = c.getContext('2d');
    cg.scale(scale, scale);
    paint(cg, w, h);
    return c;
  }

  // ---------- music ----------
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = (p, octave = true) => NOTE_NAMES[((p % 12) + 12) % 12] + (octave ? Math.floor(p / 12) - 1 : '');
  const fmtTime = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const fmtTime2 = (s) => { s = Math.max(0, Math.floor(s)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

  // Parses "loversrock 136 emin.wav" -> { title, bpm, key }.
  function parseFilename(name) {
    let base = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
    let bpm = null, key = null;
    const bm = base.match(/(?:^|[\s\-])(\d{2,3})\s*(?:bpm)?(?=[\s\-]|$)/i);
    if (bm && +bm[1] >= 50 && +bm[1] <= 220) { bpm = +bm[1]; base = base.replace(bm[0], ' '); }
    const km = base.match(/(?:^|[\s\-])([a-g])(#|b|s|sharp|flat)?\s*(maj(?:or)?|min(?:or)?|m)?(?=[\s\-]|$)/i);
    if (km) {
      let k = km[1].toUpperCase();
      const acc = (km[2] || '').toLowerCase();
      if (acc === '#' || acc === 's' || acc === 'sharp') k += '#';
      if (acc === 'b' || acc === 'flat') k += 'b';
      if (/^m(in)?/i.test(km[3] || '') && !/^maj/i.test(km[3] || '')) k += 'm';
      key = k;
      base = base.replace(km[0], ' ');
    }
    const title = base.replace(/[\s\-]+/g, ' ').trim() || name;
    return { title, bpm, key };
  }

  window.U = {
    T,
    TAU, FONT, clamp, lerp, invLerp, smooth, fract, easeOut, easeInOut,
    rng, hash, strSeed, vnoise, fbm,
    hexToRgb, rgbToHex, rgba, mix, hsl,
    font, text, textWidth, fit, measure, rrect, glowBlob, grain, layer,
    NOTE_NAMES, noteName, fmtTime, fmtTime2, parseFilename,
  };
})();
