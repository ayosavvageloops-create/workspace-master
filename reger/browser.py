"""Launch a Chromium browser via patchright with a browserforge fingerprint."""

from __future__ import annotations

from patchright.sync_api import sync_playwright, Browser, BrowserContext, Page

from reger import config
from reger.geo import playwright_proxy


def launch() -> tuple[Browser, BrowserContext, Page]:
    """Start browser, return (browser, context, page).

    Caller is responsible for calling browser.close() when done.
    """
    from browserforge.fingerprints import FingerprintGenerator, Screen

    fg = FingerprintGenerator(browser="chrome")
    fp = fg.generate(screen=Screen(min_width=1280, min_height=800))

    pw = sync_playwright().start()

    launch_kwargs: dict = {
        "headless": config.HEADLESS,
        "slow_mo": config.SLOW_MO,
        "args": [
            "--disable-blink-features=AutomationControlled",
        ],
    }

    browser: Browser = pw.chromium.launch(**launch_kwargs)

    context_kwargs: dict = {
        "viewport": {"width": fp.screen.width, "height": fp.screen.height},
        "user_agent": fp.navigator.user_agent,
        "locale": "ru-RU",
        "timezone_id": "Europe/Moscow",
        "color_scheme": "light",
    }

    proxy = playwright_proxy()
    if proxy:
        context_kwargs["proxy"] = proxy

    context: BrowserContext = browser.new_context(**context_kwargs)
    page: Page = context.new_page()

    return browser, context, page


if __name__ == "__main__":
    print("browser self-test")
    browser, context, page = launch()
    page.goto("https://bot.sannysoft.com/")
    title = page.title()
    print(f"  page title = {title!r}")
    browser.close()
    print("  OK")
