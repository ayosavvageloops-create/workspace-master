"""Task queue: load tasks from YAML config into DB and serve them to workers."""

import json
from typing import Any, Optional

from core.profile_store import ProfileStore, Task


class TaskQueue:
    def __init__(self, store: ProfileStore):
        self.store = store

    def load_from_config(self, tasks_config: list[dict[str, Any]]) -> int:
        count = 0
        for item in tasks_config:
            video_url = item.get("url", "")
            if not video_url:
                continue

            watch_seconds = item.get("watch_seconds", 30)
            source = item.get("source", "search")
            actions = item.get("actions", [])
            search_query = item.get("search_query")
            comment_text = item.get("comment_text")

            repeat = item.get("repeat", 1)
            for _ in range(repeat):
                self.store.add_task(
                    video_url=video_url,
                    watch_seconds=watch_seconds,
                    source=source,
                    actions=actions,
                    search_query=search_query,
                    comment_text=comment_text,
                )
                count += 1

        return count

    def next_task(self) -> Optional[Task]:
        return self.store.acquire_task()

    def complete(self, task_id: int, status: str = "done") -> None:
        self.store.complete_task(task_id, status)

    def pending_count(self) -> int:
        with self.store.session() as s:
            return s.query(Task).filter(Task.status == "pending").count()
