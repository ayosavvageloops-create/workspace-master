"""Watch a YouTube video for a specified duration with human-like behavior."""

import asyncio
import random

from playwright.async_api import Page

from behavior.human import (
    move_mouse_human,
    random_delay,
    random_mouse_wander,
    smooth_scroll,
)


async def watch_video(page: Page, duration_sec: int, timeout: int = 15000) -> bool:
    await random_delay(1000, 3000)
    await _ensure_playing(page, timeout)
    await random_delay(500, 1500)

    elapsed = 0.0
    chunk_min, chunk_max = 5, 15

    while elapsed < duration_sec:
        chunk = random.uniform(chunk_min, min(chunk_max, duration_sec - elapsed))
        await asyncio.sleep(chunk)
        elapsed += chunk

        action = _pick_random_action()
        if action == "wander":
            await random_mouse_wander(page, 900, 500)
        elif action == "pause_resume":
            await _toggle_pause(page)
            await random_delay(1000, 3000)
            await _toggle_pause(page)
        elif action == "seek_back":
            await _seek_back(page)
        elif action == "hover_progress":
            await _hover_progress_bar(page)
        elif action == "scroll_comments":
            await _scroll_to_comments(page)
            await random_delay(2000, 5000)
            await _scroll_back_to_player(page)

    return True


async def _ensure_playing(page: Page, timeout: int) -> None:
    try:
        player = await page.wait_for_selector(
            "video", timeout=timeout, state="attached"
        )
        if player:
            is_paused = await page.evaluate(
                "() => document.querySelector('video')?.paused"
            )
            if is_paused:
                play_btn = await page.query_selector(
                    "button.ytp-play-button, .ytp-large-play-button"
                )
                if play_btn:
                    await play_btn.click()
                else:
                    await page.evaluate(
                        "() => document.querySelector('video')?.play()"
                    )
    except Exception:
        pass

    try:
        await page.evaluate(
            """() => {
            const v = document.querySelector('video');
            if (v) { v.muted = true; }
        }"""
        )
    except Exception:
        pass


def _pick_random_action() -> str:
    actions = [
        ("nothing", 0.35),
        ("wander", 0.25),
        ("hover_progress", 0.15),
        ("pause_resume", 0.05),
        ("seek_back", 0.05),
        ("scroll_comments", 0.10),
        ("nothing", 0.05),
    ]
    r = random.random()
    cumulative = 0.0
    for action, weight in actions:
        cumulative += weight
        if r < cumulative:
            return action
    return "nothing"


async def _toggle_pause(page: Page) -> None:
    try:
        await page.keyboard.press("k")
    except Exception:
        pass


async def _seek_back(page: Page) -> None:
    try:
        presses = random.randint(1, 3)
        for _ in range(presses):
            await page.keyboard.press("ArrowLeft")
            await asyncio.sleep(random.uniform(0.1, 0.3))
    except Exception:
        pass


async def _hover_progress_bar(page: Page) -> None:
    try:
        bar = await page.query_selector(
            ".ytp-progress-bar-container, .ytp-progress-bar"
        )
        if bar:
            box = await bar.bounding_box()
            if box:
                x = box["x"] + box["width"] * random.uniform(0.1, 0.9)
                y = box["y"] + box["height"] / 2
                await move_mouse_human(page, x, y, steps=15)
                await random_delay(500, 1500)
    except Exception:
        pass


async def _scroll_to_comments(page: Page) -> None:
    try:
        for _ in range(random.randint(3, 6)):
            await smooth_scroll(page, "down", random.randint(200, 400))
            await asyncio.sleep(random.uniform(0.2, 0.5))
    except Exception:
        pass


async def _scroll_back_to_player(page: Page) -> None:
    try:
        await page.evaluate("() => window.scrollTo({top: 0, behavior: 'smooth'})")
        await random_delay(500, 1000)
    except Exception:
        pass
