"""YouTube search action: type query, pick a result video."""

import random
from typing import Optional

from playwright.async_api import Page

from behavior.human import (
    human_click,
    human_type,
    medium_pause,
    random_delay,
    simulate_reading,
    smooth_scroll,
)


async def search_and_open_video(
    page: Page,
    query: str,
    target_video_url: Optional[str] = None,
    timeout: int = 15000,
) -> bool:
    await page.goto(
        "https://www.youtube.com", wait_until="domcontentloaded", timeout=timeout
    )
    await random_delay(1000, 3000)

    await _dismiss_consent(page)
    await random_delay(500, 1500)

    search_selector = 'input#search, input[name="search_query"]'
    await human_type(page, search_selector, query, timeout=timeout)
    await random_delay(300, 800)

    await page.keyboard.press("Enter")
    await page.wait_for_load_state("domcontentloaded", timeout=timeout)
    await random_delay(2000, 4000)

    await simulate_reading(page, 1.5, 3.0)

    if target_video_url:
        found = await _find_and_click_target(page, target_video_url, timeout)
        if found:
            return True

    return await _click_random_result(page, timeout)


async def _dismiss_consent(page: Page) -> None:
    consent_selectors = [
        'button[aria-label="Accept all"]',
        'button[aria-label="Accept the use of cookies and other data for the purposes described"]',
        'button:has-text("Accept all")',
        'button:has-text("I agree")',
        'button:has-text("Agree")',
        "tp-yt-paper-dialog #button",
    ]
    for sel in consent_selectors:
        try:
            btn = await page.query_selector(sel)
            if btn and await btn.is_visible():
                await human_click(page, sel, timeout=3000)
                await random_delay(500, 1500)
                return
        except Exception:
            continue


async def _find_and_click_target(
    page: Page, target_url: str, timeout: int
) -> bool:
    video_id = _extract_video_id(target_url)
    if not video_id:
        return False

    for _scroll_attempt in range(5):
        links = await page.query_selector_all(
            "a#video-title, ytd-video-renderer a#thumbnail"
        )
        for link in links:
            href = await link.get_attribute("href")
            if href and video_id in href:
                try:
                    box = await link.bounding_box()
                    if box:
                        from behavior.human import move_mouse_human

                        await move_mouse_human(
                            page,
                            box["x"] + box["width"] * random.uniform(0.2, 0.8),
                            box["y"] + box["height"] * random.uniform(0.2, 0.8),
                        )
                        await random_delay(100, 400)
                        await link.click()
                        await page.wait_for_load_state(
                            "domcontentloaded", timeout=timeout
                        )
                        return True
                except Exception:
                    continue

        await smooth_scroll(page, "down", random.randint(300, 600))
        await random_delay(500, 1500)

    return False


async def _click_random_result(page: Page, timeout: int) -> bool:
    await random_delay(500, 1500)
    results = await page.query_selector_all("ytd-video-renderer a#video-title")

    if not results:
        results = await page.query_selector_all("a#video-title")

    if not results:
        return False

    pick = random.choice(results[: min(5, len(results))])
    try:
        box = await pick.bounding_box()
        if box:
            from behavior.human import move_mouse_human

            await move_mouse_human(
                page,
                box["x"] + box["width"] * random.uniform(0.2, 0.8),
                box["y"] + box["height"] * random.uniform(0.2, 0.8),
            )
        await random_delay(100, 300)
        await pick.click()
        await page.wait_for_load_state("domcontentloaded", timeout=timeout)
        return True
    except Exception:
        return False


def _extract_video_id(url: str) -> Optional[str]:
    if "watch?v=" in url:
        return url.split("watch?v=")[1].split("&")[0]
    if "youtu.be/" in url:
        return url.split("youtu.be/")[1].split("?")[0]
    return None
