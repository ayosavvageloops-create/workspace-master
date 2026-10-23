"""Human-like interaction simulation: mouse movement, typing, scrolling."""

import asyncio
import math
import random
from typing import Optional

from playwright.async_api import Page


async def random_delay(min_ms: int = 300, max_ms: int = 1500) -> None:
    delay = random.uniform(min_ms / 1000, max_ms / 1000)
    await asyncio.sleep(delay)


async def short_pause() -> None:
    await random_delay(100, 400)


async def medium_pause() -> None:
    await random_delay(500, 2000)


async def long_pause() -> None:
    await random_delay(2000, 5000)


def _bezier_point(
    t: float,
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    p3: tuple[float, float],
) -> tuple[float, float]:
    u = 1 - t
    x = u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0]
    y = u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1]
    return x, y


async def move_mouse_human(
    page: Page,
    target_x: float,
    target_y: float,
    steps: Optional[int] = None,
) -> None:
    try:
        current = await page.evaluate("() => ({x: window._mouseX || 0, y: window._mouseY || 0})")
    except Exception:
        current = {"x": random.randint(100, 400), "y": random.randint(100, 300)}

    start_x, start_y = float(current["x"]), float(current["y"])
    dist = math.hypot(target_x - start_x, target_y - start_y)

    if steps is None:
        steps = max(10, min(60, int(dist / 10)))

    cp1_x = start_x + (target_x - start_x) * random.uniform(0.1, 0.4) + random.uniform(-50, 50)
    cp1_y = start_y + (target_y - start_y) * random.uniform(0.1, 0.4) + random.uniform(-50, 50)
    cp2_x = start_x + (target_x - start_x) * random.uniform(0.6, 0.9) + random.uniform(-30, 30)
    cp2_y = start_y + (target_y - start_y) * random.uniform(0.6, 0.9) + random.uniform(-30, 30)

    p0 = (start_x, start_y)
    p1 = (cp1_x, cp1_y)
    p2 = (cp2_x, cp2_y)
    p3 = (target_x, target_y)

    for i in range(1, steps + 1):
        t = i / steps
        t = t * t * (3 - 2 * t)
        x, y = _bezier_point(t, p0, p1, p2, p3)
        x += random.uniform(-1, 1)
        y += random.uniform(-1, 1)
        await page.mouse.move(x, y)
        delay = random.uniform(0.005, 0.025)
        if random.random() < 0.05:
            delay += random.uniform(0.02, 0.08)
        await asyncio.sleep(delay)

    await page.evaluate(f"() => {{ window._mouseX = {target_x}; window._mouseY = {target_y}; }}")


async def human_click(page: Page, selector: str, timeout: int = 10000) -> None:
    element = await page.wait_for_selector(selector, timeout=timeout, state="visible")
    if not element:
        raise TimeoutError(f"Element not found: {selector}")

    box = await element.bounding_box()
    if not box:
        await element.click()
        return

    target_x = box["x"] + box["width"] * random.uniform(0.2, 0.8)
    target_y = box["y"] + box["height"] * random.uniform(0.2, 0.8)

    await move_mouse_human(page, target_x, target_y)
    await random_delay(50, 200)
    await page.mouse.click(target_x, target_y)


async def human_type(
    page: Page, selector: str, text: str, timeout: int = 10000
) -> None:
    await human_click(page, selector, timeout)
    await random_delay(200, 500)

    for char in text:
        await page.keyboard.type(char, delay=random.uniform(40, 150))
        if random.random() < 0.02:
            await asyncio.sleep(random.uniform(0.3, 0.8))


async def smooth_scroll(
    page: Page,
    direction: str = "down",
    distance: int = 300,
    steps: int = 10,
) -> None:
    step_distance = distance / steps
    for _ in range(steps):
        delta = step_distance if direction == "down" else -step_distance
        delta += random.uniform(-5, 5)
        await page.mouse.wheel(0, delta)
        await asyncio.sleep(random.uniform(0.02, 0.08))
    await random_delay(200, 600)


async def scroll_to_element(page: Page, selector: str, timeout: int = 10000) -> None:
    try:
        element = await page.wait_for_selector(selector, timeout=timeout, state="attached")
        if element:
            await element.scroll_into_view_if_needed()
            await random_delay(300, 800)
    except Exception:
        for _ in range(5):
            await smooth_scroll(page, "down", random.randint(200, 500))
            try:
                el = await page.query_selector(selector)
                if el and await el.is_visible():
                    return
            except Exception:
                pass


async def random_mouse_wander(page: Page, area_width: int = 800, area_height: int = 600) -> None:
    moves = random.randint(2, 5)
    for _ in range(moves):
        x = random.uniform(50, area_width - 50)
        y = random.uniform(50, area_height - 50)
        await move_mouse_human(page, x, y, steps=random.randint(5, 15))
        await random_delay(200, 800)


async def simulate_reading(page: Page, min_sec: float = 2.0, max_sec: float = 8.0) -> None:
    duration = random.uniform(min_sec, max_sec)
    elapsed = 0.0
    while elapsed < duration:
        action = random.choice(["wait", "scroll", "wander"])
        if action == "wait":
            wait_time = random.uniform(0.5, 2.0)
            await asyncio.sleep(wait_time)
            elapsed += wait_time
        elif action == "scroll":
            await smooth_scroll(page, "down", random.randint(50, 200), steps=5)
            elapsed += 0.5
        else:
            await random_mouse_wander(page, 800, 500)
            elapsed += 1.0
