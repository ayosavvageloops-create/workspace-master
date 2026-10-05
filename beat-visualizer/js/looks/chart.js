// chart — a star chart of the notes: every note is a star on a deep-navy sky, voices
// linked by faint slurs, and a translucent light bar sweeps the page and lights them.
(function () {
  const ROLE = { bass: '#a88cff', chords: '#4fe0c8', lead: '#ff9ec4', drums: '#ffd27a', other: '#8fc4ff' };
  const colOf = (p) => ROLE[p.role] || ROLE.other;

  // groups of notes that start together (chords) per part, in time order
  function groupsOf(part) {
    const out = [];
    for (const n of part.notes) {
      const last = out[out.length - 1];
      if (last && Math.abs(last.s - n.s) < 0.03) last.notes.push(n); else out.push({ s: n.s, notes: [n] });
    }
    for (const gr of out) gr.notes.sort((a, b) => a.p - b.p);
    return out;
  }

  // "TITLE · 140 BPM · KEY": only the title shrinks / truncates, both parts share one size
  function footLine(g, S, x, y, max, o) {
    const rest = ' · ' + [`${Math.round(S.bpm)} BPM`, S.meta.key].filter(Boolean).join(' · ');
    const f = U.fit(g, String(S.meta.title || '').toUpperCase(), Math.max(S.unit * 0.06, max - U.textWidth(g, rest, o)), o);
    const tw = U.text(g, f.str, x, y, { ...o, size: f.size });
    U.text(g, rest, x + tw, y, { ...o, size: f.size, max: Math.max(1, max - tw) });
  }

  Looks.register({
    id: 'chart',
    name: 'chart',
    group: 'midi',
    theme: 'dark',
    desc: 'notes as stars on a night chart, lit by a sweeping light bar',
    defaults: { accent: '#c9d6ff', bg: '#0a1838', page: 4, slurs: true, flares: true },
    controls: [
      { key: 'bg', label: 'Sky colour', type: 'color' },
      { key: 'page', label: 'Bars per page', type: 'select', options: [2, 4, 8] },
      { key: 'slurs', label: 'Slur lines', type: 'toggle' },
      { key: 'flares', label: 'Star flares', type: 'toggle' },
    ],
    prepare(S) {
      const { opt } = S;
      // each part gets its own horizontal band of sky (bass lowest), sized by its pitch range
      const parts = S.parts.map((p) => ({ part: p, color: colOf(p), groups: groupsOf(p), lo: p.lo - 2, span: Math.max(8, p.hi - p.lo + 4) }));
      const total = parts.reduce((a, P) => a + P.span, 0) || 1;
      let acc = 0;
      for (const P of parts) { P.b0 = acc / total; acc += P.span; P.b1 = acc / total; }
      // sky: navy glow in the middle, near-black edges (soft → quarter res)
      const sky = U.layer(S.w, S.h, (g, w, h) => {
        g.fillStyle = '#02040a'; g.fillRect(0, 0, w, h);
        const gr = g.createRadialGradient(w * 0.55, h * 0.35, 0, w * 0.55, h * 0.4, Math.max(w, h) * 0.62);
        gr.addColorStop(0, opt.bg); gr.addColorStop(0.55, U.mix(opt.bg, '#02040a', 0.55)); gr.addColorStop(1, '#02040a');
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
        const side = g.createLinearGradient(0, 0, w, 0);
        side.addColorStop(0, 'rgba(1,2,6,0.55)'); side.addColorStop(0.12, 'rgba(1,2,6,0)');
        side.addColorStop(0.88, 'rgba(1,2,6,0)'); side.addColorStop(1, 'rgba(1,2,6,0.55)');
        g.fillStyle = side; g.fillRect(0, 0, w, h);
      }, 0.25);
      // faint background stars: positions precomputed, drawn as tiny squares each frame
      const r = U.rng(S.seed + 11), stars = [];
      for (let i = 0; i < 240; i++) {
        const sz = r();
        stars.push({ x: r() * S.w, y: r() * S.h, s: S.unit * (0.0014 + sz * sz * 0.0028), c: `rgba(200,215,255,${(0.1 + sz * sz * 0.4).toFixed(3)})` });
      }
      return { parts, sky, stars };
    },
    draw(g, S) {
      const { w, h, unit, opt, cache } = S;
      g.drawImage(cache.sky, 0, 0, w, h);
      for (const st of cache.stars) { g.fillStyle = st.c; g.fillRect(st.x, st.y, st.s, st.s); }

      // page geometry
      const x0 = S.pad * 1.1, x1 = w - S.pad * 1.1;
      const y0 = S.portrait ? h * 0.2 : h * 0.14, y1 = Math.min(S.portrait ? h * 0.83 : h * 0.86, S.portrait ? h - unit * 0.23 : h - S.pad * 0.9 - unit * 0.08);
      const origin = (S.A && S.A.beatOffset) || 0;
      const pageLen = S.bar * (+opt.page || 4);
      const pageIdx = Math.floor((S.t - origin) / pageLen);
      const pS = origin + pageIdx * pageLen, pE = pS + pageLen;
      const X = (t) => x0 + ((t - pS) / pageLen) * (x1 - x0);
      let P = null;
      const Y = (p) => y1 - (P.b0 + ((p - P.lo) / P.span) * (P.b1 - P.b0)) * (y1 - y0);
      const now = S.t;
      const r0 = unit * 0.0042;

      // ---- slurs (drawn first, under the stars) ----
      if (opt.slurs) {
        g.lineWidth = Math.max(1, unit * 0.0011);
        for (P of cache.parts) {
          const gs = P.groups;
          for (let i = 0; i < gs.length; i++) {
            const a = gs[i];
            if (a.s >= pE || a.s < pS) continue;
            const lit = a.s <= now;
            // stacked chord voices: one gentle vertical curve through the stack
            if (a.notes.length > 1) {
              const xa = X(a.s);
              g.strokeStyle = U.rgba(P.color, lit ? 0.35 : 0.12);
              g.beginPath();
              g.moveTo(xa, Y(a.notes[0].p));
              for (let k = 1; k < a.notes.length; k++) {
                const ya = Y(a.notes[k - 1].p), yb = Y(a.notes[k].p);
                g.quadraticCurveTo(xa + (k % 2 ? 1 : -1) * unit * 0.006, (ya + yb) / 2, xa, yb);
              }
              g.stroke();
            }
            // slur to the next onset (top voice → top voice, and lowest → lowest for chords)
            const b = gs[i + 1];
            if (!b || b.s >= pE) continue;
            const xa = X(a.s), xb = X(b.s);
            const pairs = a.notes.length > 1 && b.notes.length > 1
              ? [[a.notes[a.notes.length - 1], b.notes[b.notes.length - 1]], [a.notes[0], b.notes[0]]]
              : [[a.notes[a.notes.length - 1], b.notes[b.notes.length - 1]]];
            const litB = b.s <= now;
            g.strokeStyle = U.rgba(P.color, litB ? 0.3 : lit ? 0.18 : 0.08);
            for (const [na, nb] of pairs) {
              const ya = Y(na.p), yb = Y(nb.p);
              const bow = Math.min(unit * 0.018, (xb - xa) * 0.12 + Math.abs(yb - ya) * 0.1);
              g.beginPath();
              g.moveTo(xa, ya);
              g.bezierCurveTo(xa + (xb - xa) * 0.15, Math.min(ya, yb) - bow, xb - (xb - xa) * 0.15, Math.min(ya, yb) - bow, xb, yb);
              g.stroke();
            }
          }
        }
      }

      // ---- stars ----
      let any = false;
      for (P of cache.parts) {
        const notes = Parts.inRange(P.part, pS, pE);
        for (const n of notes) {
          if (n.s < pS) continue;
          any = true;
          const x = X(n.s), y = Y(n.p), lit = n.s <= now;
          const age = (now - n.s) / S.spb;                      // beats since it lit
          const flash = lit ? Math.exp(-age * 0.9) : 0;
          const playing = lit && n.e > now;
          // duration tail: a faint horizontal line with a small end star
          const xe = Math.min(x1, X(n.e));
          if (P.part.role !== 'chords' && xe - x > r0 * 3) {
            g.strokeStyle = U.rgba(P.color, lit ? 0.35 : 0.1);
            g.lineWidth = Math.max(1, unit * 0.001);
            g.beginPath(); g.moveTo(x, y); g.lineTo(xe, y); g.stroke();
            g.fillStyle = U.rgba(P.color, lit ? 0.75 : 0.2);
            g.beginPath(); g.arc(xe, y, r0 * 0.55, 0, U.TAU); g.fill();
          }
          if (!lit) {
            // future: dim, slightly larger soft disc
            g.fillStyle = U.rgba(P.color, 0.13);
            g.beginPath(); g.arc(x, y, r0 * 1.9, 0, U.TAU); g.fill();
            g.fillStyle = U.rgba(P.color, 0.32);
            g.beginPath(); g.arc(x, y, r0 * 0.9, 0, U.TAU); g.fill();
            continue;
          }
          // halo
          const hr = r0 * (2 + 2.5 * flash + (playing ? 0.8 : 0));
          g.fillStyle = U.rgba(P.color, 0.08 + 0.14 * flash);
          g.beginPath(); g.arc(x, y, hr, 0, U.TAU); g.fill();
          // cross flare
          if (opt.flares && (flash > 0.05 || playing)) {
            const k = Math.max(flash, playing ? 0.35 : 0);
            const fl = unit * (0.02 + 0.045 * k);
            g.fillStyle = U.rgba(P.color, 0.25 + 0.45 * k);
            const th = Math.max(1, unit * 0.0013);
            g.fillRect(x - fl, y - th / 2, fl * 2, th);
            g.fillRect(x - th / 2, y - fl * 0.8, th, fl * 1.6);
          }
          g.fillStyle = U.mix(P.color, '#ffffff', 0.35 + 0.5 * flash);
          g.beginPath(); g.arc(x, y, r0 * (1 + 0.5 * flash), 0, U.TAU); g.fill();
        }
      }

      // ---- light bar ----
      const bx = X(now), bw = unit * 0.024;
      const by0 = S.portrait ? h * 0.03 : h * 0.04, by1 = S.portrait ? h - unit * 0.2 : h - S.pad * 0.9 - unit * 0.05;
      const gr = g.createLinearGradient(bx - bw / 2, 0, bx + bw / 2, 0);
      gr.addColorStop(0, 'rgba(190,205,240,0.16)'); gr.addColorStop(0.2, 'rgba(190,205,240,0.07)');
      gr.addColorStop(0.75, 'rgba(190,205,240,0.1)'); gr.addColorStop(1, 'rgba(210,220,250,0.22)');
      g.fillStyle = gr; g.fillRect(bx - bw / 2, by0, bw, by1 - by0);
      g.fillStyle = 'rgba(220,228,255,0.18)';
      g.fillRect(bx + bw / 2 - 1.5, by0, 1.5, by1 - by0);

      // ---- footer ----
      // footer: below the handle strip in portrait; beside it (same baseline) otherwise
      const fy = S.portrait ? h - unit * 0.085 : h - S.pad * 0.9;
      const fmax = S.portrait ? w - S.pad * 2 : w / 2 - S.pad - unit * 0.2;
      const fs = { size: unit * 0.0165, font: U.FONT.MONO, spacing: unit * 0.004 };
      footLine(g, S, S.pad, fy, fmax, { ...fs, color: 'rgba(170,185,220,0.6)' });
      if (!S.portrait) {
        U.text(g, S.timeLabel(2), w - S.pad, fy, { ...fs, color: 'rgba(170,185,220,0.45)', align: 'right', max: fmax });
      }

      if (!any) {
        U.text(g, S.parts.length ? 'silence on this page' : 'no notes · add midi', w / 2, (y0 + y1) / 2,
          { size: unit * 0.018, font: U.FONT.MONO, color: 'rgba(170,185,220,0.45)', spacing: unit * 0.006, align: 'center' });
      }
    },
  });
})();
