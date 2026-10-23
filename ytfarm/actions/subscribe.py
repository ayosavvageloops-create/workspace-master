"""Subscribe to a YouTube channel."""

import random

from playwright.async_api import Page

from behavior.human import human_click, random_delay, move_mouse_human, smooth_scroll


async def subscribe_to_channel(page: Page, timeout: int = 10000) -> bool:
    await random_delay(500, 2000)

    sub_selectors = [
        "#subscribe-button button",
        "#subscribe-button tp-yt-paper-button",
        "ytd-subscribe-button-renderer button",
        "#subscribe-button yt-button-shape button",
        'button[aria-label*="Subscribe" i]',
    ]

    for selector in sub_selectors:
        try:
            el = await page.wait_for_selector(
                selector, timeout=3000, state="visible"
            )
            if not el:
                continue

            text = (await el.inner_text()).strip().lower()
            if "subscribed" in text or "unsubscribe" in text:
                return True

            aria = await el.get_attribute("aria-label") or ""
            if "unsubscribe" in aria.lower():
                return True

            box = await el.bounding_box()
            if box:
                await move_mouse_human(
                    page,
                    box["x"] + box["width"] * random.uniform(0.2, 0.8),
                    box["y"] + box["height"] * random.uniform(0.2, 0.8),
                )
                await random_delay(100, 400)

            await el.click()
            await random_delay(500, 1500)
            return True

        except Exception:
            continue

    return False
