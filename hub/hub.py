#!/usr/bin/env python3
"""Beat Hub — локальный пульт управления на macOS.

Запуск:  python3 hub.py   (или двойной клик по start-hub.command)
Открыть: http://127.0.0.1:8787

Только стандартная библиотека Python 3.9+. Слушает только localhost.
"""
import json
import os
import re
import signal
import subprocess
import sys
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
LOGS = DATA / "logs"
PORT = int(os.environ.get("HUB_PORT", "8787"))

DATA.mkdir(exist_ok=True)
LOGS.mkdir(exist_ok=True)


def load_json(path, default):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def save_json(path, obj):
    tmp = Path(str(path) + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


# ---------- задачи (запуск скриптов) ----------

RUNS = {}  # task_id -> {"proc", "log", "started", "rc"}
RUNS_LOCK = threading.Lock()


def tasks():
    return load_json(ROOT / "tasks.json", {"tasks": []})["tasks"]


def task_state(task_id):
    run = RUNS.get(task_id)
    if not run:
        return {"status": "idle"}
    rc = run["proc"].poll()
    return {
        "status": "running" if rc is None else ("ok" if rc == 0 else "failed"),
        "rc": rc,
        "started": run["started"],
        "log": run["log"].name,
    }


def start_task(task_id):
    task = next((t for t in tasks() if t["id"] == task_id), None)
    if not task:
        return {"error": "нет такой задачи"}, 404
    with RUNS_LOCK:
        if task_state(task_id)["status"] == "running":
            return {"error": "уже запущена"}, 409
        cwd = os.path.expanduser(task.get("cwd", "~"))
        if not os.path.isdir(cwd):
            return {"error": f"папка не найдена: {cwd} — поправь cwd в tasks.json"}, 400
        stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        log_path = LOGS / f"{task_id}_{stamp}.log"
        log = open(log_path, "w", encoding="utf-8")
        log.write(f"$ {task['cmd']}\n(cwd: {cwd})\n\n")
        log.flush()
        # login shell, чтобы подтянулись PATH/pyenv/nvm как в обычном терминале
        shell = os.environ.get("SHELL", "/bin/zsh")
        proc = subprocess.Popen(
            [shell, "-lc", task["cmd"]],
            cwd=cwd,
            stdout=log,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
        RUNS[task_id] = {"proc": proc, "log": log_path, "started": stamp}
    log_event(f"start {task_id}")
    return task_state(task_id), 200


def stop_task(task_id):
    run = RUNS.get(task_id)
    if not run or run["proc"].poll() is not None:
        return {"error": "не запущена"}, 409
    os.killpg(run["proc"].pid, signal.SIGTERM)
    log_event(f"stop {task_id}")
    return {"status": "stopping"}, 200


def tail(path, max_bytes=20000):
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - max_bytes))
            return f.read().decode("utf-8", "replace")
    except OSError:
        return ""


def log_event(text):
    with open(DATA / "events.log", "a", encoding="utf-8") as f:
        f.write(f"{datetime.now().isoformat(timespec='seconds')} {text}\n")


# ---------- ежедневные целевые действия ----------

def day_file():
    return DATA / "days.json"


def get_day(day):
    days = load_json(day_file(), {})
    return days.get(day, {})


def set_count(day, action_id, value):
    days = load_json(day_file(), {})
    days.setdefault(day, {})[action_id] = max(0, int(value))
    save_json(day_file(), days)
    return days[day]


def month_summary(month):
    """Суммы за месяц (YYYY-MM) по всем счётчикам."""
    days = load_json(day_file(), {})
    total = {}
    worked = 0
    for d, counts in days.items():
        if d.startswith(month):
            worked += 1
            for k, v in counts.items():
                total[k] = total.get(k, 0) + v
    return {"month": month, "days_logged": worked, "total": total}


# ---------- проверка текста на стоп-слова ----------

EMOJI_RE = re.compile("[\U0001F300-\U0001FAFF☀-➿]")


def check_message(text):
    rules = load_json(ROOT / "stopwords.json", {"categories": []})["categories"]
    low = text.lower()
    hits = []
    for cat in rules:
        found = set()
        for pat in cat["patterns"]:
            for m in re.finditer(pat, low, re.IGNORECASE):
                found.add(m.group(0).strip())
        if found:
            hits.append({
                "category": cat["title"], "level": cat["level"],
                "why": cat["why"], "matches": sorted(found),
            })

    notes = []
    words = re.findall(r"\w+", text)
    if len(text) > 300:
        notes.append(("medium", f"Длинно ({len(text)} симв.). Первое сообщение — 1–2 строки, до ~200 символов."))
    if len(EMOJI_RE.findall(text)) > 2:
        notes.append(("medium", "Больше 2 эмодзи — выглядит как рассылка."))
    caps = [w for w in words if len(w) > 3 and w.isupper()]
    if len(caps) >= 2:
        notes.append(("medium", f"КАПС: {', '.join(caps[:5])}"))
    if text.count("!") > 2:
        notes.append(("medium", "Много восклицательных знаков."))
    if text.count("@") > 1:
        notes.append(("high", "Несколько @упоминаний в одном сообщении."))
    if "?" not in text:
        notes.append(("medium", "Нет вопроса. Задача первого сообщения — получить ответ, а не продать."))
    if not re.search(r"\{[a-z_]+\}", text):
        notes.append(("medium", "Нет персонализации ({name}, {track}, {post}). Одинаковый текст на сотни аккаунтов — сильный спам-сигнал сам по себе."))

    high = sum(1 for h in hits if h["level"] == "high") + sum(1 for lv, _ in notes if lv == "high")
    medium = sum(1 for h in hits if h["level"] == "medium") + sum(1 for lv, _ in notes if lv == "medium")
    score = min(100, high * 30 + medium * 10)
    verdict = "ок" if score < 20 else ("рискованно" if score < 50 else "почти точно в скрытые/спам")
    return {"score": score, "verdict": verdict, "hits": hits,
            "notes": [{"level": lv, "text": t} for lv, t in notes]}


# ---------- HTTP ----------

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, obj, code=200, ctype="application/json"):
        body = obj if isinstance(obj, (bytes, str)) else json.dumps(obj, ensure_ascii=False)
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", f"{ctype}; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/":
            return self.send((ROOT / "ui.html").read_bytes(), ctype="text/html")
        if path == "/api/tasks":
            return self.send([{**t, **task_state(t["id"])} for t in tasks()])
        if path.startswith("/api/log/"):
            run = RUNS.get(path.rsplit("/", 1)[1])
            return self.send({"text": tail(run["log"]) if run else ""})
        if path == "/api/daily":
            return self.send(load_json(ROOT / "daily.json", {"actions": []}))
        if path.startswith("/api/day/"):
            return self.send(get_day(path.rsplit("/", 1)[1]))
        if path.startswith("/api/month/"):
            return self.send(month_summary(path.rsplit("/", 1)[1]))
        return self.send({"error": "not found"}, 404)

    def do_POST(self):
        # защита от запросов с чужих сайтов: принимаем только со своей страницы
        origin = self.headers.get("Origin")
        if origin and origin not in (f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"):
            return self.send({"error": "forbidden"}, 403)
        path = self.path
        if path.startswith("/api/run/"):
            res, code = start_task(path.rsplit("/", 1)[1])
            return self.send(res, code)
        if path.startswith("/api/stop/"):
            res, code = stop_task(path.rsplit("/", 1)[1])
            return self.send(res, code)
        if path.startswith("/api/day/"):
            b = self.body()
            return self.send(set_count(path.rsplit("/", 1)[1], b["id"], b["value"]))
        if path == "/api/check":
            return self.send(check_message(self.body().get("text", "")))
        return self.send({"error": "not found"}, 404)


def main():
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://127.0.0.1:{PORT}"
    print(f"Beat Hub: {url}  (Ctrl+C — выключить)")
    if sys.platform == "darwin" and "--no-browser" not in sys.argv:
        threading.Timer(0.5, lambda: subprocess.run(["open", url])).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
