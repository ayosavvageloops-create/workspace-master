// Audio engine: decoding, playback, spectrum analysis and beat detection.
(function () {
  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.el = new Audio();
      this.el.crossOrigin = 'anonymous';
      this.el.preload = 'auto';
      this.analyser = null;
      this.recordDest = null;
      this.freq = null;
      this.wave = null;
      this.energyHistory = [];
      this.beat = 0;          // 0..1 decaying pulse, jumps to 1 on a detected beat
      this.bass = 0;          // smoothed low-band level 0..1
      this.mid = 0;
      this.high = 0;
      this.level = 0;         // overall smoothed level 0..1
      this.lastBeatAt = 0;
      this.sensitivity = 1.35;
    }

    ensureContext() {
      if (this.ctx) return;
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = this.ctx.createMediaElementSource(this.el);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.78;
      this.recordDest = this.ctx.createMediaStreamDestination();
      src.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      src.connect(this.recordDest);
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
      this.wave = new Uint8Array(this.analyser.fftSize);
    }

    load(file) {
      if (this.el.src) URL.revokeObjectURL(this.el.src);
      this.el.src = URL.createObjectURL(file);
      this.el.load();
    }

    async play() { this.ensureContext(); await this.ctx.resume(); return this.el.play(); }
    pause() { this.el.pause(); }
    get playing() { return !this.el.paused && !this.el.ended; }
    get duration() { return isFinite(this.el.duration) ? this.el.duration : 0; }
    get time() { return this.el.currentTime; }
    seek(t) { this.el.currentTime = Math.max(0, Math.min(t, this.duration)); }

    // Average of normalised bins between two frequencies (Hz).
    band(lo, hi) {
      if (!this.freq) return 0;
      const nyq = this.ctx.sampleRate / 2, n = this.freq.length;
      const a = Math.max(0, Math.floor(lo / nyq * n)), b = Math.min(n - 1, Math.ceil(hi / nyq * n));
      let s = 0;
      for (let i = a; i <= b; i++) s += this.freq[i];
      return s / ((b - a + 1) * 255);
    }

    update(now) {
      if (!this.analyser) return;
      this.analyser.getByteFrequencyData(this.freq);
      this.analyser.getByteTimeDomainData(this.wave);
      const bass = this.band(20, 150), mid = this.band(150, 2000), high = this.band(2000, 12000);
      this.bass += (bass - this.bass) * 0.35;
      this.mid += (mid - this.mid) * 0.3;
      this.high += (high - this.high) * 0.3;
      this.level += ((bass + mid + high) / 3 - this.level) * 0.25;

      // Energy-based onset detection on the low band.
      const e = bass * bass;
      const h = this.energyHistory;
      h.push(e);
      if (h.length > 43) h.shift();
      const avg = h.reduce((a, b) => a + b, 0) / h.length;
      if (this.playing && e > avg * this.sensitivity && e > 0.04 && now - this.lastBeatAt > 220) {
        this.beat = 1;
        this.lastBeatAt = now;
      } else {
        this.beat *= 0.9;
      }
    }

    // Log-spaced spectrum resampled to `count` bars, values 0..1.
    bars(count, minHz = 30, maxHz = 14000) {
      const out = new Float32Array(count);
      if (!this.freq) return out;
      const nyq = this.ctx.sampleRate / 2, n = this.freq.length;
      for (let i = 0; i < count; i++) {
        const f0 = minHz * Math.pow(maxHz / minHz, i / count);
        const f1 = minHz * Math.pow(maxHz / minHz, (i + 1) / count);
        const a = Math.floor(f0 / nyq * n), b = Math.max(a, Math.floor(f1 / nyq * n));
        let m = 0;
        for (let j = a; j <= b && j < n; j++) m = Math.max(m, this.freq[j]);
        out[i] = m / 255;
      }
      return out;
    }
  }

  window.AudioEngine = AudioEngine;
})();
