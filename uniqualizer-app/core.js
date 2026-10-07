'use strict';

// Ядро уникализатора: LUT + скорость + чистка/подмена метаданных + дата файла.
// Выход всегда 1080x1920 (9:16). Порт uniqualizer/uniq.py.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const OUT_W = 1080;
const OUT_H = 1920;
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.avi', '.webm']);

const rnd = (a, b) => a + Math.random() * (b - a);
const rint = (a, b) => Math.floor(rnd(a, b + 1));
const clamp = (v) => Math.max(0, Math.min(1, v));
const hex = (n) => crypto.randomBytes(n).toString('hex');

// ------------------------------------------------------------
// LUT
// ------------------------------------------------------------

function generateRandomLut(file, size = 33) {
  const gamma = rnd(0.85, 1.2);
  const contrast = rnd(0.9, 1.2);
  const sat = rnd(0.8, 1.3);
  const lift = [0, 1, 2].map(() => rnd(-0.03, 0.03));
  const gain = [0, 1, 2].map(() => rnd(0.96, 1.04));
  const sAmount = rnd(0, 0.25);

  const tone = (v, ch) => {
    v = Math.pow(clamp(v), gamma);
    v = (v - 0.5) * contrast + 0.5;
    const smooth = v * v * (3 - 2 * v);
    v = v * (1 - sAmount) + smooth * sAmount;
    return clamp(v * gain[ch] + lift[ch]);
  };

  const lines = [
    `TITLE "rand_${hex(4)}"`,
    `LUT_3D_SIZE ${size}`,
    'DOMAIN_MIN 0.0 0.0 0.0',
    'DOMAIN_MAX 1.0 1.0 1.0',
  ];
  const step = size - 1;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const rgb = [tone(r / step, 0), tone(g / step, 1), tone(b / step, 2)];
        const luma = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
        const out = rgb.map((c) => clamp(luma + (c - luma) * sat));
        lines.push(out.map((c) => c.toFixed(6)).join(' '));
      }
    }
  }
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

function generateLuts(dir, count) {
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    generateRandomLut(path.join(dir, `auto_${hex(3)}.cube`));
  }
}

function loadLuts(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.cube') && !f.startsWith('.'))
    .sort()
    .map((f) => path.join(dir, f));
}

// ------------------------------------------------------------
// Метаданные / даты
// ------------------------------------------------------------

function randomCreationDate(daysA, daysB, used) {
  const lo = Math.floor(Math.min(daysA, daysB) * 86400);
  const hi = Math.floor(Math.max(daysA, daysB) * 86400);
  let ts = Math.floor((Date.now() - rint(lo, hi) * 1000) / 1000) * 1000;
  while (used.has(ts)) ts += 1000;
  used.add(ts);
  return new Date(ts);
}

function applyFileDates(file, date) {
  const secs = date.getTime() / 1000;
  fs.utimesSync(file, secs, secs);
  if (process.platform !== 'darwin') return;

  // macOS: mtime раньше даты создания сам сдвигает birthtime.
  // Если не сработало — запасной вариант через SetFile (Xcode CLT).
  const birth = fs.statSync(file).birthtimeMs / 1000;
  if (Math.abs(birth - secs) <= 2) return;

  const p = (n) => String(n).padStart(2, '0');
  const stamp =
    `${p(date.getMonth() + 1)}/${p(date.getDate())}/${date.getFullYear()} ` +
    `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
  spawnSync('SetFile', ['-d', stamp, '-m', stamp, file]);
  fs.utimesSync(file, secs, secs);
}

// ------------------------------------------------------------
// FFmpeg
// ------------------------------------------------------------

function probe(ffprobe, file) {
  const d = spawnSync(ffprobe, [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ], { encoding: 'utf8' });
  const duration = parseFloat((d.stdout || '').trim());
  if (!isFinite(duration) || duration <= 0) {
    throw new Error(`Не удалось определить длительность: ${path.basename(file)}`);
  }
  const a = spawnSync(ffprobe, [
    '-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=index', '-of', 'csv=p=0', file,
  ], { encoding: 'utf8' });
  return { duration, hasAudio: !!(a.stdout || '').trim() };
}

function atempoChain(speed) {
  const parts = [];
  let t = speed;
  while (t < 0.5) { parts.push('atempo=0.5'); t /= 0.5; }
  while (t > 2.0) { parts.push('atempo=2.0'); t /= 2.0; }
  parts.push(`atempo=${t.toFixed(8)}`);
  return parts.join(',');
}

function buildFrameFilter(mode) {
  if (mode === 'blur') {
    return (
      '[0:v]split[fgsrc][bgsrc];' +
      `[bgsrc]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase:flags=lanczos,` +
      `crop=${OUT_W}:${OUT_H},boxblur=30:4[bgb];` +
      `[fgsrc]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease:flags=lanczos[fgs];` +
      '[bgb][fgs]overlay=(W-w)/2:(H-h)/2[vframe]'
    );
  }
  return (
    `[0:v]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase:flags=lanczos,` +
    `crop=${OUT_W}:${OUT_H}[vframe]`
  );
}

function buildLutFilter(lutFile, strength) {
  // lutFile — путь без пробелов/спецсимволов (копия во временной папке)
  const lut = lutFile.replace(/\\/g, '/').replace(/:/g, '\\:');
  if (strength >= 0.999) return `[vframe]lut3d=file=${lut}[vgrade]`;
  return (
    '[vframe]split[orig][tolut];' +
    `[tolut]lut3d=file=${lut}[graded];` +
    `[orig][graded]blend=all_expr='A*(1-${strength.toFixed(4)})+B*${strength.toFixed(4)}'[vgrade]`
  );
}

function nextOutputName(outDir) {
  const d = new Date();
  const prefix = String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const re = new RegExp(`^${prefix} \\((\\d+)\\)\\.mp4$`);
  let highest = 0;
  for (const f of fs.readdirSync(outDir)) {
    const m = re.exec(f);
    if (m) highest = Math.max(highest, parseInt(m[1], 10));
  }
  for (let n = highest + 1; ; n++) {
    const file = path.join(outDir, `${prefix} (${n}).mp4`);
    try {
      fs.closeSync(fs.openSync(file, 'wx'));
      return file;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
}

/**
 * Обрабатывает один ролик. Возвращает { promise, cancel }.
 * opts: speedMin, speedMax, fit, lutEnabled, lutStrengthMin, lutStrengthMax,
 *       daysA, daysB, codec, crf, preset, bitrate, fps
 */
function processVideo({ src, outDir, opts, ffmpeg, ffprobe, luts, usedDates, onProgress }) {
  let child = null;
  let cancelled = false;

  const promise = new Promise((resolve, reject) => {
    let dst = null;
    let tmpLut = null;
    const cleanup = () => { if (tmpLut) fs.rmSync(tmpLut, { force: true }); };
    const fail = (err) => {
      cleanup();
      if (dst) fs.rmSync(dst, { force: true });
      reject(err);
    };

    try {
      const { duration, hasAudio } = probe(ffprobe, src);
      const speed = Math.round(rnd(opts.speedMin, opts.speedMax) * 10000) / 10000;
      const date = randomCreationDate(opts.daysA, opts.daysB, usedDates);
      const iso = date.toISOString();
      const uid = hex(16);
      const outDuration = duration / speed;

      let lutName = null;
      let strength = 0;
      const graph = [buildFrameFilter(opts.fit)];
      let tail = '[vframe]';
      if (opts.lutEnabled && luts.length) {
        const lut = luts[rint(0, luts.length - 1)];
        lutName = path.basename(lut);
        strength = Math.round(rnd(opts.lutStrengthMin, opts.lutStrengthMax) * 1000) / 1000;
        tmpLut = path.join(os.tmpdir(), `uq_${hex(6)}.cube`);
        fs.copyFileSync(lut, tmpLut);
        graph.push(buildLutFilter(tmpLut, strength));
        tail = '[vgrade]';
      }
      graph.push(`${tail}setpts=PTS/${speed.toFixed(6)},format=yuv420p,setsar=1[vout]`);
      if (hasAudio) graph.push(`[0:a]${atempoChain(speed)}[aout]`);

      dst = nextOutputName(outDir);

      const a = ['-hide_banner', '-loglevel', 'error', '-y', '-i', src,
        '-filter_complex', graph.join(';'), '-map', '[vout]'];
      if (hasAudio) a.push('-map', '[aout]');
      a.push('-c:v', opts.codec);
      if (opts.codec === 'libx264') {
        a.push('-preset', opts.preset, '-crf', String(opts.crf));
      } else {
        a.push('-b:v', opts.bitrate);
      }
      a.push('-g', String(rint(30, 90)), '-pix_fmt', 'yuv420p', '-r', String(opts.fps || 30));
      if (hasAudio) a.push('-c:a', 'aac', '-b:a', '128k');
      a.push(
        // чистка метаданных
        '-map_metadata', '-1', '-map_chapters', '-1',
        '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact',
        // новые метаданные
        '-metadata', `creation_time=${iso}`,
        '-metadata', `title=clip_${uid.slice(0, 12)}`,
        '-metadata', `comment=${uid}`,
        '-metadata:s:v:0', `creation_time=${iso}`,
        '-metadata:s:v:0', 'handler_name=VideoHandler',
      );
      if (hasAudio) {
        a.push('-metadata:s:a:0', `creation_time=${iso}`, '-metadata:s:a:0', 'handler_name=SoundHandler');
      }
      a.push('-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', dst);

      child = spawn(ffmpeg, a);
      let stderr = '';
      let buf = '';
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.stdout.on('data', (d) => {
        buf += d.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
          if (m && onProgress) {
            const sec = parseInt(m[1], 10) / 1e6;
            onProgress(Math.max(0, Math.min(99, Math.round((sec / outDuration) * 100))));
          }
        }
      });
      child.on('error', fail);
      child.on('close', (code) => {
        if (cancelled) return fail(new Error('Отменено'));
        if (code !== 0) return fail(new Error(stderr.trim().slice(-1500) || 'ffmpeg завершился с ошибкой'));
        try {
          applyFileDates(dst, date);
        } catch (e) {
          return fail(e);
        }
        cleanup();
        if (onProgress) onProgress(100);
        resolve({
          file: dst, speed, lut: lutName, strength,
          date: date.toISOString(), duration: outDuration,
        });
      });
    } catch (e) {
      fail(e);
    }
  });

  return {
    promise,
    cancel() {
      cancelled = true;
      if (child) child.kill('SIGKILL');
    },
  };
}

module.exports = {
  OUT_W, OUT_H, VIDEO_EXT,
  generateLuts, loadLuts, processVideo, probe,
};
