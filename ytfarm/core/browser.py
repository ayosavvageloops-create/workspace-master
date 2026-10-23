"""Browser session management with fingerprint injection via Playwright."""

import glob
import json
import asyncio
from pathlib import Path
from typing import Optional

from playwright.async_api import async_playwright, Browser, BrowserContext, Page

from core.fingerprint import Fingerprint


STEALTH_JS = """
() => {
    // Override navigator properties
    const fp = __FINGERPRINT__;

    Object.defineProperty(navigator, 'hardwareConcurrency', {get: () => fp.hardware_concurrency});
    Object.defineProperty(navigator, 'deviceMemory', {get: () => fp.device_memory});
    Object.defineProperty(navigator, 'platform', {get: () => fp.platform});
    Object.defineProperty(navigator, 'languages', {get: () => [fp.locale, fp.language]});

    // WebGL spoofing
    const getParameterOrig = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(param) {
        if (param === 37445) return fp.webgl_vendor;
        if (param === 37446) return fp.webgl_renderer;
        return getParameterOrig.call(this, param);
    };
    const getParameterOrig2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function(param) {
        if (param === 37445) return fp.webgl_vendor;
        if (param === 37446) return fp.webgl_renderer;
        return getParameterOrig2.call(this, param);
    };

    // Canvas noise injection
    const toDataURLOrig = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type) {
        const ctx = this.getContext('2d');
        if (ctx) {
            const imgData = ctx.getImageData(0, 0, this.width, this.height);
            for (let i = 0; i < imgData.data.length; i += 4) {
                imgData.data[i] ^= (fp.canvas_seed & 0xff);
            }
            ctx.putImageData(imgData, 0, 0);
        }
        return toDataURLOrig.call(this, type);
    };

    // Screen dimensions
    Object.defineProperty(screen, 'width', {get: () => fp.screen_width});
    Object.defineProperty(screen, 'height', {get: () => fp.screen_height});
    Object.defineProperty(screen, 'availWidth', {get: () => fp.screen_width});
    Object.defineProperty(screen, 'availHeight', {get: () => fp.screen_height - 40});
    Object.defineProperty(screen, 'colorDepth', {get: () => fp.color_depth});

    // Remove webdriver flag
    Object.defineProperty(navigator, 'webdriver', {get: () => undefined});

    // Chrome runtime mock
    if (!window.chrome) {
        window.chrome = {runtime: {}, loadTimes: function(){}, csi: function(){}};
    }

    // Permissions query mock
    const origQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
            Promise.resolve({state: Notification.permission}) :
            origQuery(parameters)
    );
}
"""


def _find_chromium() -> Optional[str]:
    candidates = sorted(glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome"), reverse=True)
    for c in candidates:
        if Path(c).is_file():
            return c
    return None


async def create_browser_context(
    pw,
    fingerprint: Fingerprint,
    proxy_url: Optional[str] = None,
    cookies_json: Optional[str] = None,
    storage_json: Optional[str] = None,
    headless: bool = True,
    storage_dir: Optional[str] = None,
) -> tuple[Browser, BrowserContext]:
    launch_args = [
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        f"--font-family={','.join(fingerprint.fonts[:5])}",
    ]

    chrome_path = _find_chromium()

    launch_kwargs: dict = {
        "headless": headless,
        "args": launch_args,
        "chromium_sandbox": False,
    }
    if chrome_path:
        launch_kwargs["executable_path"] = chrome_path

    if proxy_url:
        parts = proxy_url.replace("http://", "").replace("https://", "").replace("socks5://", "")
        proxy_conf: dict = {"server": proxy_url}
        if "@" in parts:
            creds, _server = parts.split("@", 1)
            if ":" in creds:
                user, pw_str = creds.split(":", 1)
                proxy_conf["username"] = user
                proxy_conf["password"] = pw_str
        launch_kwargs["proxy"] = proxy_conf

    browser = await pw.chromium.launch(**launch_kwargs)

    context_kwargs: dict = {
        "viewport": {"width": fingerprint.viewport_width, "height": fingerprint.viewport_height},
        "user_agent": fingerprint.user_agent,
        "locale": fingerprint.locale,
        "timezone_id": fingerprint.timezone,
        "color_scheme": "light",
        "screen": {"width": fingerprint.screen_width, "height": fingerprint.screen_height},
    }

    if storage_dir:
        state_path = Path(storage_dir) / "state.json"
        if state_path.exists():
            context_kwargs["storage_state"] = str(state_path)

    context = await browser.new_context(**{k: v for k, v in context_kwargs.items() if v is not None})

    stealth_script = STEALTH_JS.replace(
        "__FINGERPRINT__",
        json.dumps(fingerprint.model_dump()),
    )
    await context.add_init_script(stealth_script)

    if cookies_json:
        try:
            cookies = json.loads(cookies_json)
            if cookies:
                await context.add_cookies(cookies)
        except (json.JSONDecodeError, Exception):
            pass

    return browser, context


async def save_context_state(
    context: BrowserContext,
) -> tuple[str, Optional[str]]:
    try:
        cookies = await context.cookies()
        cookies_json = json.dumps(cookies)
    except Exception:
        cookies_json = "[]"

    storage_json = None
    try:
        state = await context.storage_state()
        storage_json = json.dumps(state)
    except Exception:
        pass

    return cookies_json, storage_json
