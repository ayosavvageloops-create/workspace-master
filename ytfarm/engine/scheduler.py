"""Scheduler: orchestrates N workers consuming tasks from the queue."""

import asyncio
import signal
from pathlib import Path
from typing import Any, Callable, Optional

from rich.console import Console
from rich.table import Table

from core.profile_store import ProfileStore
from engine.queue import TaskQueue
from engine.worker import Worker, LogCallback

console = Console()


class Scheduler:
    def __init__(
        self,
        store: ProfileStore,
        task_queue: TaskQueue,
        max_workers: int = 3,
        headless: bool = True,
        timeout: int = 15000,
        max_retries: int = 3,
        screenshots_dir: Optional[Path] = None,
        on_log: Optional[LogCallback] = None,
        on_status: Optional[Callable[[str], None]] = None,
    ):
        self.store = store
        self.task_queue = task_queue
        self.max_workers = max_workers
        self.headless = headless
        self.timeout = timeout
        self.max_retries = max_retries
        self.screenshots_dir = screenshots_dir
        self.on_log = on_log
        self.on_status = on_status
        self._shutdown = False

    def _emit_status(self, msg: str) -> None:
        if self.on_status:
            try:
                self.on_status(msg)
            except Exception:
                pass

    async def run(self) -> None:
        self.store.reset_busy_profiles()
        self.store.reset_busy_proxies()
        self.store.reset_running_tasks()

        loop = asyncio.get_event_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, self._signal_handler)
            except NotImplementedError:
                pass

        pending = self.task_queue.pending_count()
        self._emit_status(f"Running {pending} tasks with {self.max_workers} workers")
        console.log(f"[green]Scheduler: {self.max_workers} workers, {pending} tasks[/green]")

        sem = asyncio.Semaphore(self.max_workers)
        tasks_launched: list[asyncio.Task] = []

        while not self._shutdown:
            task = self.task_queue.next_task()
            if not task:
                if not tasks_launched or all(t.done() for t in tasks_launched):
                    console.log("[yellow]No more tasks. Stopping.[/yellow]")
                    break
                await asyncio.sleep(1)
                continue

            await sem.acquire()
            if self._shutdown:
                self.task_queue.complete(task.id, "pending")
                break

            t = asyncio.create_task(self._worker_wrapper(sem, task))
            tasks_launched.append(t)

        if tasks_launched:
            await asyncio.gather(*tasks_launched, return_exceptions=True)

        self.store.reset_busy_profiles()
        self.store.reset_busy_proxies()
        self._emit_status("Finished")
        console.log("[green]Scheduler finished[/green]")
        self._print_summary()

    async def _worker_wrapper(self, sem: asyncio.Semaphore, task: Any) -> None:
        try:
            worker = Worker(
                worker_id=task.id,
                store=self.store,
                headless=self.headless,
                timeout=self.timeout,
                screenshots_dir=self.screenshots_dir,
                on_log=self.on_log,
            )
            retries = 0
            result = "error"

            while retries < self.max_retries and not self._shutdown:
                result = await worker.run_task(task)
                if result == "ok":
                    break
                retries += 1
                if retries < self.max_retries:
                    backoff = 2 ** retries
                    console.log(f"[yellow]Task {task.id} retry {retries}/{self.max_retries} in {backoff}s[/yellow]")
                    await asyncio.sleep(backoff)

            self.task_queue.complete(task.id, "done" if result == "ok" else "failed")

        except Exception as exc:
            console.log(f"[red]Worker error for task {task.id}: {exc}[/red]")
            self.task_queue.complete(task.id, "failed")
        finally:
            sem.release()

    def _signal_handler(self) -> None:
        if not self._shutdown:
            console.log("[yellow]Shutdown signal received...[/yellow]")
            self._shutdown = True
            self._emit_status("Stopping...")

    def _print_summary(self) -> None:
        stats = self.store.get_stats()
        table = Table(title="Run Summary")
        table.add_column("Metric", style="cyan")
        table.add_column("Value", style="green")
        for key, val in stats.items():
            table.add_row(key.replace("_", " ").title(), str(val))
        console.print(table)
