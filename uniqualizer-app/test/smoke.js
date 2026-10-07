'use strict';
// Смоук-тест: делает тестовое видео, прогоняет ядро, проверяет 1080x1920 и метаданные.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const core = require('../core');

const ffmpeg = process.env.UNIQ_FFMPEG || require('ffmpeg-static');
const ffprobe = process.env.UNIQ_FFPROBE || require('ffprobe-static').path;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uq_smoke_'));
  const src = path.join(dir, 'in.mp4');
  const r = spawnSync(ffmpeg, [
    '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=3:size=1280x720:rate=25',
    '-f', 'lavfi', '-i', 'sine=duration=3',
    '-metadata', 'make=Canon', '-c:v', 'libx264', '-c:a', 'aac', src,
  ]);
  if (r.status !== 0) throw new Error('не удалось создать тестовое видео: ' + r.stderr);

  core.generateLuts(path.join(dir, 'luts'), 2);
  const luts = core.loadLuts(path.join(dir, 'luts'));

  for (const fit of ['crop', 'blur']) {
    for (const strength of [1.0, 0.5]) {
      const out = path.join(dir, 'out');
      fs.mkdirSync(out, { recursive: true });
      const res = await core.processVideo({
        src, outDir: out, ffmpeg, ffprobe, luts, usedDates: new Set(),
        opts: {
          speedMin: 0.95, speedMax: 1.05, fit, lutEnabled: true,
          lutStrengthMin: strength, lutStrengthMax: strength,
          daysA: 150, daysB: 10, codec: 'libx264', crf: 23, preset: 'ultrafast', fps: 30,
        },
      }).promise;
      const p = spawnSync(ffprobe, [
        '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
        '-show_entries', 'format_tags', '-of', 'json', res.file,
      ], { encoding: 'utf8' });
      const j = JSON.parse(p.stdout);
      const { width, height } = j.streams[0];
      if (width !== 1080 || height !== 1920) throw new Error(`размер ${width}x${height}`);
      if (j.format.tags.make) throw new Error('старые метаданные не удалены');
      if (!/^clip_/.test(j.format.tags.title)) throw new Error('новый title не записан');
      console.log(`OK fit=${fit} strength=${strength} speed=${res.speed} date=${res.date}`);
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('Смоук-тест пройден');
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
