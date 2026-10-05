// eclipse — a black sun with a rippling, spectrum-driven rim on pale paper; a white moon
// slides across it as the clip (or loop) plays, stepping on chord changes.
(function () {
  Looks.register({
    id: 'eclipse',
    name: 'eclipse',
    group: 'midi',
    theme: 'light',
    desc: 'a moon slides over a rippling black sun as the track plays',
    defaults: { accent: '#141519', bg: '#f1f1ee', motion: 'clip', ripple: 0.6, ghosts: true },
    controls: [
      { key: 'bg', label: 'Paper', type: 'color' },
      { key: 'motion', label: 'Moon travels over', type: 'select', options: [
        { value: 'clip', label: 'whole clip' }, { value: 'loop', label: '8-bar loop' },
        { value: 'chords', label: 'clip, steps on chords' }, { value: 'bar', label: 'each bar' }] },
      { key: 'ripple', label: 'Rim ripple', type: 'range', min: 0, max: 1.5, step: 0.05 },
      { key: 'ghosts', label: 'Ghost orbits', type: 'toggle' },
    ],
    prepare(S) {
      const { w, h, opt } = S;
      const cx = w / 2, cy = S.portrait ? h * 0.445 : h * 0.47;
      const R = S.portrait ? w * 0.315 : h * 0.33;
      // chord-change times (or bar starts when there is no chord part) for the stepped motion
      const ch = S.parts.find((p) => p.role === 'chords');
      const changes = [];
      if (ch) {
        let last = '';
        for (const n of ch.notes) {
          if (changes.length && n.s - changes[changes.length - 1] < 0.05) continue;
          const name = Parts.chordName(Parts.active(ch, n.s + 0.01).map((x) => x.p));
          if (name !== last) { changes.push(n.s); last = name; }
        }
      }
      const bg = U.layer(w, h, (g) => {
        g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
        U.glowBlob(g, cx, cy - h * 0.1, Math.max(w, h) * 0.6, '#ffffff', 0.55);
        // soft grey corona around the sun
        U.glowBlob(g, cx, cy + R * 0.04, R * 1.45, '#8d8f94', 0.22);
        const vg = g.createLinearGradient(0, 0, 0, h);
        vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.035)');
        g.fillStyle = vg; g.fillRect(0, 0, w, h);
      }, 0.25);
      // sun body shading (radial, cached as a pattern-friendly gradient canvas)
      const sun = U.layer(R * 2.4, R * 2.4, (g, lw, lh) => {
        const gr = g.createRadialGradient(lw * 0.42, lh * 0.38, 0, lw / 2, lh / 2, R * 1.15);
        gr.addColorStop(0, '#2c2d33'); gr.addColorStop(0.55, '#1a1b1f'); gr.addColorStop(1, '#0c0c0e');
        g.fillStyle = gr; g.fillRect(0, 0, lw, lh);
      }, 0.5);
      // the moon's soft cast shadow, pre-blurred (a radial falloff around the disc edge)
      const mr = R * 0.86, sr = mr * 1.3;
      const shadow = U.layer(sr * 2, sr * 2, (g) => {
        const gr = g.createRadialGradient(sr, sr, mr * 0.85, sr, sr, sr);
        gr.addColorStop(0, 'rgba(40,42,48,0.24)'); gr.addColorStop(0.35, 'rgba(40,42,48,0.1)'); gr.addColorStop(1, 'rgba(40,42,48,0)');
        g.fillStyle = gr; g.fillRect(0, 0, sr * 2, sr * 2);
      }, 0.25);
      return { cx, cy, R, bg, sun, changes, shadow, sr };
    },
    draw(g, S) {
      const { w, h, unit, opt, cache, A } = S;
      const { cx, cy, R } = cache;
      g.drawImage(cache.bg, 0, 0, w, h);

      // ---- rim from the spectrum ----
      const N = 24, sp = A.spectrum(S.t, N, { min: 40, max: 9000 });
      const pulse = A.pulse(S.t, 'bass', 0.22);
      const rot = S.t * 0.12;
      const amp = opt.ripple * R;
      const rimAt = (a) => {
        // fold the angle so the spectrum wraps around both sides symmetrically
        let u = (((a + rot) % U.TAU) + U.TAU) % U.TAU / Math.PI; if (u > 1) u = 2 - u;
        const f = u * (N - 1), i = Math.floor(f), k = f - i;
        const v = sp[i] * (1 - k) + sp[Math.min(N - 1, i + 1)] * k;
        const scallop = Math.abs(Math.sin(a * 9 + rot * 2 + 0.6 * Math.sin(a * 3)));
        return R * (1 + 0.008 * pulse) + amp * (0.028 * scallop + 0.07 * v * v * (0.4 + 0.6 * scallop));
      };
      g.beginPath();
      const steps = 220;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * U.TAU, r = rimAt(a);
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.closePath();
      g.save();
      g.clip();
      g.drawImage(cache.sun, cx - R * 1.2, cy - R * 1.2, R * 2.4, R * 2.4);
      g.restore();

      // ---- moon position ----
      const origin = (A && A.beatOffset) || 0;
      let k;
      if (opt.motion === 'loop') k = U.fract((S.t - origin) / (S.bar * 8));
      else if (opt.motion === 'bar') k = U.fract((S.t - origin) / S.bar);
      else k = S.prog;
      if (opt.motion === 'chords') {
        // advance in eased steps: each chord change moves the moon to the clip progress at that moment
        const ch = cache.changes;
        let i = -1;
        for (let j = 0; j < ch.length; j++) if (ch[j] <= S.t) i = j; else break;
        if (i >= 0) {
          const tA = ch[i], kA = U.clamp((tA - S.clipStart) / S.clipLen);
          const tB = i + 1 < ch.length ? ch[i + 1] : S.clipStart + S.clipLen;
          const kB = U.clamp((tB - S.clipStart) / S.clipLen);
          k = kA + (kB - kA) * U.easeInOut(U.clamp((S.t - tA) / Math.min(0.6, tB - tA)));
        } else k = 0;
      }
      const mr = R * 0.86;
      const moonX = (q) => cx - R * 1.62 + q * R * 1.52;
      const moonY = (q) => cy + R * 0.02 * q;
      const mx = moonX(k), my = moonY(k);

      // ghost orbits: faint outlines where the moon sat at earlier chord changes
      if (opt.ghosts) {
        g.lineWidth = Math.max(1, unit * 0.001);
        const marks = cache.changes.length ? cache.changes : [];
        let drawn = 0;
        for (let j = marks.length - 1; j >= 0 && drawn < 3; j--) {
          const tm = marks[j];
          if (tm > S.t || tm < S.clipStart) continue;
          const q = opt.motion === 'clip' || opt.motion === 'chords' ? U.clamp((tm - S.clipStart) / S.clipLen) : null;
          if (q == null) break;
          const age = (S.t - tm) / S.bar;
          g.strokeStyle = `rgba(120,122,128,${0.18 * Math.exp(-age * 0.25)})`;
          g.beginPath(); g.arc(moonX(q), moonY(q), mr, 0, U.TAU); g.stroke();
          drawn++;
        }
      }

      // moon with a soft cast shadow
      const sr = cache.sr;
      g.drawImage(cache.shadow, mx - sr + unit * 0.006, my - sr + unit * 0.004, sr * 2, sr * 2);
      const mg = g.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, 0, mx, my, mr);
      mg.addColorStop(0, U.mix(opt.bg, '#ffffff', 0.6)); mg.addColorStop(1, U.mix(opt.bg, '#d8d8d4', 0.35));
      g.fillStyle = mg;
      g.beginPath(); g.arc(mx, my, mr, 0, U.TAU); g.fill();
      g.strokeStyle = 'rgba(150,150,155,0.25)'; g.lineWidth = Math.max(1, unit * 0.001);
      g.stroke();

      // ---- footer ----
      const fy = S.portrait ? h * 0.958 : h - S.pad * 0.7;
      const foot = [String(S.meta.title || '').toUpperCase(), `${Math.round(S.bpm)} BPM`, S.meta.key].filter(Boolean).join(' · ');
      U.text(g, foot, S.pad, fy, { size: unit * 0.0165, font: U.FONT.MONO, color: 'rgba(40,42,48,0.55)', spacing: unit * 0.004 });
      const chord = Parts.chordAt(S.parts, S.t).name;
      if (chord) U.text(g, chord, w - S.pad, fy, { size: unit * 0.0165, font: U.FONT.MONO, color: 'rgba(40,42,48,0.45)', spacing: unit * 0.004, align: 'right' });
    },
  });
})();
