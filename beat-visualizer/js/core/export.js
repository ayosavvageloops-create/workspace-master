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

  // Clip [start, start+len) of the decoded buffer, resampled to 48 kHz stereo, with loudness gain and short fades.
  async function clipAudio(buffer, start, len, A, normalize) {
    const frames = Math.ceil(len * SR);
    const oc = new OfflineAudioContext(2, frames, SR);
    const src = oc.createBufferSource(); src.buffer = buffer;
    const g = oc.createGain();
    let gainDb = 0;
    if (normalize && A) {
      gainDb = -14 - A.lufs.integrated;
      gainDb = Math.min(gainDb, -1 - A.lufs.truePeak);
    }
    const lin = Math.pow(10, gainDb / 20);
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(lin, 0.01);
    g.gain.setValueAtTime(lin, Math.max(0.02, len - 0.06));
    g.gain.linearRampToValueAtTime(0, len);
    src.connect(g).connect(oc.destination);
    src.start(0, start, len);
    return oc.startRendering();
  }

  async function saveTarget(filename) {
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
    if (handle && handle !== 'cancel') {
      const ws = await handle.createWritable(); await ws.write(blob); await ws.close();
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
    await save(handle, blob, blob.type.includes('webm') ? filename.replace(/\.mp4$/, '.webm') : filename);
    return { seconds: (performance.now() - t0) / 1000, size: blob.size };
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
    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
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
