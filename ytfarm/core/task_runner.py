"""General-purpose action runner for browser automation tasks."""

import asyncio
import base64
import random
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional

from playwright.async_api import Page

from behavior.human import (
    human_click, human_type, smooth_scroll, random_delay, move_mouse_human,
)


@dataclass
class ActionResult:
    success: bool
    data: Any = None
    error: Optional[str] = None
    action_type: str = ""


@dataclass
class RunReport:
    task_id: int
    profile_id: int
    actions: list[ActionResult] = field(default_factory=list)
    screenshots: list[str] = field(default_factory=list)

    @property
    def success(self) -> bool:
        return all(r.success for r in self.actions if r.action_type != "screenshot")

    @property
    def error(self) -> Optional[str]:
        for r in self.actions:
            if not r.success and r.error:
                return r.error
        return None


async def run_actions(
    page: Page,
    actions: list[dict],
    timeout: int = 15000,
    screenshots_dir: Optional[Path] = None,
    on_action: Optional[Callable[[str, bool], None]] = None,
) -> RunReport:
    report = RunReport(task_id=0, profile_id=0)

    for action in actions:
        action_type = action.get("type", "unknown")
        try:
            result = await _run_single(page, action, timeout, screenshots_dir)
            result.action_type = action_type
            report.actions.append(result)
            if on_action:
                on_action(action_type, result.success)
            if result.data and "path" in result.data:
                report.screenshots.append(result.data["path"])
        except Exception as exc:
            r = ActionResult(False, error=f"{action_type}: {exc}", action_type=action_type)
            report.actions.append(r)
            if on_action:
                on_action(action_type, False)
            if action.get("required", True):
                break

    return report


async def _run_single(
    page: Page,
    action: dict,
    timeout: int,
    screenshots_dir: Optional[Path],
) -> ActionResult:
    t = action.get("type", "")

    if t == "navigate":
        url = action["url"]
        wait = action.get("wait_until", "domcontentloaded")
        await page.goto(url, wait_until=wait, timeout=timeout)
        await random_delay(800, 2500)
        return ActionResult(True, {"url": url})

    if t == "click":
        selector = action["selector"]
        await human_click(page, selector, timeout=timeout)
        await random_delay(200, 600)
        return ActionResult(True)

    if t == "type":
        selector = action["selector"]
        text = action["text"]
        await human_type(page, selector, text, timeout=timeout)
        return ActionResult(True)

    if t == "clear":
        selector = action["selector"]
        el = await page.wait_for_selector(selector, timeout=timeout)
        if el:
            await el.triple_click()
            await page.keyboard.press("Backspace")
        return ActionResult(True)

    if t == "wait":
        ms = action.get("ms", 1000)
        await asyncio.sleep(ms / 1000)
        return ActionResult(True)

    if t == "wait_for":
        selector = action["selector"]
        state = action.get("state", "visible")
        await page.wait_for_selector(selector, state=state, timeout=timeout)
        return ActionResult(True)

    if t == "scroll":
        direction = action.get("direction", "down")
        distance = action.get("distance", 300)
        steps = action.get("steps", 10)
        await smooth_scroll(page, direction=direction, distance=distance, steps=steps)
        return ActionResult(True)

    if t == "hover":
        selector = action["selector"]
        el = await page.wait_for_selector(selector, timeout=timeout, state="visible")
        if el:
            box = await el.bounding_box()
            if box:
                tx = box["x"] + box["width"] * random.uniform(0.3, 0.7)
                ty = box["y"] + box["height"] * random.uniform(0.3, 0.7)
                await move_mouse_human(page, tx, ty)
        return ActionResult(True)

    if t == "screenshot":
        name = action.get("name", f"shot_{datetime.now().strftime('%H%M%S_%f')[:12]}")
        full_page = action.get("full_page", False)
        if screenshots_dir:
            screenshots_dir.mkdir(parents=True, exist_ok=True)
            path = screenshots_dir / f"{name}.png"
            await page.screenshot(path=str(path), full_page=full_page)
            return ActionResult(True, {"path": str(path), "name": name})
        else:
            data = await page.screenshot(full_page=full_page)
            b64 = base64.b64encode(data).decode()
            return ActionResult(True, {"base64": b64, "name": name})

    if t == "evaluate":
        script = action["script"]
        result = await page.evaluate(script)
        return ActionResult(True, {"result": result})

    if t == "select":
        selector = action["selector"]
        value = action["value"]
        await page.select_option(selector, value=value)
        return ActionResult(True)

    if t == "press":
        key = action["key"]
        await page.keyboard.press(key)
        return ActionResult(True)

    if t == "extract":
        selector = action.get("selector", "body")
        attr = action.get("attribute", "innerText")
        el = await page.query_selector(selector)
        if el:
            if attr == "innerText":
                text = await el.inner_text()
            elif attr == "innerHTML":
                text = await el.inner_html()
            else:
                text = await el.get_attribute(attr) or ""
            return ActionResult(True, {"value": text})
        return ActionResult(False, error=f"Selector not found: {selector}")

    if t == "assert_text":
        selector = action.get("selector", "body")
        expected = action.get("text", "")
        el = await page.query_selector(selector)
        if el:
            actual = await el.inner_text()
            if expected.lower() in actual.lower():
                return ActionResult(True)
            return ActionResult(False, error=f"Text '{expected}' not found in element")
        return ActionResult(False, error=f"Selector not found: {selector}")

    if t == "assert_url":
        expected = action.get("url", "")
        current = page.url
        if expected in current:
            return ActionResult(True, {"url": current})
        return ActionResult(False, error=f"URL mismatch: expected '{expected}' in '{current}'")

    return ActionResult(False, error=f"Unknown action type: '{t}'")
