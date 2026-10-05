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
  function fromAudio(A) {
    const spb = 60 / A.bpm, size = 8192, hz = A.sr / size;
    const peakPitch = (t, lo, hi) => {
      const sp = magAt(A, t, size);
      let best = 0, bk = 0;
      for (let k = Math.floor(lo / hz); k < Math.min(sp.length, hi / hz); k++) if (sp[k] > best) { best = sp[k]; bk = k; }
      if (!bk) return null;
      return Math.round(69 + 12 * Math.log2((bk * hz) / 440));
    };
    // bass: one note per bass onset, held until the next one (max 1 beat)
    const bassOn = A.onsets.bass.filter((o) => o.s > 0.15);
    const bass = [];
    for (let i = 0; i < bassOn.length; i++) {
      const s = bassOn[i].t, nx = i + 1 < bassOn.length ? bassOn[i + 1].t : s + spb;
      const p = peakPitch(s + 0.04, 35, 220);
      if (p != null) bass.push({ p, v: 0.5 + bassOn[i].s * 0.5, s, e: Math.min(nx, s + spb) - 0.01 });
    }
    // chords: chroma per bar, top 3-4 pitch classes voiced around C4
    const chords = [], barDur = spb * 4;
    for (let b = 0; b * barDur + A.beatOffset < A.dur; b++) {
      const s = b * barDur + A.beatOffset, chroma = new Float32Array(12);
      for (let k = 0; k < 4; k++) {
        const sp = magAt(A, s + (k + 0.5) * spb, size);
        for (let i = Math.floor(130 / hz); i < Math.min(sp.length, 1000 / hz); i++) {
          const pc = ((Math.round(69 + 12 * Math.log2((i * hz) / 440)) % 12) + 12) % 12;
          chroma[pc] += sp[i] * sp[i];
        }
      }
      const order = [...chroma.keys()].sort((a, c) => chroma[c] - chroma[a]);
      const top = order.slice(0, 4).filter((pc) => chroma[pc] > chroma[order[0]] * 0.25);
      for (const pc of top) chords.push({ p: 60 + pc - (pc > 7 ? 12 : 0), v: 0.7, s, e: s + barDur - 0.02 });
    }
    // lead: mid-band onsets with the strongest 300–2000 Hz partial
    const lead = [];
    const hits = A.onsets.hit.filter((o) => o.s > 0.2);
    for (let i = 0; i < hits.length; i++) {
      const s = hits[i].t, nx = i + 1 < hits.length ? hits[i + 1].t : s + spb / 2;
      const p = peakPitch(s + 0.03, 300, 2000);
      if (p != null) lead.push({ p, v: hits[i].s, s, e: Math.min(nx, s + spb) - 0.01 });
    }
    return [makePart(bass, 'bass', 'bass', 'audio'), makePart(chords, 'chords', 'chords', 'audio'), makePart(lead, 'lead', 'lead', 'audio')]
      .filter((p) => p.notes.length);
  }
  function magAt(A, t, size) {
    // Reuse the analysis log spectrum and spread it back onto linear bins.
    const n = size / 2, out = new Float32Array(n);
    const bins = 512, sp = A.spectrum(t, bins, { min: 30, max: 4000, size, smooth: false });
    for (let i = 0; i < bins; i++) {
      const f = 30 * Math.pow(4000 / 30, (i + 0.5) / bins), k = Math.round(f / (A.sr / size));
      if (k < n) out[k] = Math.max(out[k], sp[i]);
    }
    return out;
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
  window.Parts = { fromMidiFile, fromAudio, makePart, inRange, active, chordAt, chordName, guessRole, ROLE_COLORS };
})();
