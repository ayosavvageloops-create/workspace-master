"""Like a YouTube video."""

import random

from playwright.async_api import Page

from behavior.human import human_click, random_delay, move_mouse_human


async def like_video(page: Page, timeout: int = 10000) -> bool:
    await random_delay(500, 2000)

    like_selectors = [
        "like-button-view-model button",
        "ytd-menu-renderer yt-icon-button#button:first-child",
        "#top-level-buttons-computed ytd-toggle-button-renderer:first-child button",
        'button[aria-label*="like" i]',
        "ytd-toggle-button-renderer:first-of-type button",
        "#segmented-like-button button",
    ]

    for selector in like_selectors:
        try:
            el = await page.wait_for_selector(
                selector, timeout=3000, state="visible"
            )
            if not el:
                continue

            is_pressed = await el.get_attribute("aria-pressed")
            if is_pressed == "true":
                return True

            box = await el.bounding_box()
            if box:
                await move_mouse_human(
                    page,
                    box["x"] + box["width"] * random.uniform(0.3, 0.7),
                    box["y"] + box["height"] * random.uniform(0.3, 0.7),
                )
                await random_delay(100, 400)

            await el.click()
            await random_delay(500, 1500)
            return True

        except Exception:
            continue

    return False
