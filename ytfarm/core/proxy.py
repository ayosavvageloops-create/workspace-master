"""Proxy validation and management."""

import asyncio
from typing import Optional

import httpx
from rich.console import Console

console = Console()

PROXY_CHECK_URL = "https://httpbin.org/ip"
PROXY_CHECK_TIMEOUT = 15.0


async def check_proxy(proxy_url: str, timeout: float = PROXY_CHECK_TIMEOUT) -> bool:
    try:
        async with httpx.AsyncClient(
            proxy=proxy_url,
            timeout=timeout,
            verify=False,
        ) as client:
            resp = await client.get(PROXY_CHECK_URL)
            return resp.status_code == 200
    except Exception:
        return False


def parse_proxy_url(raw: str) -> str:
    raw = raw.strip()
    if "://" not in raw:
        raw = f"http://{raw}"
    return raw


async def check_proxies_batch(
    proxy_urls: list[str], concurrency: int = 10
) -> dict[str, bool]:
    sem = asyncio.Semaphore(concurrency)
    results: dict[str, bool] = {}

    async def _check(url: str) -> None:
        async with sem:
            results[url] = await check_proxy(url)

    await asyncio.gather(*[_check(u) for u in proxy_urls])
    return results
