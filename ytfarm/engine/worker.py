"""Worker: takes a profile + proxy + task, runs a full browser session."""

import asyncio
import json
import time
from typing import Optional

from playwright.async_api import async_playwright
from rich.console import Console

from core.browser import create_browser_context, save_context_state
from core.fingerprint import Fingerprint
from core.profile_store import ProfileStore, Profile, Proxy, Task
from core.proxy import check_proxy
from actions.search import search_and_open_video
from actions.watch import watch_video
from actions.like import like_video
from actions.subscribe import subscribe_to_channel
from actions.comment import leave_comment
from behavior.human import random_delay

console = Console()


class Worker:
    def __init__(
        self,
        worker_id: int,
        store: ProfileStore,
        headless: bool = True,
        timeout: int = 15000,
    ):
        self.worker_id = worker_id
        self.store = store
        self.headless = headless
        self.timeout = timeout
        self.profile: Optional[Profile] = None
        self.proxy: Optional[Proxy] = None
        self._tag = f"[W{worker_id}]"

    async def run_task(self, task: Task) -> str:
        start = time.monotonic()
        result = "ok"
        error_msg: Optional[str] = None

        self.profile = self.store.acquire_profile()
        if not self.profile:
            console.log(f"{self._tag} No free profile available")
            return "no_profile"

        self.proxy = self.store.acquire_proxy()

        proxy_url: Optional[str] = None
        if self.proxy:
            proxy_ok = await check_proxy(self.proxy.url)
            if not proxy_ok:
                console.log(
                    f"{self._tag} Proxy {self.proxy.url} failed, trying another"
                )
                self.store.mark_proxy_failed(self.proxy.id)
                self.proxy = self.store.acquire_proxy()
                if self.proxy:
                    proxy_ok = await check_proxy(self.proxy.url)
                    if not proxy_ok:
                        self.store.mark_proxy_failed(self.proxy.id)
                        self.proxy = None

            if self.proxy:
                proxy_url = self.proxy.url

        fingerprint = Fingerprint.from_json(self.profile.fingerprint_json)
        actions_list: list[str] = (
            json.loads(task.actions_json) if task.actions_json else []
        )

        console.log(
            f"{self._tag} Profile={self.profile.id} "
            f"Proxy={'yes' if proxy_url else 'none'} "
            f"Task={task.id} Video={task.video_url[:50]}"
        )

        pw = None
        browser = None
        context = None

        try:
            pw = await async_playwright().start()
            browser, context = await create_browser_context(
                pw,
                fingerprint,
                proxy_url=proxy_url,
                cookies_json=self.profile.cookies_json,
                storage_json=self.profile.storage_json,
                headless=self.headless,
            )

            page = await context.new_page()

            opened = await self._navigate_to_video(page, task)
            if not opened:
                raise RuntimeError("Failed to open video page")

            console.log(f"{self._tag} Watching for {task.watch_seconds}s ...")
            await watch_video(page, task.watch_seconds, timeout=self.timeout)
            console.log(f"{self._tag} Watch complete")

            if "like" in actions_list:
                ok = await like_video(page, timeout=self.timeout)
                console.log(f"{self._tag} Like: {'ok' if ok else 'failed'}")

            if "subscribe" in actions_list:
                ok = await subscribe_to_channel(page, timeout=self.timeout)
                console.log(f"{self._tag} Subscribe: {'ok' if ok else 'failed'}")

            if "comment" in actions_list and task.comment_text:
                ok = await leave_comment(
                    page, task.comment_text, timeout=self.timeout
                )
                console.log(f"{self._tag} Comment: {'ok' if ok else 'failed'}")

            cookies_json, storage_json = await save_context_state(context)
            self.store.save_profile_state(
                self.profile.id, cookies_json, storage_json
            )

        except Exception as exc:
            result = "error"
            error_msg = f"{type(exc).__name__}: {exc}"
            console.log(f"{self._tag} [red]Error: {error_msg}[/red]")

        finally:
            if context:
                try:
                    await context.close()
                except Exception:
                    pass
            if browser:
                try:
                    await browser.close()
                except Exception:
                    pass
            if pw:
                try:
                    await pw.stop()
                except Exception:
                    pass

            if self.profile:
                self.store.release_profile(self.profile.id)
            if self.proxy:
                self.store.release_proxy(self.proxy.id)

        duration = time.monotonic() - start
        self.store.log_result(
            profile_id=self.profile.id if self.profile else 0,
            task_id=task.id,
            result=result,
            error_message=error_msg,
            duration_sec=round(duration, 2),
        )
        console.log(
            f"{self._tag} Task {task.id} finished: {result} ({duration:.1f}s)"
        )
        return result

    async def _navigate_to_video(self, page, task: Task) -> bool:
        if task.source == "search" and task.search_query:
            return await search_and_open_video(
                page,
                task.search_query,
                target_video_url=task.video_url,
                timeout=self.timeout,
            )
        elif task.source == "homepage":
            await page.goto(
                "https://www.youtube.com",
                wait_until="domcontentloaded",
                timeout=self.timeout,
            )
            await random_delay(2000, 5000)
            await page.goto(
                task.video_url,
                wait_until="domcontentloaded",
                timeout=self.timeout,
            )
            await random_delay(1000, 3000)
            return True
        else:
            await page.goto(
                task.video_url,
                wait_until="domcontentloaded",
                timeout=self.timeout,
            )
            await random_delay(2000, 4000)
            return True
