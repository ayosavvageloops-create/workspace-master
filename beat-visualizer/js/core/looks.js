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
//   hasMidi         true when parts come from MIDI (false = guessed from audio)
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
    // prepare() cache, keyed on everything that can change its output
    const key = [look.id, w, h, ctx.version, JSON.stringify(opt)].join('|');
    const store = ctx.cacheStore;
    if (look.prepare) {
      if (!store[look.id] || store[look.id].key !== key) store[look.id] = { key, value: look.prepare(S) };
      S.cache = store[look.id].value;
    } else S.cache = null;
    return S;
  }

  function render(g, look, S) {
    g.save();
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none'; g.shadowBlur = 0;
    g.fillStyle = look.theme === 'light' ? '#f4f3ef' : '#08080a';
    g.fillRect(0, 0, S.w, S.h);
    try {
      look.draw(g, S);
    } catch (e) {
      console.error(`look ${look.id} failed`, e);
      g.restore(); g.save();
      U.text(g, `${look.id}: ${e.message}`, S.pad, S.h / 2, { size: 28, font: U.FONT.MONO, color: '#f55' });
    }
    g.restore();
    // Handle watermark (the user's @handle) — bottom centre, inside the safe area.
    if (S.meta.handle) {
      const y = S.portrait ? S.h - S.unit * 0.16 : S.h - S.pad * 0.9;
      U.text(g, S.meta.handle, S.w / 2, y, { size: S.unit * 0.026, font: U.FONT.MONO, align: 'center',
        color: look.theme === 'light' ? 'rgba(20,20,22,0.55)' : 'rgba(255,255,255,0.6)', spacing: 1 });
    }
  }

  window.Looks = { register, get, list, scene, render };
})();
