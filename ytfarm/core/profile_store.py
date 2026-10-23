"""SQLite-backed profile and proxy storage via SQLAlchemy."""

import json
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    Column, Integer, String, Text, DateTime, Float, ForeignKey,
    create_engine, event,
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
    proxy_id: Optional[int] = Column(Integer, ForeignKey("proxies.id"), nullable=True)
    last_used: Optional[datetime] = Column(DateTime, nullable=True)
    notes: Optional[str] = Column(Text, nullable=True)
    created_at: datetime = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )

    proxy = relationship("Proxy", back_populates="profiles")
    logs = relationship("TaskLog", back_populates="profile")


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
    video_url: str = Column(String(512), nullable=False)
    watch_seconds: int = Column(Integer, default=30, nullable=False)
    source: str = Column(String(30), default="search", nullable=False)
    actions_json: str = Column(Text, default="[]", nullable=False)
    search_query: Optional[str] = Column(String(512), nullable=True)
    comment_text: Optional[str] = Column(String(2000), nullable=True)
    status: str = Column(String(20), default="pending", nullable=False)


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
    task = relationship("Task")


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

    def add_profile(self, seed: str, fingerprint_json: str) -> Profile:
        with self.session() as s:
            p = Profile(seed=seed, fingerprint_json=fingerprint_json)
            s.add(p)
            s.commit()
            s.refresh(p)
            return p

    def add_proxy(self, url: str, proxy_type: str = "http") -> Proxy:
        with self.session() as s:
            px = Proxy(url=url, proxy_type=proxy_type)
            s.add(px)
            s.commit()
            s.refresh(px)
            return px

    def acquire_profile(self) -> Optional[Profile]:
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

    def acquire_proxy(self) -> Optional[Proxy]:
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

    def add_task(
        self,
        video_url: str,
        watch_seconds: int = 30,
        source: str = "search",
        actions: Optional[list[str]] = None,
        search_query: Optional[str] = None,
        comment_text: Optional[str] = None,
    ) -> Task:
        with self.session() as s:
            t = Task(
                video_url=video_url,
                watch_seconds=watch_seconds,
                source=source,
                actions_json=json.dumps(actions or []),
                search_query=search_query,
                comment_text=comment_text,
            )
            s.add(t)
            s.commit()
            s.refresh(t)
            return t

    def acquire_task(self) -> Optional[Task]:
        with self.session() as s:
            t = (
                s.query(Task)
                .filter(Task.status == "pending")
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

    def log_result(
        self,
        profile_id: int,
        task_id: int,
        result: str,
        error_message: Optional[str] = None,
        duration_sec: Optional[float] = None,
    ) -> TaskLog:
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

    def reset_busy_profiles(self) -> int:
        with self.session() as s:
            count = (
                s.query(Profile)
                .filter(Profile.status == "busy")
                .update({"status": "free"})
            )
            s.commit()
            return count

    def reset_busy_proxies(self) -> int:
        with self.session() as s:
            count = (
                s.query(Proxy)
                .filter(Proxy.status == "busy")
                .update({"status": "free"})
            )
            s.commit()
            return count

    def reset_running_tasks(self) -> int:
        with self.session() as s:
            count = (
                s.query(Task)
                .filter(Task.status == "running")
                .update({"status": "pending"})
            )
            s.commit()
            return count

    def get_recent_logs(self, limit: int = 50) -> list[TaskLog]:
        with self.session() as s:
            return (
                s.query(TaskLog)
                .order_by(TaskLog.ts.desc())
                .limit(limit)
                .all()
            )
