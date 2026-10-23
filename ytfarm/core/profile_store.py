"""SQLite-backed profile, proxy, task, scheduled-task and screenshot storage."""

import json
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    Column, Integer, String, Text, DateTime, Float, Boolean,
    ForeignKey, create_engine, event,
)
from sqlalchemy.orm import (
    DeclarativeBase, Session, sessionmaker, relationship,
)


class Base(DeclarativeBase):
    pass


class Profile(Base):
    __tablename__ = "profiles"

    id: int = Column(Integer, primary_key=True, autoincrement=True)
    seed: str = Column(String(64), unique=True, nullable=False)
    fingerprint_json: str = Column(Text, nullable=False)
    cookies_json: Optional[str] = Column(Text, nullable=True)
    storage_json: Optional[str] = Column(Text, nullable=True)
    status: str = Column(String(20), default="free", nullable=False)
    tags: Optional[str] = Column(Text, nullable=True)          # comma-separated
    proxy_id: Optional[int] = Column(Integer, ForeignKey("proxies.id"), nullable=True)
    last_used: Optional[datetime] = Column(DateTime, nullable=True)
    notes: Optional[str] = Column(Text, nullable=True)
    created_at: datetime = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )

    proxy = relationship("Proxy", back_populates="profiles")
    logs = relationship("TaskLog", back_populates="profile")
    screenshots = relationship("Screenshot", back_populates="profile")


class Proxy(Base):
    __tablename__ = "proxies"

    id: int = Column(Integer, primary_key=True, autoincrement=True)
    url: str = Column(String(512), unique=True, nullable=False)
    proxy_type: str = Column(String(20), default="http", nullable=False)
    status: str = Column(String(20), default="free", nullable=False)
    fail_count: int = Column(Integer, default=0, nullable=False)

    profiles = relationship("Profile", back_populates="proxy")


class Task(Base):
    __tablename__ = "tasks"

    id: int = Column(Integer, primary_key=True, autoincrement=True)
    name: Optional[str] = Column(String(255), nullable=True)
    target_url: str = Column(String(512), nullable=False)
    task_type: str = Column(String(30), default="general", nullable=False)
    # general actions: [{type, ...}]; legacy: ["like","subscribe"]
    actions_json: str = Column(Text, default="[]", nullable=False)
    # legacy YouTube fields
    watch_seconds: int = Column(Integer, default=30, nullable=False)
    source: str = Column(String(30), default="direct", nullable=False)
    search_query: Optional[str] = Column(String(512), nullable=True)
    comment_text: Optional[str] = Column(String(2000), nullable=True)
    priority: int = Column(Integer, default=5, nullable=False)   # 1-10, lower = higher
    status: str = Column(String(20), default="pending", nullable=False)
    created_at: datetime = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )
    logs = relationship("TaskLog", back_populates="task")
    screenshots = relationship("Screenshot", back_populates="task")


class TaskLog(Base):
    __tablename__ = "logs"

    id: int = Column(Integer, primary_key=True, autoincrement=True)
    profile_id: int = Column(Integer, ForeignKey("profiles.id"), nullable=False)
    task_id: int = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    result: str = Column(String(20), nullable=False)
    error_message: Optional[str] = Column(Text, nullable=True)
    ts: datetime = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )
    duration_sec: Optional[float] = Column(Float, nullable=True)

    profile = relationship("Profile", back_populates="logs")
    task = relationship("Task", back_populates="logs")


class ScheduledTask(Base):
    __tablename__ = "scheduled_tasks"

    id: int = Column(Integer, primary_key=True, autoincrement=True)
    name: str = Column(String(255), nullable=False)
    description: Optional[str] = Column(Text, nullable=True)
    cron_expr: str = Column(String(100), nullable=False)   # "*/5 * * * *"
    task_template_json: str = Column(Text, nullable=False) # Task fields as JSON
    enabled: bool = Column(Boolean, default=True, nullable=False)
    last_run: Optional[datetime] = Column(DateTime, nullable=True)
    next_run: Optional[datetime] = Column(DateTime, nullable=True)
    created_at: datetime = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )


class Screenshot(Base):
    __tablename__ = "screenshots"

    id: int = Column(Integer, primary_key=True, autoincrement=True)
    profile_id: Optional[int] = Column(Integer, ForeignKey("profiles.id"), nullable=True)
    task_id: Optional[int] = Column(Integer, ForeignKey("tasks.id"), nullable=True)
    filename: str = Column(String(255), nullable=False)
    filepath: Optional[str] = Column(Text, nullable=True)
    data_b64: Optional[str] = Column(Text, nullable=True)  # base64 PNG
    created_at: datetime = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )

    profile = relationship("Profile", back_populates="screenshots")
    task = relationship("Task", back_populates="screenshots")


class ProfileStore:
    def __init__(self, db_path: str = "ytfarm.db"):
        self.engine = create_engine(f"sqlite:///{db_path}", echo=False)

        @event.listens_for(self.engine, "connect")
        def _set_wal(dbapi_conn, _rec):
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.close()

        Base.metadata.create_all(self.engine)
        self._session_factory = sessionmaker(bind=self.engine)

    def session(self) -> Session:
        return self._session_factory()

    # ── Profiles ────────────────────────────────────────────────────────────

    def add_profile(self, seed: str, fingerprint_json: str, tags: str = "") -> "Profile":
        with self.session() as s:
            p = Profile(seed=seed, fingerprint_json=fingerprint_json, tags=tags)
            s.add(p)
            s.commit()
            s.refresh(p)
            return p

    def acquire_profile(self) -> Optional["Profile"]:
        with self.session() as s:
            p = (
                s.query(Profile)
                .filter(Profile.status == "free")
                .order_by(Profile.last_used.asc().nullsfirst())
                .with_for_update()
                .first()
            )
            if p:
                p.status = "busy"
                p.last_used = datetime.now(timezone.utc)
                s.commit()
                s.refresh(p)
            return p

    def release_profile(self, profile_id: int) -> None:
        with self.session() as s:
            p = s.query(Profile).get(profile_id)
            if p:
                p.status = "free"
                s.commit()

    def save_profile_state(
        self, profile_id: int, cookies_json: str, storage_json: Optional[str] = None
    ) -> None:
        with self.session() as s:
            p = s.query(Profile).get(profile_id)
            if p:
                p.cookies_json = cookies_json
                if storage_json:
                    p.storage_json = storage_json
                s.commit()

    def update_profile_tags(self, profile_id: int, tags: str) -> None:
        with self.session() as s:
            p = s.query(Profile).get(profile_id)
            if p:
                p.tags = tags
                s.commit()

    def update_profile_notes(self, profile_id: int, notes: str) -> None:
        with self.session() as s:
            p = s.query(Profile).get(profile_id)
            if p:
                p.notes = notes
                s.commit()

    def export_profiles(self, profile_ids: Optional[list[int]] = None) -> list[dict]:
        with self.session() as s:
            q = s.query(Profile)
            if profile_ids:
                q = q.filter(Profile.id.in_(profile_ids))
            profiles = q.all()
            result = []
            for p in profiles:
                result.append({
                    "seed": p.seed,
                    "fingerprint_json": p.fingerprint_json,
                    "cookies_json": p.cookies_json,
                    "storage_json": p.storage_json,
                    "tags": p.tags,
                    "notes": p.notes,
                    "created_at": str(p.created_at)[:19] if p.created_at else None,
                })
            return result

    def import_profiles(self, data: list[dict]) -> int:
        imported = 0
        for item in data:
            seed = item.get("seed")
            fp = item.get("fingerprint_json")
            if not seed or not fp:
                continue
            with self.session() as s:
                existing = s.query(Profile).filter(Profile.seed == seed).first()
                if existing:
                    continue
                p = Profile(
                    seed=seed,
                    fingerprint_json=fp,
                    cookies_json=item.get("cookies_json"),
                    storage_json=item.get("storage_json"),
                    tags=item.get("tags", ""),
                    notes=item.get("notes", ""),
                )
                s.add(p)
                s.commit()
                imported += 1
        return imported

    def reset_busy_profiles(self) -> int:
        with self.session() as s:
            count = s.query(Profile).filter(Profile.status == "busy").update({"status": "free"})
            s.commit()
            return count

    # ── Proxies ─────────────────────────────────────────────────────────────

    def add_proxy(self, url: str, proxy_type: str = "http") -> "Proxy":
        with self.session() as s:
            px = Proxy(url=url, proxy_type=proxy_type)
            s.add(px)
            s.commit()
            s.refresh(px)
            return px

    def acquire_proxy(self) -> Optional["Proxy"]:
        with self.session() as s:
            px = (
                s.query(Proxy)
                .filter(Proxy.status == "free", Proxy.fail_count < 5)
                .order_by(Proxy.fail_count.asc())
                .with_for_update()
                .first()
            )
            if px:
                px.status = "busy"
                s.commit()
                s.refresh(px)
            return px

    def release_proxy(self, proxy_id: int) -> None:
        with self.session() as s:
            px = s.query(Proxy).get(proxy_id)
            if px:
                px.status = "free"
                s.commit()

    def mark_proxy_failed(self, proxy_id: int) -> None:
        with self.session() as s:
            px = s.query(Proxy).get(proxy_id)
            if px:
                px.fail_count += 1
                px.status = "free"
                s.commit()

    def reset_busy_proxies(self) -> int:
        with self.session() as s:
            count = s.query(Proxy).filter(Proxy.status == "busy").update({"status": "free"})
            s.commit()
            return count

    # ── Tasks ────────────────────────────────────────────────────────────────

    def add_task(
        self,
        target_url: str,
        name: Optional[str] = None,
        task_type: str = "general",
        actions: Optional[list] = None,
        watch_seconds: int = 30,
        source: str = "direct",
        search_query: Optional[str] = None,
        comment_text: Optional[str] = None,
        priority: int = 5,
    ) -> "Task":
        with self.session() as s:
            t = Task(
                target_url=target_url,
                name=name,
                task_type=task_type,
                actions_json=json.dumps(actions or []),
                watch_seconds=watch_seconds,
                source=source,
                search_query=search_query,
                comment_text=comment_text,
                priority=priority,
            )
            s.add(t)
            s.commit()
            s.refresh(t)
            return t

    def acquire_task(self) -> Optional["Task"]:
        with self.session() as s:
            t = (
                s.query(Task)
                .filter(Task.status == "pending")
                .order_by(Task.priority.asc(), Task.id.asc())
                .with_for_update()
                .first()
            )
            if t:
                t.status = "running"
                s.commit()
                s.refresh(t)
            return t

    def complete_task(self, task_id: int, status: str = "done") -> None:
        with self.session() as s:
            t = s.query(Task).get(task_id)
            if t:
                t.status = status
                s.commit()

    def reset_running_tasks(self) -> int:
        with self.session() as s:
            count = (
                s.query(Task)
                .filter(Task.status == "running")
                .update({"status": "pending"})
            )
            s.commit()
            return count

    # ── Logs ─────────────────────────────────────────────────────────────────

    def log_result(
        self,
        profile_id: int,
        task_id: int,
        result: str,
        error_message: Optional[str] = None,
        duration_sec: Optional[float] = None,
    ) -> "TaskLog":
        with self.session() as s:
            log = TaskLog(
                profile_id=profile_id,
                task_id=task_id,
                result=result,
                error_message=error_message,
                duration_sec=duration_sec,
            )
            s.add(log)
            s.commit()
            s.refresh(log)
            return log

    def get_recent_logs(self, limit: int = 50) -> list["TaskLog"]:
        with self.session() as s:
            return (
                s.query(TaskLog)
                .order_by(TaskLog.ts.desc())
                .limit(limit)
                .all()
            )

    # ── Scheduled Tasks ──────────────────────────────────────────────────────

    def add_scheduled_task(
        self,
        name: str,
        cron_expr: str,
        task_template: dict,
        description: str = "",
    ) -> "ScheduledTask":
        with self.session() as s:
            st = ScheduledTask(
                name=name,
                description=description,
                cron_expr=cron_expr,
                task_template_json=json.dumps(task_template),
            )
            s.add(st)
            s.commit()
            s.refresh(st)
            return st

    def list_scheduled_tasks(self) -> list["ScheduledTask"]:
        with self.session() as s:
            return s.query(ScheduledTask).order_by(ScheduledTask.id.asc()).all()

    def update_scheduled_task(self, st_id: int, **kwargs) -> None:
        with self.session() as s:
            st = s.query(ScheduledTask).get(st_id)
            if st:
                for k, v in kwargs.items():
                    setattr(st, k, v)
                s.commit()

    def delete_scheduled_task(self, st_id: int) -> bool:
        with self.session() as s:
            st = s.query(ScheduledTask).get(st_id)
            if st:
                s.delete(st)
                s.commit()
                return True
            return False

    # ── Screenshots ──────────────────────────────────────────────────────────

    def save_screenshot(
        self,
        filename: str,
        data_b64: Optional[str] = None,
        filepath: Optional[str] = None,
        profile_id: Optional[int] = None,
        task_id: Optional[int] = None,
    ) -> "Screenshot":
        with self.session() as s:
            sc = Screenshot(
                filename=filename,
                data_b64=data_b64,
                filepath=filepath,
                profile_id=profile_id,
                task_id=task_id,
            )
            s.add(sc)
            s.commit()
            s.refresh(sc)
            return sc

    def list_screenshots(self, limit: int = 50) -> list["Screenshot"]:
        with self.session() as s:
            return (
                s.query(Screenshot)
                .order_by(Screenshot.created_at.desc())
                .limit(limit)
                .all()
            )

    # ── Stats ─────────────────────────────────────────────────────────────────

    def get_stats(self) -> dict:
        with self.session() as s:
            total_profiles = s.query(Profile).count()
            busy_profiles = s.query(Profile).filter(Profile.status == "busy").count()
            total_proxies = s.query(Proxy).count()
            healthy_proxies = s.query(Proxy).filter(Proxy.fail_count < 5).count()
            total_tasks = s.query(Task).count()
            done_tasks = s.query(Task).filter(Task.status == "done").count()
            failed_tasks = s.query(Task).filter(Task.status == "failed").count()
            pending_tasks = s.query(Task).filter(Task.status == "pending").count()
            total_logs = s.query(TaskLog).count()
            success_logs = s.query(TaskLog).filter(TaskLog.result == "ok").count()
            return {
                "profiles_total": total_profiles,
                "profiles_busy": busy_profiles,
                "proxies_total": total_proxies,
                "proxies_healthy": healthy_proxies,
                "tasks_total": total_tasks,
                "tasks_done": done_tasks,
                "tasks_failed": failed_tasks,
                "tasks_pending": pending_tasks,
                "logs_total": total_logs,
                "logs_success": success_logs,
            }
