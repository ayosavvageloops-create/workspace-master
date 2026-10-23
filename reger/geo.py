"""Proxy configuration and exit-IP lookup."""

from __future__ import annotations

import httpx

from reger import config


_IP_ENDPOINTS = [
    "https://api.ipify.org",
    "https://checkip.amazonaws.com",
    "https://icanhazip.com",
]


def proxy_kwargs() -> dict:
    """Return httpx proxy kwargs when PROXY_URL is set, else empty dict."""
    if config.PROXY_URL:
        return {"proxy": config.PROXY_URL}
    return {}


def exit_ip() -> str:
    """Return the public IP seen by the outside world (through proxy if configured)."""
    transport: httpx.HTTPTransport | httpx.Proxy
    kwargs: dict = {}
    if config.PROXY_URL:
        kwargs["proxy"] = config.PROXY_URL

    for url in _IP_ENDPOINTS:
        try:
            with httpx.Client(timeout=10, **kwargs) as client:  # type: ignore[arg-type]
                resp = client.get(url)
                resp.raise_for_status()
                ip = resp.text.strip()
                if ip:
                    return ip
        except Exception:
            continue
    raise RuntimeError("Could not determine exit IP from any endpoint")


def playwright_proxy() -> dict | None:
    """Return a Playwright-compatible proxy dict or None."""
    if not config.PROXY_URL:
        return None

    from urllib.parse import urlparse

    parsed = urlparse(config.PROXY_URL)
    proxy: dict = {"server": f"{parsed.scheme}://{parsed.hostname}:{parsed.port}"}
    if parsed.username:
        proxy["username"] = parsed.username
    if parsed.password:
        proxy["password"] = parsed.password
    return proxy


if __name__ == "__main__":
    print("geo self-test")
    ip = exit_ip()
    print(f"  exit IP = {ip}")
    print(f"  playwright proxy = {playwright_proxy()}")
    print("  OK")
