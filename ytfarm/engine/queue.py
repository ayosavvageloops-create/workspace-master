"""Task queue backed by ProfileStore."""

from typing import Optional

from core.profile_store import ProfileStore, Task


class TaskQueue:
    def __init__(self, store: ProfileStore):
        self.store = store

    def next_task(self) -> Optional[Task]:
        return self.store.acquire_task()

    def complete(self, task_id: int, status: str = "done") -> None:
        self.store.complete_task(task_id, status)

    def pending_count(self) -> int:
        with self.store.session() as s:
            return s.query(Task).filter(Task.status == "pending").count()

    def load_from_config(self, tasks_list: list[dict]) -> int:
        loaded = 0
        for item in tasks_list:
            url = item.get("url") or item.get("target_url") or item.get("video_url", "")
            if not url:
                continue
            actions_raw = item.get("actions", [])
            repeat = item.get("repeat", 1)
            for _ in range(max(1, repeat)):
                self.store.add_task(
                    target_url=url,
                    name=item.get("name"),
                    task_type=item.get("task_type", "general") if isinstance(actions_raw[0] if actions_raw else None, dict) else "youtube",
                    actions=actions_raw,
                    watch_seconds=item.get("watch_seconds", 30),
                    source=item.get("source", "direct"),
                    search_query=item.get("search_query"),
                    comment_text=item.get("comment_text"),
                    priority=item.get("priority", 5),
                )
                loaded += 1
        return loaded
