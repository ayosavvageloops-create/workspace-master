#!/usr/bin/env python3
"""
Уникализатор видео для TikTok / Instagram Reels (macOS / Linux).
Выход всегда 1080x1920 (9:16).

Что делает с каждым роликом:
  1. Цветокоррекция через LUT (.cube) со случайной силой эффекта.
  2. Случайная (или заданная вручную) скорость видео + аудио.
  3. Полная чистка метаданных и запись новых (creation_time, title, comment).
  4. Случайная дата файла (mtime + дата создания на macOS).

Требуется: ffmpeg + ffprobe в PATH (macOS: brew install ffmpeg).
Внешних Python-библиотек не нужно.

Примеры:
  python3 uniq.py gen-luts                      # создать 12 случайных LUT в luts/
  python3 uniq.py run input/ -n 3               # 3 уникальных копии каждого ролика
  python3 uniq.py run clip.mp4 --speed 0.96 1.04
  python3 uniq.py run input/ --speed 1.0        # скорость не трогать
  python3 uniq.py run input/ --lut-strength 0.4 0.8 --days 30 120
"""

import argparse
import math
import os
import random
import re
import shutil
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

VIDEO_EXT = {".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm"}

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_LUTS = BASE_DIR / "luts"
DEFAULT_OUT = BASE_DIR / "output"


# ============================================================
# ПРОВЕРКИ
# ============================================================

def check_ffmpeg():
    for tool in ("ffmpeg", "ffprobe"):
        if shutil.which(tool) is None:
            sys.exit(
                f"{tool} не найден в PATH. "
                "На macOS: brew install ffmpeg"
            )


# ============================================================
# LUT
# ============================================================

def generate_random_lut(path, size=33):
    """
    Генерирует .cube LUT со случайным «лук»: гамма, контраст,
    насыщенность, тонировка теней/светов, лёгкий сдвиг каналов.
    """
    gamma = random.uniform(0.85, 1.20)
    contrast = random.uniform(0.90, 1.20)
    sat = random.uniform(0.80, 1.30)
    lift = [random.uniform(-0.03, 0.03) for _ in range(3)]    # тени
    gain = [random.uniform(0.96, 1.04) for _ in range(3)]     # света
    # S-кривая для «плёночного» контраста
    s_amount = random.uniform(0.0, 0.25)

    def tone(v, ch):
        v = max(0.0, min(1.0, v)) ** gamma
        v = (v - 0.5) * contrast + 0.5
        # smoothstep-подмешивание
        smooth = v * v * (3 - 2 * v)
        v = v * (1 - s_amount) + smooth * s_amount
        v = v * gain[ch] + lift[ch]
        return max(0.0, min(1.0, v))

    lines = [
        f'TITLE "rand_{uuid.uuid4().hex[:8]}"',
        f"LUT_3D_SIZE {size}",
        "DOMAIN_MIN 0.0 0.0 0.0",
        "DOMAIN_MAX 1.0 1.0 1.0",
    ]
    step = size - 1
    # .cube: красный меняется быстрее всего, синий медленнее всего
    for b in range(size):
        for g in range(size):
            for r in range(size):
                rgb = [tone(r / step, 0), tone(g / step, 1), tone(b / step, 2)]
                luma = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
                rgb = [
                    max(0.0, min(1.0, luma + (c - luma) * sat))
                    for c in rgb
                ]
                lines.append(f"{rgb[0]:.6f} {rgb[1]:.6f} {rgb[2]:.6f}")

    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


def cmd_gen_luts(args):
    out = Path(args.dir)
    out.mkdir(parents=True, exist_ok=True)
    for i in range(args.count):
        p = out / f"auto_{uuid.uuid4().hex[:6]}.cube"
        generate_random_lut(p)
        print(f"✓ {p}")
    print(f"Готово: {args.count} LUT в {out}")


def load_luts(folder):
    folder = Path(folder)
    if not folder.exists():
        return []
    return sorted(
        p for p in folder.iterdir()
        if p.is_file() and p.suffix.lower() == ".cube"
    )


def ff_escape_path(path):
    """Экранирование пути для значения внутри filtergraph FFmpeg."""
    s = str(path).replace("\\", "\\\\")
    for ch in (":", "'", ",", "[", "]", ";", " "):
        s = s.replace(ch, "\\" + ch)
    return s


# ============================================================
# ФАЙЛОВЫЕ ДАТЫ / МЕТАДАННЫЕ
# ============================================================

def random_creation_date(days_min, days_max, used):
    """
    Случайная дата: от days_max до days_min дней назад
    (например 10..150). Даты между роликами не повторяются.
    """
    now = datetime.now().astimezone()
    lo, hi = sorted((int(days_max * 86400), int(days_min * 86400)))
    candidate = now - timedelta(seconds=random.randint(lo, hi))
    while candidate.timestamp() in used:
        candidate += timedelta(seconds=1)
    used.add(candidate.timestamp())
    return candidate


def ffmpeg_time(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def apply_file_dates(path, dt):
    """
    Выставляет дату изменения и дату создания файла.

    macOS (APFS/HFS+): если mtime ставится РАНЬШЕ текущей даты создания,
    система сама сдвигает дату создания (birthtime) на это же значение.
    Поэтому достаточно os.utime, а для надёжности есть запасной вариант
    через SetFile (ставится вместе с Xcode Command Line Tools).
    """
    ts = dt.timestamp()
    os.utime(path, (ts, ts))

    if sys.platform != "darwin":
        return

    birth = getattr(Path(path).stat(), "st_birthtime", None)
    if birth is not None and abs(birth - ts) <= 2:
        return

    if shutil.which("SetFile"):
        stamp = dt.strftime("%m/%d/%Y %H:%M:%S")
        subprocess.run(
            ["SetFile", "-d", stamp, "-m", stamp, str(path)],
            check=False,
        )
        os.utime(path, (ts, ts))


# ============================================================
# ВИДЕО
# ============================================================

def probe(path):
    """Возвращает (duration, has_audio)."""
    r = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture_output=True, text=True, check=True,
    )
    duration = float(r.stdout.strip())
    if not math.isfinite(duration) or duration <= 0:
        raise RuntimeError(f"Некорректная длительность: {path}")

    a = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "a:0",
            "-show_entries", "stream=index", "-of", "csv=p=0",
            str(path),
        ],
        capture_output=True, text=True,
    )
    return duration, bool(a.stdout.strip())


def atempo_chain(speed):
    """atempo принимает 0.5..2.0 — при выходе за границы делим на цепочку."""
    parts, t = [], speed
    while t < 0.5:
        parts.append("atempo=0.5")
        t /= 0.5
    while t > 2.0:
        parts.append("atempo=2.0")
        t /= 2.0
    parts.append(f"atempo={t:.8f}")
    return ",".join(parts)


OUT_W, OUT_H = 1080, 1920  # строго 9:16 (TikTok / Reels)


def build_frame_filter(mode):
    """
    Приводит кадр к 1080x1920 (9:16). Возвращает [0:v] ... [vframe].
      crop — масштаб с заполнением кадра и обрезка по центру (без полос);
      blur — всё видео целиком, а пустые края заполнены размытой копией.
    Если исходник уже 9:16, обе схемы сводятся к простому масштабированию.
    """
    if mode == "blur":
        return (
            "[0:v]split[fgsrc][bgsrc];"
            f"[bgsrc]scale={OUT_W}:{OUT_H}:force_original_aspect_ratio=increase:"
            f"flags=lanczos,crop={OUT_W}:{OUT_H},boxblur=30:4[bgb];"
            f"[fgsrc]scale={OUT_W}:{OUT_H}:force_original_aspect_ratio=decrease:"
            "flags=lanczos[fgs];"
            "[bgb][fgs]overlay=(W-w)/2:(H-h)/2[vframe]"
        )
    return (
        f"[0:v]scale={OUT_W}:{OUT_H}:force_original_aspect_ratio=increase:"
        f"flags=lanczos,crop={OUT_W}:{OUT_H}[vframe]"
    )


def build_lut_filter(lut_path, strength, src="vframe"):
    """
    LUT с регулируемой силой: strength=1.0 — полный LUT,
    0.5 — смесь 50/50 с оригиналом.
    Возвращает фрагмент filter_complex: [src] ... [vgrade]
    """
    lut = ff_escape_path(lut_path)
    if strength >= 0.999:
        return f"[{src}]lut3d=file={lut}[vgrade]"
    return (
        f"[{src}]split[orig][tolut];"
        f"[tolut]lut3d=file={lut}[graded];"
        f"[orig][graded]blend=all_expr="
        f"'A*(1-{strength:.4f})+B*{strength:.4f}'[vgrade]"
    )


def process_video(src, dst, args, luts, used_dates):
    duration, has_audio = probe(src)

    # --- скорость ---
    speed = round(random.uniform(args.speed[0], args.speed[1]), 4)

    # --- LUT ---
    lut = random.choice(luts) if luts else None
    strength = round(random.uniform(*args.lut_strength), 3)

    # --- метаданные ---
    date = random_creation_date(args.days[0], args.days[1], used_dates)
    uid = uuid.uuid4().hex

    graph = [build_frame_filter(args.fit)]
    if lut:
        graph.append(build_lut_filter(lut, strength))
        tail = "[vgrade]"
    else:
        tail = "[vframe]"

    graph.append(
        f"{tail}setpts=PTS/{speed:.6f},format=yuv420p,setsar=1[vout]"
    )
    if has_audio:
        graph.append(f"[0:a]{atempo_chain(speed)}[aout]")

    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(src),
        "-filter_complex", ";".join(graph),
        "-map", "[vout]",
    ]
    if has_audio:
        cmd += ["-map", "[aout]"]

    cmd += [
        "-c:v", args.codec,
    ]
    if args.codec == "libx264":
        cmd += ["-preset", args.preset, "-crf", str(args.crf)]
    else:  # h264_videotoolbox (Apple Silicon / Intel Mac)
        cmd += ["-b:v", args.bitrate]
    cmd += [
        "-g", str(random.randint(30, 90)),
        "-pix_fmt", "yuv420p",
        "-r", str(args.fps) if args.fps else "30",
    ]
    if has_audio:
        cmd += ["-c:a", "aac", "-b:a", "128k"]

    cmd += [
        # --- ЧИСТКА метаданных ---
        "-map_metadata", "-1",
        "-map_chapters", "-1",
        "-fflags", "+bitexact",
        "-flags:v", "+bitexact",
        "-flags:a", "+bitexact",
        # --- НОВЫЕ метаданные ---
        "-metadata", f"creation_time={ffmpeg_time(date)}",
        "-metadata", f"title=clip_{uid[:12]}",
        "-metadata", f"comment={uid}",
        "-metadata:s:v:0", f"creation_time={ffmpeg_time(date)}",
        "-metadata:s:v:0", "handler_name=VideoHandler",
    ]
    if has_audio:
        cmd += [
            "-metadata:s:a:0", f"creation_time={ffmpeg_time(date)}",
            "-metadata:s:a:0", "handler_name=SoundHandler",
        ]
    cmd += ["-movflags", "+faststart", str(dst)]

    r = subprocess.run(cmd, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0:
        if dst.exists():
            dst.unlink()
        raise RuntimeError(r.stderr.strip()[-3000:] or "ffmpeg завершился с ошибкой")

    apply_file_dates(dst, date)

    return {
        "speed": speed,
        "lut": lut.name if lut else "—",
        "strength": strength if lut else 0,
        "date": date.strftime("%Y-%m-%d %H:%M:%S"),
        "duration": duration / speed,
    }


# ============================================================
# CLI
# ============================================================

def collect_inputs(paths):
    files = []
    for p in map(Path, paths):
        if p.is_dir():
            files += sorted(
                f for f in p.iterdir()
                if f.is_file() and f.suffix.lower() in VIDEO_EXT
                and not f.name.startswith(".")
            )
        elif p.is_file():
            files.append(p)
        else:
            print(f"✗ Не найдено: {p}")
    return files


def next_output_name(out_dir, stem):
    prefix = datetime.now().strftime("%m%d")
    pattern = re.compile(rf"^{prefix} \((\d+)\)\.mp4$")
    highest = max(
        (int(m.group(1)) for f in out_dir.iterdir()
         if (m := pattern.match(f.name))),
        default=0,
    )
    n = highest + 1
    while True:
        path = out_dir / f"{prefix} ({n}).mp4"
        try:
            with path.open("x"):
                pass
            return path
        except FileExistsError:
            n += 1


def cmd_run(args):
    check_ffmpeg()

    if args.speed is None:
        args.speed = [0.97, 1.03]
    if len(args.speed) == 1:
        args.speed = [args.speed[0], args.speed[0]]
    args.speed.sort()
    if args.speed[0] <= 0:
        sys.exit("Скорость должна быть > 0.")

    args.lut_strength.sort()
    if not (0 < args.lut_strength[0] and args.lut_strength[1] <= 1):
        sys.exit("--lut-strength должен быть в диапазоне (0, 1].")
    if min(args.days) < 0:
        sys.exit("--days не может быть отрицательным.")

    files = collect_inputs(args.inputs)
    if not files:
        sys.exit("Нет входных видео.")

    luts = [] if args.no_lut else load_luts(args.luts)
    if not luts and not args.no_lut:
        print(f"В {args.luts} нет .cube файлов — генерирую 12 случайных LUT.")
        cmd_gen_luts(argparse.Namespace(count=12, dir=args.luts))
        luts = load_luts(args.luts)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    used_dates, ok, fail = set(), 0, 0
    total = len(files) * args.copies
    i = 0
    for src in files:
        for _ in range(args.copies):
            i += 1
            dst = next_output_name(out_dir, src.stem)
            try:
                info = process_video(src, dst, args, luts, used_dates)
                ok += 1
                print(
                    f"✓ [{i}/{total}] {src.name} → {dst.name} | "
                    f"speed×{info['speed']} | LUT {info['lut']} "
                    f"({info['strength']}) | дата {info['date']}"
                )
            except Exception as exc:
                fail += 1
                print(f"✗ [{i}/{total}] {src.name}: {exc}")

    print(f"Готово: {ok}/{total}, ошибок: {fail}, папка: {out_dir}")


def main():
    ap = argparse.ArgumentParser(
        description="Уникализатор видео (выход 1080x1920, 9:16): LUT + скорость + метаданные + дата файла."
    )
    sub = ap.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("gen-luts", help="Сгенерировать случайные .cube LUT")
    g.add_argument("-n", "--count", type=int, default=12)
    g.add_argument("--dir", default=str(DEFAULT_LUTS))
    g.set_defaults(func=cmd_gen_luts)

    r = sub.add_parser("run", help="Уникализировать видео")
    r.add_argument("inputs", nargs="+", help="Файлы или папки с видео")
    r.add_argument("-n", "--copies", type=int, default=1,
                   help="Сколько копий каждого ролика (по умолч. 1)")
    r.add_argument("-o", "--out", default=str(DEFAULT_OUT))

    r.add_argument("--speed", type=float, nargs="+", metavar="X",
                   help="Скорость: одно число (фикс) или MIN MAX (случайно). "
                        "По умолч. 0.97 1.03; 1.0 — не менять")
    r.add_argument("--luts", default=str(DEFAULT_LUTS),
                   help="Папка с .cube LUT")
    r.add_argument("--no-lut", action="store_true",
                   help="Отключить цветокоррекцию")
    r.add_argument("--lut-strength", type=float, nargs=2,
                   default=[0.5, 1.0], metavar=("MIN", "MAX"),
                   help="Сила LUT, 1.0 = полный (по умолч. 0.5 1.0)")

    r.add_argument("--days", type=float, nargs=2, default=[150, 10],
                   metavar=("MAX_AGO", "MIN_AGO"),
                   help="Диапазон даты файла в днях назад (по умолч. 150 10)")

    r.add_argument("--fit", choices=["crop", "blur"], default="crop",
                   help="Приведение к 9:16 1080x1920: crop — обрезка по центру, "
                        "blur — целиком + размытые края (по умолч. crop)")
    r.add_argument("--codec", choices=["libx264", "h264_videotoolbox"],
                   default="libx264",
                   help="h264_videotoolbox — аппаратное кодирование на Mac")
    r.add_argument("--preset", default="medium")
    r.add_argument("--crf", type=int, default=20)
    r.add_argument("--bitrate", default="8000k",
                   help="Для h264_videotoolbox")
    r.add_argument("--fps", type=int, default=30)
    r.set_defaults(func=cmd_run)

    args = ap.parse_args()
    try:
        args.func(args)
    except KeyboardInterrupt:
        print("\nОстановлено.")


if __name__ == "__main__":
    main()
