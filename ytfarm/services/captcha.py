"""Captcha solving service integration (stub — plug in your provider)."""

import asyncio
from typing import Optional

import httpx
from rich.console import Console

console = Console()


class CaptchaSolver:
    """Integrate with 2captcha, anti-captcha, or similar.

    Assumption: the user provides an API key in config.yaml.
    This stub shows the expected interface; swap the body for your provider.
    """

    def __init__(self, api_key: str, provider: str = "2captcha"):
        self.api_key = api_key
        self.provider = provider
        self.base_url = self._get_base_url()

    def _get_base_url(self) -> str:
        urls = {
            "2captcha": "https://2captcha.com",
            "anti-captcha": "https://api.anti-captcha.com",
        }
        return urls.get(self.provider, "https://2captcha.com")

    async def solve_recaptcha(
        self,
        site_key: str,
        page_url: str,
        timeout: float = 120.0,
    ) -> Optional[str]:
        console.log(f"[yellow]Captcha solve requested for {page_url}[/yellow]")
        if not self.api_key or self.api_key == "YOUR_API_KEY":
            console.log("[red]No captcha API key configured, skipping[/red]")
            return None

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                submit_resp = await client.post(
                    f"{self.base_url}/in.php",
                    data={
                        "key": self.api_key,
                        "method": "userrecaptcha",
                        "googlekey": site_key,
                        "pageurl": page_url,
                        "json": 1,
                    },
                )
                data = submit_resp.json()
                if data.get("status") != 1:
                    console.log(f"[red]Captcha submit failed: {data}[/red]")
                    return None

                request_id = data["request"]

                for _ in range(int(timeout / 5)):
                    await asyncio.sleep(5)
                    result_resp = await client.get(
                        f"{self.base_url}/res.php",
                        params={
                            "key": self.api_key,
                            "action": "get",
                            "id": request_id,
                            "json": 1,
                        },
                    )
                    rdata = result_resp.json()
                    if rdata.get("status") == 1:
                        return rdata["request"]
                    if "CAPCHA_NOT_READY" not in rdata.get("request", ""):
                        console.log(f"[red]Captcha error: {rdata}[/red]")
                        return None

        except Exception as exc:
            console.log(f"[red]Captcha solve exception: {exc}[/red]")

        return None
