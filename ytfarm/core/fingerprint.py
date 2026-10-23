"""Deterministic browser fingerprint generation from a profile seed."""

import hashlib
import json
import random
from typing import Any

from pydantic import BaseModel


class Fingerprint(BaseModel):
    user_agent: str
    viewport_width: int
    viewport_height: int
    screen_width: int
    screen_height: int
    timezone: str
    locale: str
    language: str
    hardware_concurrency: int
    device_memory: int
    webgl_vendor: str
    webgl_renderer: str
    canvas_seed: int
    fonts: list[str]
    platform: str
    color_depth: int

    def to_json(self) -> str:
        return self.model_dump_json()

    @classmethod
    def from_json(cls, data: str) -> "Fingerprint":
        return cls.model_validate_json(data)


_TIMEZONES = [
    "America/New_York", "America/Chicago", "America/Denver",
    "America/Los_Angeles", "America/Phoenix", "America/Anchorage",
    "Europe/London", "Europe/Berlin", "Europe/Paris", "Europe/Moscow",
    "Asia/Tokyo", "Asia/Shanghai", "Asia/Kolkata", "Asia/Dubai",
    "Australia/Sydney", "Pacific/Auckland",
]

_LOCALES = [
    ("en-US", "en"), ("en-GB", "en"), ("de-DE", "de"), ("fr-FR", "fr"),
    ("es-ES", "es"), ("pt-BR", "pt"), ("ja-JP", "ja"), ("ru-RU", "ru"),
    ("zh-CN", "zh"), ("ko-KR", "ko"),
]

_PLATFORMS = ["Win32", "Linux x86_64", "MacIntel"]

_WEBGL_CONFIGS = [
    ("Google Inc. (NVIDIA)", "ANGLE (NVIDIA, NVIDIA GeForce GTX 1060, OpenGL 4.5)"),
    ("Google Inc. (NVIDIA)", "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060, OpenGL 4.5)"),
    ("Google Inc. (AMD)", "ANGLE (AMD, AMD Radeon RX 580, OpenGL 4.5)"),
    ("Google Inc. (Intel)", "ANGLE (Intel, Intel UHD Graphics 630, OpenGL 4.5)"),
    ("Google Inc. (Intel)", "ANGLE (Intel, Intel Iris Plus Graphics, OpenGL 4.1)"),
    ("Google Inc. (NVIDIA)", "ANGLE (NVIDIA, NVIDIA GeForce GTX 1650, OpenGL 4.5)"),
    ("Google Inc. (AMD)", "ANGLE (AMD, AMD Radeon RX 6600, OpenGL 4.5)"),
]

_FONTS = [
    "Arial", "Verdana", "Helvetica", "Times New Roman", "Courier New",
    "Georgia", "Trebuchet MS", "Comic Sans MS", "Impact", "Lucida Console",
    "Tahoma", "Palatino Linotype", "Century Gothic", "Bookman Old Style",
    "Garamond", "Calibri", "Cambria", "Segoe UI", "Consolas", "Candara",
]

_CHROME_VERSIONS = list(range(118, 131))

_RESOLUTIONS = [
    (1920, 1080), (1366, 768), (1536, 864), (1440, 900),
    (1280, 720), (1600, 900), (2560, 1440), (1280, 1024),
    (1680, 1050), (1360, 768),
]

_VIEWPORT_OFFSETS = [
    (0, 71), (0, 78), (0, 85), (0, 92), (0, 100),
]


def _seeded_rng(seed: str) -> random.Random:
    h = hashlib.sha256(seed.encode()).hexdigest()
    return random.Random(int(h, 16))


def generate_fingerprint(seed: str) -> Fingerprint:
    rng = _seeded_rng(seed)

    platform = rng.choice(_PLATFORMS)
    chrome_ver = rng.choice(_CHROME_VERSIONS)

    if platform == "Win32":
        os_part = "Windows NT 10.0; Win64; x64"
    elif platform == "MacIntel":
        mac_ver = f"10_{rng.randint(13, 15)}_{rng.randint(0, 7)}"
        os_part = f"Macintosh; Intel Mac OS X {mac_ver}"
    else:
        os_part = "X11; Linux x86_64"

    ua = (
        f"Mozilla/5.0 ({os_part}) AppleWebKit/537.36 "
        f"(KHTML, like Gecko) Chrome/{chrome_ver}.0.{rng.randint(5000, 6100)}.{rng.randint(50, 200)} "
        f"Safari/537.36"
    )

    screen_w, screen_h = rng.choice(_RESOLUTIONS)
    vp_off_w, vp_off_h = rng.choice(_VIEWPORT_OFFSETS)
    viewport_w = screen_w - vp_off_w
    viewport_h = screen_h - vp_off_h

    tz = rng.choice(_TIMEZONES)
    locale_str, lang = rng.choice(_LOCALES)
    hw_concurrency = rng.choice([2, 4, 6, 8, 12, 16])
    dev_memory = rng.choice([2, 4, 8, 16, 32])
    webgl_vendor, webgl_renderer = rng.choice(_WEBGL_CONFIGS)
    canvas_seed = rng.randint(0, 2**32 - 1)

    num_fonts = rng.randint(8, len(_FONTS))
    fonts = rng.sample(_FONTS, num_fonts)

    return Fingerprint(
        user_agent=ua,
        viewport_width=viewport_w,
        viewport_height=viewport_h,
        screen_width=screen_w,
        screen_height=screen_h,
        timezone=tz,
        locale=locale_str,
        language=lang,
        hardware_concurrency=hw_concurrency,
        device_memory=dev_memory,
        webgl_vendor=webgl_vendor,
        webgl_renderer=webgl_renderer,
        canvas_seed=canvas_seed,
        fonts=fonts,
        platform=platform,
        color_depth=rng.choice([24, 32]),
    )
