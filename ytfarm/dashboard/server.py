"""FastAPI dashboard backend with WebSocket real-time log streaming."""

import asyncio
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from core.fingerprint import generate_fingerprint
from core.profile_store import ProfileStore, Task
from core.proxy import check_proxy, parse_proxy_url
from engine.queue import TaskQueue
from engine.scheduler import Scheduler

app = FastAPI(title="BrowserFarm Dashboard")

STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

_store: Optional[ProfileStore] = None
_running_task: Optional[asyncio.Task] = None
_farm_status = {"running": False, "message": "Idle", "workers": 0, "pending": 0}
_ws_clients: list[WebSocket] = []


def get_store() -> ProfileStore:
    global _store
    if _store is None:
        _store = ProfileStore("ytfarm.db")
    return _store


async def _broadcast(event_type: str, data: dict) -> None:
    if not _ws_clients:
        return
    msg = json.dumps({"type": event_type, **data})
    dead = []
    for ws in list(_ws_clients):
        try:
            await ws.send_text(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _ws_clients.discard(ws) if hasattr(_ws_clients, "discard") else None
        try:
            _ws_clients.remove(ws)
        except ValueError:
            pass


def _log_callback(profile_id: int, task_id: int, result: str, error: Optional[str], duration: float) -> None:
    asyncio.get_event_loop().call_soon_threadsafe(
        lambda: asyncio.ensure_future(_broadcast("log", {
            "profile_id": profile_id,
            "task_id": task_id,
            "result": result,
            "error": error,
            "duration_sec": duration,
            "ts": datetime.now(timezone.utc).isoformat(),
        }))
    )


def _status_callback(msg: str) -> None:
    global _farm_status
    _farm_status["message"] = msg
    asyncio.get_event_loop().call_soon_threadsafe(
        lambda: asyncio.ensure_future(_broadcast("status", {"message": msg, "running": _farm_status["running"]}))
    )


# ── Models ────────────────────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    count: int = 5
    tags: str = ""


class ProxyAddRequest(BaseModel):
    url: str
    proxy_type: str = "http"


class ProxyCheckRequest(BaseModel):
    proxy_id: int


class TaskAddRequest(BaseModel):
    target_url: str
    name: Optional[str] = None
    task_type: str = "general"
    actions: list = []
    watch_seconds: int = 30
    source: str = "direct"
    search_query: Optional[str] = None
    comment_text: Optional[str] = None
    priority: int = 5
    repeat: int = 1


class TasksFromYamlRequest(BaseModel):
    yaml_text: str


class FarmStartRequest(BaseModel):
    max_workers: int = 3
    headless: bool = True
    timeout: int = 15000
    max_retries: int = 3


class ProfileImportRequest(BaseModel):
    profiles: list[dict]


class ProfileTagsRequest(BaseModel):
    tags: str


class ProfileNotesRequest(BaseModel):
    notes: str


class ScheduledTaskRequest(BaseModel):
    name: str
    description: str = ""
    cron_expr: str
    task_template: dict
    enabled: bool = True


# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws/logs")
async def ws_logs(websocket: WebSocket):
    await websocket.accept()
    _ws_clients.append(websocket)
    try:
        await websocket.send_text(json.dumps({"type": "connected", "message": "Live log stream connected"}))
        while True:
            await asyncio.sleep(30)
            try:
                await websocket.send_text(json.dumps({"type": "ping"}))
            except Exception:
                break
    except WebSocketDisconnect:
        pass
    finally:
        try:
            _ws_clients.remove(websocket)
        except ValueError:
            pass


# ── Pages ─────────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index():
    return FileResponse(str(STATIC_DIR / "index.html"))


@app.get("/api/stats")
async def api_stats():
    return get_store().get_stats()


@app.get("/api/farm/status")
async def api_farm_status():
    return _farm_status


# ── Profiles ──────────────────────────────────────────────────────────────────

@app.get("/api/profiles")
async def api_profiles(tag: Optional[str] = None):
    store = get_store()
    with store.session() as s:
        from core.profile_store import Profile
        q = s.query(Profile).order_by(Profile.id.desc()).limit(500)
        profiles = q.all()
        result = []
        for p in profiles:
            if tag and (not p.tags or tag not in p.tags.split(",")):
                continue
            result.append({
                "id": p.id,
                "seed": p.seed[:12] + "...",
                "status": p.status,
                "proxy_id": p.proxy_id,
                "tags": p.tags or "",
                "notes": p.notes or "",
                "last_used": str(p.last_used)[:19] if p.last_used else None,
                "has_cookies": bool(p.cookies_json and p.cookies_json != "[]"),
                "created_at": str(p.created_at)[:19] if p.created_at else None,
            })
        return result


@app.get("/api/profiles/{profile_id}/fingerprint")
async def api_profile_fingerprint(profile_id: int):
    store = get_store()
    with store.session() as s:
        from core.profile_store import Profile
        p = s.query(Profile).get(profile_id)
        if not p:
            raise HTTPException(404, "Profile not found")
        import json as _json
        fp = _json.loads(p.fingerprint_json)
        return {"profile_id": profile_id, "fingerprint": fp}


@app.post("/api/profiles/generate")
async def api_generate(req: GenerateRequest):
    store = get_store()
    created = 0
    for _ in range(req.count):
        seed = uuid.uuid4().hex
        fp = generate_fingerprint(seed)
        try:
            store.add_profile(seed=seed, fingerprint_json=fp.to_json(), tags=req.tags)
            created += 1
        except Exception:
            pass
    await _broadcast("profiles_changed", {"created": created})
    return {"created": created}


@app.post("/api/profiles/reset")
async def api_profiles_reset():
    count = get_store().reset_busy_profiles()
    return {"reset": count}


@app.post("/api/profiles/{profile_id}/tags")
async def api_profile_tags(profile_id: int, req: ProfileTagsRequest):
    get_store().update_profile_tags(profile_id, req.tags)
    return {"ok": True}


@app.post("/api/profiles/{profile_id}/notes")
async def api_profile_notes(profile_id: int, req: ProfileNotesRequest):
    get_store().update_profile_notes(profile_id, req.notes)
    return {"ok": True}


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


@app.get("/api/profiles/export")
async def api_export_profiles():
    data = get_store().export_profiles()
    return Response(
        content=json.dumps(data, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=profiles_export.json"},
    )


@app.post("/api/profiles/import")
async def api_import_profiles(req: ProfileImportRequest):
    imported = get_store().import_profiles(req.profiles)
    await _broadcast("profiles_changed", {"imported": imported})
    return {"imported": imported}


# ── Proxies ───────────────────────────────────────────────────────────────────

@app.get("/api/proxies")
async def api_proxies():
    store = get_store()
    with store.session() as s:
        from core.profile_store import Proxy
        proxies = s.query(Proxy).order_by(Proxy.id.desc()).limit(500).all()
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


@app.post("/api/proxies/bulk")
async def api_bulk_proxies(body: dict):
    lines = body.get("lines", "").strip().splitlines()
    store = get_store()
    added = 0
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            url = parse_proxy_url(line)
            store.add_proxy(url)
            added += 1
        except Exception:
            pass
    return {"added": added}


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
    count = get_store().reset_busy_proxies()
    return {"reset": count}


# ── Tasks ─────────────────────────────────────────────────────────────────────

@app.get("/api/tasks")
async def api_tasks(status: Optional[str] = None):
    store = get_store()
    with store.session() as s:
        q = s.query(Task).order_by(Task.priority.asc(), Task.id.desc()).limit(500)
        tasks = q.all()
        result = []
        for t in tasks:
            if status and t.status != status:
                continue
            result.append({
                "id": t.id,
                "name": t.name,
                "target_url": t.target_url,
                "task_type": t.task_type,
                "actions": json.loads(t.actions_json) if t.actions_json else [],
                "watch_seconds": t.watch_seconds,
                "source": t.source,
                "search_query": t.search_query,
                "comment_text": t.comment_text,
                "priority": t.priority,
                "status": t.status,
                "created_at": str(t.created_at)[:19] if t.created_at else None,
            })
        return result


@app.post("/api/tasks/add")
async def api_add_task(req: TaskAddRequest):
    store = get_store()
    created = 0
    for _ in range(max(1, req.repeat)):
        store.add_task(
            target_url=req.target_url,
            name=req.name,
            task_type=req.task_type,
            actions=req.actions,
            watch_seconds=req.watch_seconds,
            source=req.source,
            search_query=req.search_query,
            comment_text=req.comment_text,
            priority=req.priority,
        )
        created += 1
    await _broadcast("tasks_changed", {"created": created})
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
    await _broadcast("tasks_changed", {"loaded": count})
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
    count = get_store().reset_running_tasks()
    return {"reset": count}


@app.delete("/api/tasks")
async def api_clear_tasks(status: Optional[str] = None):
    store = get_store()
    with store.session() as s:
        q = s.query(Task)
        if status:
            q = q.filter(Task.status == status)
        count = q.delete()
        s.commit()
        return {"deleted": count}


# ── Logs ──────────────────────────────────────────────────────────────────────

@app.get("/api/logs")
async def api_logs(limit: int = 100):
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


# ── Screenshots ────────────────────────────────────────────────────────────────

@app.get("/api/screenshots")
async def api_screenshots(limit: int = 50):
    store = get_store()
    shots = store.list_screenshots(limit=limit)
    return [
        {
            "id": s.id,
            "filename": s.filename,
            "filepath": s.filepath,
            "has_data": bool(s.data_b64),
            "profile_id": s.profile_id,
            "task_id": s.task_id,
            "created_at": str(s.created_at)[:19] if s.created_at else None,
        }
        for s in shots
    ]


@app.get("/api/screenshots/{shot_id}/data")
async def api_screenshot_data(shot_id: int):
    store = get_store()
    with store.session() as s:
        from core.profile_store import Screenshot
        shot = s.query(Screenshot).get(shot_id)
        if not shot:
            raise HTTPException(404, "Screenshot not found")
        if shot.data_b64:
            import base64
            data = base64.b64decode(shot.data_b64)
            return Response(content=data, media_type="image/png")
        if shot.filepath and Path(shot.filepath).exists():
            return FileResponse(shot.filepath, media_type="image/png")
        raise HTTPException(404, "Screenshot data not available")


# ── Scheduled Tasks ────────────────────────────────────────────────────────────

@app.get("/api/scheduled-tasks")
async def api_list_scheduled_tasks():
    store = get_store()
    tasks = store.list_scheduled_tasks()
    return [
        {
            "id": st.id,
            "name": st.name,
            "description": st.description,
            "cron_expr": st.cron_expr,
            "task_template": json.loads(st.task_template_json),
            "enabled": st.enabled,
            "last_run": str(st.last_run)[:19] if st.last_run else None,
            "next_run": str(st.next_run)[:19] if st.next_run else None,
            "created_at": str(st.created_at)[:19] if st.created_at else None,
        }
        for st in tasks
    ]


@app.post("/api/scheduled-tasks")
async def api_add_scheduled_task(req: ScheduledTaskRequest):
    store = get_store()
    st = store.add_scheduled_task(
        name=req.name,
        description=req.description,
        cron_expr=req.cron_expr,
        task_template=req.task_template,
    )
    return {"id": st.id, "name": st.name}


@app.patch("/api/scheduled-tasks/{st_id}")
async def api_update_scheduled_task(st_id: int, body: dict):
    get_store().update_scheduled_task(st_id, **body)
    return {"ok": True}


@app.delete("/api/scheduled-tasks/{st_id}")
async def api_delete_scheduled_task(st_id: int):
    ok = get_store().delete_scheduled_task(st_id)
    if not ok:
        raise HTTPException(404, "Scheduled task not found")
    return {"deleted": True}


@app.post("/api/scheduled-tasks/{st_id}/run-now")
async def api_run_scheduled_task_now(st_id: int):
    store = get_store()
    tasks = store.list_scheduled_tasks()
    st = next((t for t in tasks if t.id == st_id), None)
    if not st:
        raise HTTPException(404, "Scheduled task not found")
    template = json.loads(st.task_template_json)
    store.add_task(
        target_url=template.get("target_url", ""),
        name=f"[Scheduled] {st.name}",
        task_type=template.get("task_type", "general"),
        actions=template.get("actions", []),
        watch_seconds=template.get("watch_seconds", 30),
        source=template.get("source", "direct"),
        search_query=template.get("search_query"),
        comment_text=template.get("comment_text"),
        priority=template.get("priority", 5),
    )
    store.update_scheduled_task(st_id, last_run=datetime.now(timezone.utc))
    return {"queued": True}


# ── Farm control ──────────────────────────────────────────────────────────────

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
        on_log=_log_callback,
        on_status=_status_callback,
    )

    _farm_status = {
        "running": True,
        "message": f"Running {pending} tasks with {req.max_workers} workers...",
        "workers": req.max_workers,
        "pending": pending,
    }
    await _broadcast("status", _farm_status)

    async def _run():
        global _farm_status
        try:
            await scheduler.run()
            _farm_status = {"running": False, "message": "Finished successfully", "workers": 0, "pending": 0}
        except Exception as e:
            _farm_status = {"running": False, "message": f"Error: {e}", "workers": 0, "pending": 0}
        await _broadcast("status", _farm_status)

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

    _farm_status = {"running": False, "message": "Stopped by user", "workers": 0, "pending": 0}
    await _broadcast("status", _farm_status)
    return {"stopped": True}
