"""Leave a comment on a YouTube video."""

import random

from playwright.async_api import Page

from behavior.human import (
    human_click,
    human_type,
    random_delay,
    smooth_scroll,
    scroll_to_element,
    move_mouse_human,
)


async def leave_comment(page: Page, text: str, timeout: int = 15000) -> bool:
    await random_delay(1000, 3000)

    for _ in range(6):
        await smooth_scroll(page, "down", random.randint(300, 500))
        await random_delay(300, 800)

    comment_box_selectors = [
        "#simplebox-placeholder",
        "ytd-comment-simplebox-renderer #placeholder-area",
        "#comment-placeholder-area",
        "div#placeholder-area",
    ]

    clicked = False
    for selector in comment_box_selectors:
        try:
            el = await page.wait_for_selector(
                selector, timeout=5000, state="visible"
            )
            if el:
                box = await el.bounding_box()
                if box:
                    await move_mouse_human(
                        page,
                        box["x"] + box["width"] * random.uniform(0.1, 0.9),
                        box["y"] + box["height"] * random.uniform(0.2, 0.8),
                    )
                    await random_delay(200, 500)
                await el.click()
                clicked = True
                break
        except Exception:
            continue

    if not clicked:
        return False

    await random_delay(500, 1500)

    input_selectors = [
        "#contenteditable-root",
        'div#contenteditable-root[contenteditable="true"]',
        "#creation-box #contenteditable-root",
    ]

    typed = False
    for selector in input_selectors:
        try:
            inp = await page.wait_for_selector(
                selector, timeout=5000, state="visible"
            )
            if inp:
                await inp.click()
                await random_delay(200, 500)

                for char in text:
                    await page.keyboard.type(char, delay=random.uniform(50, 180))
                    if random.random() < 0.02:
                        await random_delay(300, 800)

                typed = True
                break
        except Exception:
            continue

    if not typed:
        return False

    await random_delay(500, 1500)

    submit_selectors = [
        "#submit-button button",
        "#submit-button tp-yt-paper-button",
        "#submit-button yt-button-shape button",
        "ytd-comment-simplebox-renderer #submit-button button",
    ]

    for selector in submit_selectors:
        try:
            btn = await page.wait_for_selector(
                selector, timeout=5000, state="visible"
            )
            if btn:
                is_disabled = await btn.get_attribute("disabled")
                aria_disabled = await btn.get_attribute("aria-disabled")
                if is_disabled is not None or aria_disabled == "true":
                    continue

                box = await btn.bounding_box()
                if box:
                    await move_mouse_human(
                        page,
                        box["x"] + box["width"] * random.uniform(0.3, 0.7),
                        box["y"] + box["height"] * random.uniform(0.3, 0.7),
                    )
                    await random_delay(200, 500)
                await btn.click()
                await random_delay(1000, 3000)
                return True
        except Exception:
            continue

    return False
