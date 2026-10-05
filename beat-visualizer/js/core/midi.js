// Standard MIDI File parser and the "parts" model looks draw from.
//
// A part: { id, name, role: 'bass'|'chords'|'lead'|'drums'|'other', color, enabled,
//           notes: [{ p, v, s, e }] sorted by start (seconds, velocity 0..1),
//           lo, hi (pitch range), source: 'midi'|'audio' }
// Parts helpers (window.Parts):
//   Parts.fromMidiFile(arrayBuffer, filename) -> parts[]
//   Parts.fromAudio(A) -> parts[] guessed from the audio (used when no MIDI)
//   Parts.active(part, t) -> notes sounding at t
//   Parts.inRange(part, t0, t1) -> notes overlapping [t0, t1)
//   Parts.chordAt(parts, t) -> { name, notes } best-guess chord symbol at t
(function () {
  function parseSMF(buf) {
    const d = new DataView(buf);
    let p = 0;
    const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(d.getUint8(p + i)); p += n; return s; };
    const u32 = () => { const v = d.getUint32(p); p += 4; return v; };
    const u16 = () => { const v = d.getUint16(p); p += 2; return v; };
    const vlq = () => { let v = 0, b; do { b = d.getUint8(p++); v = (v << 7) | (b & 127); } while (b & 128); return v; };

    if (str(4) !== 'MThd') throw new Error('Not a MIDI file');
    const hlen = u32(), format = u16(), ntrk = u16(), division = u16();
    p += hlen - 6;
    if (division & 0x8000) throw new Error('SMPTE time division is not supported');
    const ppq = division;

    const tracks = [], tempos = [];
    let timeSig = [4, 4];
    for (let ti = 0; ti < ntrk && p < d.byteLength; ti++) {
      const id = str(4), len = u32(), end = p + len;
      if (id !== 'MTrk') { p = end; continue; }
      let tick = 0, status = 0, name = '';
      const on = new Map(), notes = [];
      let channel = -1;
      while (p < end) {
        tick += vlq();
        let b = d.getUint8(p);
        if (b & 0x80) { status = b; p++; } else if (status < 0x80) break;
        const type = status & 0xf0, ch = status & 0x0f;
        if (status === 0xff) {
          const mt = d.getUint8(p++), ml = vlq(), mp = p;
          if (mt === 0x03) { p = mp; name = str(ml); }
          if (mt === 0x51) tempos.push({ tick, uspq: (d.getUint8(mp) << 16) | (d.getUint8(mp + 1) << 8) | d.getUint8(mp + 2) });
          if (mt === 0x58) timeSig = [d.getUint8(mp), Math.pow(2, d.getUint8(mp + 1))];
          p = mp + ml;
          if (mt === 0x2f) break;
          status = 0;
        } else if (status === 0xf0 || status === 0xf7) {
          p += vlq(); status = 0;
        } else if (type === 0x90 || type === 0x80) {
          const note = d.getUint8(p++), vel = d.getUint8(p++);
          const key = ch * 128 + note;
          channel = ch;
          if (type === 0x90 && vel > 0) {
            if (on.has(key)) { const o = on.get(key); notes.push({ p: note, v: o.v, s: o.tick, e: tick, ch }); }
            on.set(key, { tick, v: vel / 127 });
          } else if (on.has(key)) {
            const o = on.get(key); on.delete(key);
            notes.push({ p: note, v: o.v, s: o.tick, e: Math.max(tick, o.tick + 1), ch });
          }
        } else if (type === 0xc0 || type === 0xd0) p += 1;
        else p += 2;
      }
      for (const [key, o] of on) notes.push({ p: key % 128, v: o.v, s: o.tick, e: tick, ch: Math.floor(key / 128) });
      p = end;
      tracks.push({ name, notes, channel });
    }

    // tick -> seconds through the tempo map
    tempos.sort((a, b) => a.tick - b.tick);
    if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, uspq: 500000 });
    const segs = [];
    let sec = 0;
    for (let i = 0; i < tempos.length; i++) {
      segs.push({ tick: tempos[i].tick, sec, spt: tempos[i].uspq / 1e6 / ppq });
      if (i + 1 < tempos.length) sec += (tempos[i + 1].tick - tempos[i].tick) * tempos[i].uspq / 1e6 / ppq;
    }
    const toSec = (tk) => { let s = segs[0]; for (const g of segs) { if (g.tick <= tk) s = g; else break; } return s.sec + (tk - s.tick) * s.spt; };
    for (const t of tracks) for (const n of t.notes) { n.s = toSec(n.s); n.e = toSec(n.e); }
    const bpm = 60e6 / tempos[0].uspq;
    return { format, ppq, bpm, timeSig, tracks: tracks.filter((t) => t.notes.length) };
  }

  const ROLE_COLORS = { bass: '#8b6cf6', chords: '#2fc6a8', lead: '#f2683c', drums: '#f2c14e', other: '#5aa9e6' };
  let uid = 0;

  function guessRole(notes, name) {
    const n = (name || '').toLowerCase();
    if (/bass|808|sub/.test(n)) return 'bass';
    if (/chord|pad|keys|piano|stab/.test(n)) return 'chords';
    if (/lead|melod|vox|vocal|hook|pluck|arp/.test(n)) return 'lead';
    if (/drum|kick|snare|hat|perc/.test(n)) return 'drums';
    if (notes.length && notes.every((x) => x.ch === 9)) return 'drums';
    const mean = notes.reduce((a, x) => a + x.p, 0) / Math.max(1, notes.length);
    let overl = 0;
    for (let i = 0; i < notes.length; i++) {
      for (let j = i + 1; j < notes.length && notes[j].s < notes[i].e; j++) if (Math.abs(notes[j].s - notes[i].s) < 0.03) { overl++; break; }
    }
    if (overl / Math.max(1, notes.length) > 0.35) return 'chords';
    return mean < 50 ? 'bass' : 'lead';
  }

  function makePart(notes, name, role, source) {
    notes = notes.map((x) => ({ p: x.p, v: x.v ?? 0.8, s: x.s, e: x.e })).sort((a, b) => a.s - b.s || a.p - b.p);
    let lo = 127, hi = 0;
    for (const x of notes) { lo = Math.min(lo, x.p); hi = Math.max(hi, x.p); }
    return { id: 'p' + uid++, name: name || role, role, color: ROLE_COLORS[role] || ROLE_COLORS.other, enabled: true,
             notes, lo: notes.length ? lo : 48, hi: notes.length ? hi : 72, source };
  }

  function fromMidiFile(buf, filename = '') {
    const smf = parseSMF(buf);
    const base = filename.replace(/\.[^.]+$/, '');
    const single = smf.tracks.length === 1;
    const parts = smf.tracks.map((t) => {
      const name = (single ? base : t.name) || t.name || base;
      const role = guessRole(t.notes, single ? base + ' ' + t.name : t.name || base);
      return makePart(t.notes, cleanName(name, role), role, 'midi');
    });
    parts.bpm = smf.bpm;
    return parts;
  }
  function cleanName(name, role) {
    const n = (name || '').trim().toLowerCase();
    if (!n || n.length > 24) return role;
    return n;
  }

  // ---------- guessing parts from audio ----------
  // Builds bass, chords and lead parts from the mix alone, snapped to the beat grid, so
  // every MIDI look has something musical to draw when no MIDI is loaded.
  const hzToMidi = (f) => 69 + 12 * Math.log2(f / 440);

  // Harmonic-sum pitch estimate within [lo, hi] Hz on a linear spectrum. Returns { midi, salience }.
  function pitchOf(mag, sr, size, lo, hi, harmonics = 4) {
    const hz = sr / size;
    let best = 0, bf = 0;
    for (let k = Math.max(1, Math.floor(lo / hz)); k <= Math.ceil(hi / hz) && k < mag.length; k++) {
      let s = 0;
      for (let h = 1; h <= harmonics; h++) {
        const j = Math.round(k * h);
        if (j >= mag.length) break;
        s += Math.max(mag[j - 1] || 0, mag[j], mag[j + 1] || 0) / h;
      }
      if (s > best) { best = s; bf = k; }
    }
    if (!bf) return null;
    // parabolic refinement of the fundamental bin
    const a = mag[bf - 1] || 0, b = mag[bf], c = mag[bf + 1] || 0, d = a - 2 * b + c;
    const off = d ? 0.5 * (a - c) / d : 0;
    return { midi: hzToMidi((bf + Math.max(-0.5, Math.min(0.5, off))) * hz), salience: best };
  }

  const CHORD_SHAPES = [
    ['', [0, 4, 7]], ['m', [0, 3, 7]], ['7', [0, 4, 7, 10]], ['maj7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]],
  ];

  function fromAudio(A) {
    const spb = 60 / A.bpm, six = spb / 4, off = A.detectedOffset != null ? A.detectedOffset : A.beatOffset;
    const q = (t) => off + Math.round((t - off) / six) * six;
    const dur = A.dur, sr = A.sr;

    // ---- bass: one note per low-end onset, pitch from a harmonic sum over 30–250 Hz ----
    const bass = [];
    const bassOn = A.onsets.bass.filter((o) => o.s > 0.1);
    for (let i = 0; i < bassOn.length; i++) {
      const s = q(bassOn[i].t);
      if (bass.length && s - bass[bass.length - 1].s < six * 0.5) continue;
      const mag = A.fft(bassOn[i].t + 0.07, 8192);
      const pt = pitchOf(mag, sr, 8192, 30, 130, 4);
      if (!pt) continue;
      let p = Math.round(pt.midi);
      while (p < 28) p += 12;
      while (p > 52) p -= 12;
      // the note lasts while the low band holds (at most until the next onset or 2 beats)
      const lvl0 = A.band(bassOn[i].t + 0.03, 'bass') + A.band(bassOn[i].t + 0.03, 'sub');
      const next = i + 1 < bassOn.length ? q(bassOn[i + 1].t) : s + spb * 2;
      let e = s + six;
      while (e < Math.min(next, s + spb * 2) && A.band(e, 'bass') + A.band(e, 'sub') > lvl0 * 0.45) e += six / 2;
      e = Math.max(s + six, Math.min(q(e), next));
      bass.push({ p, v: Math.min(1, 0.45 + bassOn[i].s * 0.6), s, e: e - 0.01 });
    }

    // ---- chords: chroma per beat, smoothed over half bars, matched to chord templates ----
    const chords = [];
    const nBeats = Math.floor((dur - off) / spb);
    const chromaAt = (t) => {
      const mag = A.fft(t, 8192), hz = sr / 8192, ch = new Float32Array(12);
      for (let k = Math.floor(110 / hz); k < Math.min(mag.length, 1800 / hz); k++) {
        const m = Math.round(hzToMidi(k * hz));
        ch[((m % 12) + 12) % 12] += mag[k] * mag[k];
      }
      return ch;
    };
    const beatChroma = [];
    for (let b = 0; b < nBeats; b++) beatChroma.push(chromaAt(off + (b + 0.5) * spb));
    const seg = [];
    for (let b = 0; b + 1 < nBeats; b += 2) {
      const ch = new Float32Array(12);
      for (let k = 0; k < 12; k++) ch[k] = beatChroma[b][k] + beatChroma[b + 1][k];
      let norm = Math.hypot(...ch);
      if (norm < 1e-9) { seg.push(null); continue; }
      let best = null;
      for (let root = 0; root < 12; root++) {
        for (const [name, iv] of CHORD_SHAPES) {
          const tpl = new Float32Array(12);
          iv.forEach((x, i) => { tpl[(root + x) % 12] = i === 0 ? 1 : i === 3 ? 0.55 : 0.8; });
          let dot = 0; for (let k = 0; k < 12; k++) dot += ch[k] * tpl[k];
          const score = dot / (norm * Math.hypot(...tpl)) - (iv.length === 4 ? 0.02 : 0);
          if (!best || score > best.score) best = { score, root, iv, name };
        }
      }
      seg.push(best && best.score > 0.55 ? best : null);
    }
    // merge equal neighbours, then voice each chord close above C3
    for (let i = 0; i < seg.length; i++) {
      const c = seg[i];
      if (!c) continue;
      let j = i;
      while (j + 1 < seg.length && seg[j + 1] && seg[j + 1].root === c.root && seg[j + 1].name === c.name) j++;
      const s = off + i * 2 * spb, e = off + (j + 1) * 2 * spb - 0.02;
      const root = 48 + c.root;
      for (const x of c.iv) chords.push({ p: root + x, v: 0.7, s, e });
      i = j;
    }

    // ---- lead: predominant 250–1400 Hz pitch on the 16th grid, merged into notes ----
    const lead = [];
    const steps = Math.floor((dur - off) / six);
    const track = [];
    for (let i = 0; i < steps; i++) {
      const t = off + (i + 0.5) * six;
      const mag = A.fft(t, 4096);
      const pt = pitchOf(mag, sr, 4096, 250, 1400, 3);
      track.push(pt ? { m: pt.midi, s: pt.salience } : null);
    }
    const sal = track.filter(Boolean).map((x) => x.s).sort((a, b) => a - b);
    const thr = sal.length ? sal[Math.floor(sal.length * 0.6)] : Infinity;
    const hitSet = new Set(A.onsets.hit.map((o) => Math.round((o.t - off) / six)));
    let cur = null;
    for (let i = 0; i < steps; i++) {
      const x = track[i];
      const voiced = x && x.s >= thr && Math.abs(x.m - Math.round(x.m)) < 0.35;
      const p = voiced ? Math.round(x.m) : null;
      const t = off + i * six;
      if (cur && (p === null || p !== cur.p || hitSet.has(i))) { cur.e = t - 0.01; if (cur.e - cur.s >= six * 0.9) lead.push(cur); cur = null; }
      if (p !== null && !cur) cur = { p, v: 0.75, s: t, e: t + six };
    }
    if (cur) { cur.e = off + steps * six; lead.push(cur); }
    // keep the lead in a melodic range and drop isolated one-step blips between longer notes
    const leadClean = lead.filter((n, i) => n.p >= 55 && n.p <= 90 && !(n.e - n.s < six * 1.2 && lead[i - 1] && lead[i + 1] && lead[i - 1].p === lead[i + 1].p));

    return [makePart(bass, 'bass', 'bass', 'audio'), makePart(chords, 'chords', 'chords', 'audio'), makePart(leadClean, 'lead', 'lead', 'audio')]
      .filter((p) => p.notes.length);
  }

  // Finds how far MIDI notes must shift to line up with the audio's attacks. Searches ±1 beat
  // (the pattern repeats, so larger shifts are ambiguous) and slightly prefers no shift.
  function align(parts, A) {
    const onsets = A.onsets.hit.concat(A.onsets.bass).map((o) => o.t).sort((a, b) => a - b);
    const starts = [];
    for (const p of parts) for (const n of p.notes) if (n.s < A.dur) starts.push({ t: n.s, w: p.role === 'bass' || p.role === 'drums' ? 1.5 : 1 });
    if (!onsets.length || !starts.length) return 0;
    const near = (t) => {
      let lo = 0, hi = onsets.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (onsets[m] < t) lo = m + 1; else hi = m; }
      return Math.min(Math.abs(onsets[lo] - t), lo ? Math.abs(onsets[lo - 1] - t) : Infinity);
    };
    const spb = 60 / A.bpm, sig = 0.025;
    let best = 0, bestScore = -Infinity;
    for (let o = -spb; o <= spb; o += 0.005) {
      let s = 0;
      for (const n of starts) { const d = near(n.t + o); s += n.w * Math.exp(-(d * d) / (2 * sig * sig)); }
      s -= Math.abs(o) * starts.length * 0.15;
      if (s > bestScore) { bestScore = s; best = o; }
    }
    return Math.round(best * 1000) / 1000;
  }

  // Returns copies of parts with every note moved by `dt` seconds.
  function shift(parts, dt) {
    return parts.map((p) => ({ ...p, _maxLen: undefined, notes: p.notes.map((n) => ({ ...n, s: n.s + dt, e: n.e + dt })) }));
  }

  // ---------- queries ----------
  function firstIdx(notes, t) {
    let lo = 0, hi = notes.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (notes[m].s < t) lo = m + 1; else hi = m; }
    return lo;
  }
  function inRange(part, t0, t1) {
    const out = [], ns = part.notes;
    // notes can be long, so look back a little before t0
    const maxLen = part._maxLen || (part._maxLen = ns.reduce((a, x) => Math.max(a, x.e - x.s), 0));
    for (let i = firstIdx(ns, t0 - maxLen); i < ns.length && ns[i].s < t1; i++) if (ns[i].e > t0) out.push(ns[i]);
    return out;
  }
  const active = (part, t) => inRange(part, t, t + 1e-6).filter((n) => n.s <= t);

  const CHORD_TYPES = [
    ['maj7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]], ['7', [0, 4, 7, 10]], ['m7b5', [0, 3, 6, 10]],
    ['', [0, 4, 7]], ['m', [0, 3, 7]], ['dim', [0, 3, 6]], ['sus4', [0, 5, 7]], ['sus2', [0, 2, 7]],
  ];
  function chordName(pitches) {
    const pcs = [...new Set(pitches.map((p) => ((p % 12) + 12) % 12))];
    if (pcs.length < 2) return pcs.length ? window.U.NOTE_NAMES[pcs[0]] : '';
    const bassPc = ((Math.min(...pitches) % 12) + 12) % 12;
    let best = null;
    for (let root = 0; root < 12; root++) {
      for (const [suffix, iv] of CHORD_TYPES) {
        const set = iv.map((x) => (root + x) % 12);
        const hit = pcs.filter((pc) => set.includes(pc)).length, miss = set.length - hit, extra = pcs.length - hit;
        const score = hit * 2 - miss * 1.5 - extra * 2 + (root === bassPc ? 0.5 : 0) + iv.length * 0.1;
        if (!best || score > best.score) best = { score, name: window.U.NOTE_NAMES[root] + suffix };
      }
    }
    return best.name;
  }
  function chordAt(parts, t) {
    const ch = parts.find((p) => p.role === 'chords' && p.enabled);
    if (!ch) return { name: '', notes: [] };
    const notes = active(ch, t);
    return { name: chordName(notes.map((n) => n.p)), notes };
  }

  window.Midi = { parseSMF };
  window.Parts = { fromMidiFile, fromAudio, align, shift, makePart, inRange, active, chordAt, chordName, guessRole, ROLE_COLORS };
})();
