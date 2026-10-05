// Offline MP4 export: every frame is rendered off-screen as fast as the machine
// allows (WebCodecs H.264/AAC → mp4-muxer). Audio is normalised to -14 LUFS with a
// -1 dBTP ceiling. Falls back to real-time MediaRecorder where WebCodecs is missing.
(function () {
  const VIDEO_CODECS = [
    { codec: 'avc1.640034', mux: 'avc' }, { codec: 'avc1.4d0034', mux: 'avc' }, { codec: 'avc1.42003e', mux: 'avc' },
    { codec: 'vp09.00.51.08', mux: 'vp9' }, { codec: 'av01.0.12M.08', mux: 'av1' },
  ];
  const AUDIO_CODECS = [{ codec: 'mp4a.40.2', mux: 'aac' }, { codec: 'opus', mux: 'opus' }];
  const SR = 48000;

  async function pickVideo(w, h, fps) {
    for (const c of VIDEO_CODECS) {
      const cfg = { codec: c.codec, width: w, height: h, bitrate: Math.round(w * h * fps * 0.13), framerate: fps, latencyMode: 'quality' };
      if (c.mux === 'avc') cfg.avc = { format: 'avc' };
      try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { ...c, cfg }; } catch (e) { /* try next */ }
    }
    return null;
  }
  async function pickAudio() {
    for (const c of AUDIO_CODECS) {
      const cfg = { codec: c.codec, sampleRate: SR, numberOfChannels: 2, bitrate: c.mux === 'aac' ? 256000 : 192000 };
      try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { ...c, cfg }; } catch (e) { /* try next */ }
    }
    return null;
  }

  // Clip [start, start+len) of the decoded buffer, resampled to 48 kHz stereo. With `normalize`
  // the clip is brought to -14 LUFS through a look-ahead limiter with a -1 dBFS ceiling.
  async function clipAudio(buffer, start, len, A, normalize) {
    const frames = Math.ceil(len * SR);
    const oc = new OfflineAudioContext(2, frames, SR);
    const src = oc.createBufferSource(); src.buffer = buffer;
    src.connect(oc.destination);
    src.start(0, start, len);
    const out = await oc.startRendering();
    const L = out.getChannelData(0), R = out.getChannelData(1);
    if (normalize) {
      let gainDb = -14 - Analysis.integratedLoudness(L, R, SR);
      for (let pass = 0; pass < 3 && Math.abs(gainDb) > 0.05; pass++) {
        limit(L, R, Math.pow(10, gainDb / 20), Math.pow(10, -1.2 / 20));
        gainDb = -14 - Analysis.integratedLoudness(L, R, SR);
      }
    }
    // 10 ms fade in, 60 ms fade out against clicks at the cut points
    const fi = Math.round(0.01 * SR), fo = Math.round(0.06 * SR);
    for (let i = 0; i < fi && i < L.length; i++) { const k = i / fi; L[i] *= k; R[i] *= k; }
    for (let i = 0; i < fo && i < L.length; i++) { const k = i / fo, j = L.length - 1 - i; L[j] *= k; R[j] *= k; }
    return out;
  }

  // Applies `gain`, then a 5 ms look-ahead brick-wall limiter at `ceil` (linear) in place.
  function limit(L, R, gain, ceil) {
    const n = L.length, la = Math.round(0.005 * SR), rel = 1 - Math.exp(-1 / (0.08 * SR));
    const target = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      L[i] *= gain; R[i] *= gain;
      const pk = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      target[i] = pk > ceil ? ceil / pk : 1;
    }
    // forward-looking minimum over la samples (monotonic deque)
    const m = new Float32Array(n), dq = new Int32Array(n);
    let head = 0, tail = 0;
    for (let i = n - 1; i >= 0; i--) {
      while (tail > head && target[dq[tail - 1]] >= target[i]) tail--;
      dq[tail++] = i;
      while (dq[head] > i + la) head++;
      m[i] = target[dq[head]];
    }
    // smooth the attack: moving average of m over the last la samples (m before 0 counts as 1).
    // At a peak p every m[j], j in (p-la, p], is <= target[p], so the average never overshoots.
    let sum = la, env = 1;
    for (let i = 0; i < n; i++) {
      sum += m[i] - (i >= la ? m[i - la] : 1);
      const sm = sum / la;
      env = sm < env ? sm : env + (sm - env) * rel;
      L[i] *= env; R[i] *= env;
    }
  }

  // Hosted as a claude.ai artifact the page cannot download directly; it asks the
  // viewer through the `downloads` capability instead (null when not available).
  async function hostDownloads() {
    if (!window.claude || !window.claude.use) return null;
    try { return await window.claude.use('downloads'); } catch (e) { return null; }
  }

  async function saveTarget(filename) {
    if (window.desktop) return null; // desktop app: native save dialog after rendering
    if (window.claude) return null; // inside an artifact frame the file picker is refused
    if (window.showSaveFilePicker) {
      try {
        return await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'Video', accept: { 'video/mp4': ['.mp4'] } }] });
      } catch (e) {
        if (e.name === 'AbortError') return 'cancel';
      }
    }
    return null;
  }
  async function save(handle, blob, filename) {
    if (window.desktop) {
      const saved = await window.desktop.saveFile(filename, blob);
      if (!saved) throw Object.assign(new Error('Not saved.'), { cancelled: true });
      return saved;
    }
    if (handle && handle !== 'cancel') {
      const ws = await handle.createWritable(); await ws.write(blob); await ws.close();
      return;
    }
    const dl = await hostDownloads();
    if (dl) {
      try { await dl.save({ filename, data: blob }); }
      catch (e) { if (e && e.code === 'declined') return; throw new Error(e && e.message ? e.message : 'The download was refused.'); }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  // opts: { look, ctx (scene context), buffer, fps, filename, normalize, onProgress(k, label), signal }
  async function exportVideo(opts) {
    const { look, ctx, buffer, fps, filename } = opts;
    const handle = await saveTarget(filename); // ask first, while we still hold the click's user activation
    if (handle === 'cancel') return { cancelled: true };
    const t0 = performance.now();
    let blob;
    if (window.VideoEncoder && window.AudioEncoder && window.Mp4Muxer) blob = await offline(opts);
    else blob = await realtime(opts);
    if (!blob) return { cancelled: true };
    let savedPath;
    try { savedPath = await save(handle, blob, blob.type.includes('webm') ? filename.replace(/\.mp4$/, '.webm') : filename); }
    catch (e) { if (e.cancelled) return { cancelled: true }; throw e; }
    return { seconds: (performance.now() - t0) / 1000, size: blob.size, codec: blob.codec, path: savedPath };
  }

  async function offline({ look, ctx, buffer, fps, normalize, onProgress, signal }) {
    const { w, h } = ctx;
    const vc = await pickVideo(w, h, fps);
    const ac = await pickAudio();
    if (!vc) throw new Error('This browser cannot encode video (no H.264/VP9/AV1 encoder).');
    const muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: vc.mux, width: w, height: h, frameRate: fps },
      audio: ac ? { codec: ac.mux, numberOfChannels: 2, sampleRate: SR } : undefined,
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });
    let failed = null;
    const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { failed = e; } });
    venc.configure(vc.cfg);

    // audio first (fast)
    if (ac) {
      onProgress && onProgress(0, 'audio');
      const clip = await clipAudio(buffer, ctx.clipStart, ctx.clipLen, ctx.A, normalize);
      const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { failed = e; } });
      aenc.configure(ac.cfg);
      const L = clip.getChannelData(0), R = clip.getChannelData(1), CH = 1024;
      for (let i = 0; i < clip.length; i += CH) {
        const n = Math.min(CH, clip.length - i), data = new Float32Array(n * 2);
        data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i / SR * 1e6), data });
        aenc.encode(ad); ad.close();
      }
      await aenc.flush(); aenc.close();
    }

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d', { alpha: false });
    const total = Math.round(ctx.clipLen * fps);
    for (let i = 0; i < total; i++) {
      if (signal && signal.aborted) { venc.close(); return null; }
      if (failed) throw failed;
      const t = ctx.clipStart + i / fps;
      Looks.render(g, look, Looks.scene(look, ctx, t, i));
      const vf = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      venc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
      vf.close();
      if (venc.encodeQueueSize > 6) await new Promise((r) => venc.addEventListener('dequeue', r, { once: true }));
      if (i % 10 === 0) { onProgress && onProgress(i / total, 'video'); await new Promise((r) => setTimeout(r, 0)); }
    }
    await venc.flush(); venc.close();
    if (failed) throw failed;
    muxer.finalize();
    onProgress && onProgress(1, 'done');
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    blob.codec = `${vc.mux === 'avc' ? 'H.264' : vc.mux.toUpperCase()} + ${ac ? (ac.mux === 'aac' ? 'AAC' : 'Opus') : 'no audio'}`;
    return blob;
  }

  // Real-time fallback: plays the clip and records canvas + audio.
  async function realtime({ look, ctx, buffer, fps, normalize, onProgress, signal }) {
    const { w, h } = ctx;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d');
    const clip = await clipAudio(buffer, ctx.clipStart, ctx.clipLen, ctx.A, normalize);
    const ac = new AudioContext({ sampleRate: SR });
    const dest = ac.createMediaStreamDestination();
    const src = ac.createBufferSource(); src.buffer = clip; src.connect(dest);
    const stream = new MediaStream([...canvas.captureStream(fps).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mime = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 16e6 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));
    rec.start(250);
    const start = ac.currentTime + 0.05;
    src.start(start);
    await new Promise((resolve) => {
      const step = () => {
        const ct = ac.currentTime - start;
        if (ct >= ctx.clipLen || (signal && signal.aborted)) return resolve();
        const t = ctx.clipStart + Math.max(0, ct);
        Looks.render(g, look, Looks.scene(look, ctx, t, Math.floor(ct * fps)));
        onProgress && onProgress(ct / ctx.clipLen, 'recording');
        requestAnimationFrame(step);
      };
      step();
    });
    rec.stop(); await done; ac.close();
    if (signal && signal.aborted) return null;
    return new Blob(chunks, { type: rec.mimeType || 'video/webm' });
  }

  window.Exporter = { exportVideo, clipAudio };
})();
