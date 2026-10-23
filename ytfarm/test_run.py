"""Smoke test: browser launch, stealth injection, profile persistence."""

import asyncio
import json
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from core.fingerprint import generate_fingerprint
from core.browser import create_browser_context, save_context_state
from core.profile_store import ProfileStore
from playwright.async_api import async_playwright


async def main():
    print("=== YTFarm Smoke Test ===\n")
    errors = []

    # --- 1. Fingerprint ---
    fp = generate_fingerprint("smoke-seed-42")
    fp2 = generate_fingerprint("smoke-seed-42")
    fp3 = generate_fingerprint("other-seed")
    assert fp.user_agent == fp2.user_agent, "Determinism broken"
    assert fp.user_agent != fp3.user_agent, "Different seeds must differ"
    print(f"[1/6] Fingerprint OK")
    print(f"      UA: {fp.user_agent[:70]}...")
    print(f"      Viewport: {fp.viewport_width}x{fp.viewport_height}  TZ: {fp.timezone}")
    print(f"      HW: cores={fp.hardware_concurrency} mem={fp.device_memory}GB")
    print(f"      WebGL: {fp.webgl_renderer[:50]}")
    print()

    # --- 2. Database ---
    db_file = "test_smoke.db"
    store = ProfileStore(db_file)
    p = store.add_profile("smoke-seed-42", fp.to_json())
    acquired = store.acquire_profile()
    assert acquired is not None and acquired.status == "busy"
    store.release_profile(acquired.id)
    px = store.add_proxy("http://test:pass@127.0.0.1:9999", "http")
    store.add_task("https://example.com", 10, "direct", ["like"])
    stats = store.get_stats()
    assert stats["profiles_total"] == 1
    assert stats["proxies_total"] == 1
    assert stats["tasks_total"] == 1
    print(f"[2/6] Database OK — {stats}")
    print()

    # --- 3. Browser launch ---
    print("[3/6] Launching Chromium (headless)...")
    pw = await async_playwright().start()
    browser, context = await create_browser_context(pw, fp, headless=True)
    page = await context.new_page()
    print("      Browser launched OK")
    print()

    # --- 4. Page load ---
    await page.goto("https://example.com", wait_until="domcontentloaded", timeout=15000)
    title = await page.title()
    assert "Example" in title, f"Unexpected title: {title}"
    print(f"[4/6] Page loaded: '{title}'")
    print()

    # --- 5. Stealth checks ---
    checks = {}
    checks["webdriver"] = await page.evaluate("() => navigator.webdriver")
    checks["hardwareConcurrency"] = await page.evaluate("() => navigator.hardwareConcurrency")
    checks["deviceMemory"] = await page.evaluate("() => navigator.deviceMemory")
    checks["platform"] = await page.evaluate("() => navigator.platform")
    checks["languages"] = await page.evaluate("() => navigator.languages")
    checks["screen.width"] = await page.evaluate("() => screen.width")
    checks["screen.height"] = await page.evaluate("() => screen.height")
    checks["colorDepth"] = await page.evaluate("() => screen.colorDepth")
    checks["chrome"] = await page.evaluate("() => !!window.chrome")
    checks["chrome.runtime"] = await page.evaluate("() => !!window.chrome?.runtime")
    checks["plugins.length"] = await page.evaluate("() => navigator.plugins.length")

    print("[5/6] Stealth injection results:")
    stealth_ok = True

    def check(name, got, expected, soft=False):
        nonlocal stealth_ok
        ok = got == expected
        mark = "OK" if ok else ("WARN" if soft else "FAIL")
        if not ok and not soft:
            stealth_ok = False
            errors.append(f"{name}: got {got}, expected {expected}")
        print(f"      {mark}: {name} = {got} (expected {expected})")

    check("webdriver", checks["webdriver"], None)
    check("hardwareConcurrency", checks["hardwareConcurrency"], fp.hardware_concurrency)
    check("deviceMemory", checks["deviceMemory"], fp.device_memory)
    check("platform", checks["platform"], fp.platform)
    check("screen.width", checks["screen.width"], fp.screen_width)
    check("screen.height", checks["screen.height"], fp.screen_height)
    check("colorDepth", checks["colorDepth"], fp.color_depth)
    check("chrome", checks["chrome"], True)
    check("chrome.runtime", checks["chrome.runtime"], True)
    check("plugins.length", checks["plugins.length"], 3, soft=True)
    print()

    # --- 6. State persistence ---
    cookies_json, storage_json = await save_context_state(context)
    store.save_profile_state(p.id, cookies_json, storage_json)
    print(f"[6/6] State saved: {len(json.loads(cookies_json))} cookies")

    await context.close()
    await browser.close()
    await pw.stop()
    os.unlink(db_file)

    print()
    if stealth_ok:
        print("RESULT: ALL CHECKS PASSED")
    else:
        print(f"RESULT: {len(errors)} FAILURES:")
        for e in errors:
            print(f"  - {e}")

    return 0 if stealth_ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
