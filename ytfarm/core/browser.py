"""Browser session management with fingerprint injection via Playwright."""

import glob
import json
import asyncio
from pathlib import Path
from typing import Optional

from playwright.async_api import async_playwright, Browser, BrowserContext, Page

from core.fingerprint import Fingerprint


# Plain JS block (NOT a function) — addInitScript requires evaluatable code
STEALTH_JS = """
{
    const fp = __FINGERPRINT__;

    const _def = (prop, val, targets) => {
        for (const t of targets) {
            try { delete t[prop]; } catch(e) {}
            try {
                Object.defineProperty(t, prop, {
                    get: () => val, configurable: true, enumerable: true,
                });
            } catch(e) {}
        }
    };

    const navTargets = [Navigator.prototype, navigator];
    _def('hardwareConcurrency', fp.hardware_concurrency, navTargets);
    _def('deviceMemory', fp.device_memory, navTargets);
    _def('platform', fp.platform, navTargets);
    _def('languages', Object.freeze([fp.locale, fp.language]), navTargets);
    _def('webdriver', undefined, navTargets);

    // WebGL
    const hookGL = (proto) => {
        const orig = proto.getParameter;
        proto.getParameter = function(param) {
            if (param === 37445) return fp.webgl_vendor;
            if (param === 37446) return fp.webgl_renderer;
            return orig.call(this, param);
        };
    };
    if (typeof WebGLRenderingContext !== 'undefined') hookGL(WebGLRenderingContext.prototype);
    if (typeof WebGL2RenderingContext !== 'undefined') hookGL(WebGL2RenderingContext.prototype);

    // Canvas noise
    const toDataURLOrig = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type) {
        try {
            const ctx = this.getContext('2d');
            if (ctx && this.width > 0 && this.height > 0) {
                const w = Math.min(this.width, 16), h = Math.min(this.height, 16);
                const imgData = ctx.getImageData(0, 0, w, h);
                for (let i = 0; i < imgData.data.length; i += 4) {
                    imgData.data[i] = (imgData.data[i] + (fp.canvas_seed >> (i % 8) & 3)) & 0xff;
                }
                ctx.putImageData(imgData, 0, 0);
            }
        } catch(e) {}
        return toDataURLOrig.call(this, type);
    };

    // Screen
    const scrTargets = [Screen.prototype, screen];
    _def('width', fp.screen_width, scrTargets);
    _def('height', fp.screen_height, scrTargets);
    _def('availWidth', fp.screen_width, scrTargets);
    _def('availHeight', fp.screen_height - 40, scrTargets);
    _def('colorDepth', fp.color_depth, scrTargets);

    // Chrome runtime
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) {
        window.chrome.runtime = { connect: function(){}, sendMessage: function(){} };
    }
    if (!window.chrome.loadTimes) window.chrome.loadTimes = function(){ return {}; };
    if (!window.chrome.csi) window.chrome.csi = function(){ return {}; };
    if (!window.chrome.app) {
        window.chrome.app = {
            isInstalled: false,
            getDetails: function(){},
            getIsInstalled: function(){},
            installState: function(){},
        };
    }

    // Permissions
    try {
        const origQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
        window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications'
                ? Promise.resolve({state: Notification.permission})
                : origQuery(parameters)
        );
    } catch(e) {}
}
"""


def _find_chromium() -> Optional[str]:
    candidates = sorted(
        glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome"), reverse=True
    )
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
        parts = (
            proxy_url.replace("http://", "")
            .replace("https://", "")
            .replace("socks5://", "")
        )
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
        "viewport": {
            "width": fingerprint.viewport_width,
            "height": fingerprint.viewport_height,
        },
        "user_agent": fingerprint.user_agent,
        "locale": fingerprint.locale,
        "timezone_id": fingerprint.timezone,
        "color_scheme": "light",
        "screen": {
            "width": fingerprint.screen_width,
            "height": fingerprint.screen_height,
        },
    }

    if storage_dir:
        state_path = Path(storage_dir) / "state.json"
        if state_path.exists():
            context_kwargs["storage_state"] = str(state_path)

    context = await browser.new_context(
        **{k: v for k, v in context_kwargs.items() if v is not None}
    )

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
