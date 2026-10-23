"""FastAPI backend for the YTFarm dashboard."""

import asyncio
import json
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from core.fingerprint import generate_fingerprint
from core.profile_store import ProfileStore, Task
from core.proxy import check_proxy, parse_proxy_url
from engine.queue import TaskQueue
from engine.scheduler import Scheduler

app = FastAPI(title="YTFarm Dashboard")

STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

_store: Optional[ProfileStore] = None
_running_task: Optional[asyncio.Task] = None
_farm_status = {"running": False, "message": "Idle"}


def get_store() -> ProfileStore:
    global _store
    if _store is None:
        _store = ProfileStore("ytfarm.db")
    return _store


# --- Models ---

class GenerateRequest(BaseModel):
    count: int = 5

class ProxyAddRequest(BaseModel):
    url: str
    proxy_type: str = "http"

class ProxyCheckRequest(BaseModel):
    proxy_id: int

class TaskAddRequest(BaseModel):
    video_url: str
    watch_seconds: int = 30
    source: str = "search"
    search_query: Optional[str] = None
    actions: list[str] = []
    comment_text: Optional[str] = None
    repeat: int = 1

class FarmStartRequest(BaseModel):
    max_workers: int = 3
    headless: bool = True
    timeout: int = 15000
    max_retries: int = 3

class TasksFromYamlRequest(BaseModel):
    yaml_text: str


# --- Routes ---

@app.get("/", response_class=HTMLResponse)
async def index():
    return FileResponse(str(STATIC_DIR / "index.html"))


@app.get("/api/stats")
async def api_stats():
    store = get_store()
    return store.get_stats()


@app.get("/api/farm/status")
async def api_farm_status():
    return _farm_status


# --- Profiles ---

@app.get("/api/profiles")
async def api_profiles():
    store = get_store()
    with store.session() as s:
        from core.profile_store import Profile
        profiles = s.query(Profile).order_by(Profile.id.desc()).limit(200).all()
        return [
            {
                "id": p.id,
                "seed": p.seed[:12] + "...",
                "status": p.status,
                "proxy_id": p.proxy_id,
                "last_used": str(p.last_used)[:19] if p.last_used else None,
                "has_cookies": bool(p.cookies_json and p.cookies_json != "[]"),
                "created_at": str(p.created_at)[:19] if p.created_at else None,
            }
            for p in profiles
        ]


@app.post("/api/profiles/generate")
async def api_generate(req: GenerateRequest):
    store = get_store()
    created = 0
    for _ in range(req.count):
        seed = uuid.uuid4().hex
        fp = generate_fingerprint(seed)
        try:
            store.add_profile(seed=seed, fingerprint_json=fp.to_json())
            created += 1
        except Exception:
            pass
    return {"created": created}


@app.post("/api/profiles/reset")
async def api_profiles_reset():
    store = get_store()
    count = store.reset_busy_profiles()
    return {"reset": count}


@app.delete("/api/profiles/{profile_id}")
async def api_delete_profile(profile_id: int):
    store = get_store()
    with store.session() as s:
        from core.profile_store import Profile
        p = s.query(Profile).get(profile_id)
        if p:
            s.delete(p)
            s.commit()
            return {"deleted": True}
    raise HTTPException(404, "Profile not found")


# --- Proxies ---

@app.get("/api/proxies")
async def api_proxies():
    store = get_store()
    with store.session() as s:
        from core.profile_store import Proxy
        proxies = s.query(Proxy).order_by(Proxy.id.desc()).limit(200).all()
        return [
            {
                "id": px.id,
                "url": px.url,
                "proxy_type": px.proxy_type,
                "status": px.status,
                "fail_count": px.fail_count,
            }
            for px in proxies
        ]


@app.post("/api/proxies/add")
async def api_add_proxy(req: ProxyAddRequest):
    store = get_store()
    url = parse_proxy_url(req.url)
    try:
        px = store.add_proxy(url, req.proxy_type)
        return {"id": px.id, "url": px.url}
    except Exception as e:
        raise HTTPException(400, f"Failed to add proxy: {e}")


@app.post("/api/proxies/check")
async def api_check_proxy(req: ProxyCheckRequest):
    store = get_store()
    with store.session() as s:
        from core.profile_store import Proxy
        px = s.query(Proxy).get(req.proxy_id)
        if not px:
            raise HTTPException(404, "Proxy not found")
        ok = await check_proxy(px.url)
        if not ok:
            store.mark_proxy_failed(px.id)
        return {"proxy_id": px.id, "alive": ok}


@app.delete("/api/proxies/{proxy_id}")
async def api_delete_proxy(proxy_id: int):
    store = get_store()
    with store.session() as s:
        from core.profile_store import Proxy
        px = s.query(Proxy).get(proxy_id)
        if px:
            s.delete(px)
            s.commit()
            return {"deleted": True}
    raise HTTPException(404, "Proxy not found")


@app.post("/api/proxies/reset")
async def api_proxies_reset():
    store = get_store()
    count = store.reset_busy_proxies()
    return {"reset": count}


# --- Tasks ---

@app.get("/api/tasks")
async def api_tasks():
    store = get_store()
    with store.session() as s:
        tasks = s.query(Task).order_by(Task.id.desc()).limit(200).all()
        return [
            {
                "id": t.id,
                "video_url": t.video_url,
                "watch_seconds": t.watch_seconds,
                "source": t.source,
                "actions": json.loads(t.actions_json) if t.actions_json else [],
                "search_query": t.search_query,
                "comment_text": t.comment_text,
                "status": t.status,
            }
            for t in tasks
        ]


@app.post("/api/tasks/add")
async def api_add_task(req: TaskAddRequest):
    store = get_store()
    created = 0
    for _ in range(req.repeat):
        store.add_task(
            video_url=req.video_url,
            watch_seconds=req.watch_seconds,
            source=req.source,
            actions=req.actions,
            search_query=req.search_query,
            comment_text=req.comment_text,
        )
        created += 1
    return {"created": created}


@app.post("/api/tasks/load-yaml")
async def api_load_yaml(req: TasksFromYamlRequest):
    import yaml
    try:
        data = yaml.safe_load(req.yaml_text)
    except Exception as e:
        raise HTTPException(400, f"Invalid YAML: {e}")

    tasks_list = data if isinstance(data, list) else data.get("tasks", [])
    store = get_store()
    tq = TaskQueue(store)
    count = tq.load_from_config(tasks_list)
    return {"loaded": count}


@app.delete("/api/tasks/{task_id}")
async def api_delete_task(task_id: int):
    store = get_store()
    with store.session() as s:
        t = s.query(Task).get(task_id)
        if t:
            s.delete(t)
            s.commit()
            return {"deleted": True}
    raise HTTPException(404, "Task not found")


@app.post("/api/tasks/reset")
async def api_tasks_reset():
    store = get_store()
    count = store.reset_running_tasks()
    return {"reset": count}


# --- Logs ---

@app.get("/api/logs")
async def api_logs(limit: int = 50):
    store = get_store()
    logs = store.get_recent_logs(limit=limit)
    return [
        {
            "id": log.id,
            "profile_id": log.profile_id,
            "task_id": log.task_id,
            "result": log.result,
            "error_message": log.error_message,
            "duration_sec": log.duration_sec,
            "ts": str(log.ts)[:19] if log.ts else None,
        }
        for log in logs
    ]


# --- Farm control ---

@app.post("/api/farm/start")
async def api_farm_start(req: FarmStartRequest):
    global _running_task, _farm_status

    if _farm_status["running"]:
        raise HTTPException(400, "Farm is already running")

    store = get_store()
    tq = TaskQueue(store)
    pending = tq.pending_count()
    if pending == 0:
        raise HTTPException(400, "No pending tasks to run")

    scheduler = Scheduler(
        store=store,
        task_queue=tq,
        max_workers=req.max_workers,
        headless=req.headless,
        timeout=req.timeout,
        max_retries=req.max_retries,
    )

    _farm_status = {"running": True, "message": f"Running {pending} tasks with {req.max_workers} workers..."}

    async def _run():
        global _farm_status
        try:
            await scheduler.run()
            _farm_status = {"running": False, "message": "Finished successfully"}
        except Exception as e:
            _farm_status = {"running": False, "message": f"Error: {e}"}

    _running_task = asyncio.create_task(_run())
    return {"started": True, "pending_tasks": pending}


@app.post("/api/farm/stop")
async def api_farm_stop():
    global _running_task, _farm_status

    if not _farm_status["running"]:
        return {"stopped": False, "message": "Not running"}

    if _running_task and not _running_task.done():
        _running_task.cancel()
        try:
            await _running_task
        except asyncio.CancelledError:
            pass

    store = get_store()
    store.reset_busy_profiles()
    store.reset_busy_proxies()
    store.reset_running_tasks()

    _farm_status = {"running": False, "message": "Stopped by user"}
    return {"stopped": True}
