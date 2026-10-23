"""SMS activation service integration (stub — plug in your provider)."""

import asyncio
from typing import Optional

import httpx
from rich.console import Console

console = Console()


class SmsService:
    """Integrate with sms-activate.org or similar.

    Assumption: the user provides an API key in config.yaml.
    """

    def __init__(self, api_key: str, provider: str = "sms-activate"):
        self.api_key = api_key
        self.provider = provider

    async def get_number(self, service: str = "go", country: int = 0) -> Optional[dict]:
        if not self.api_key or self.api_key == "YOUR_API_KEY":
            console.log("[red]No SMS API key configured[/red]")
            return None

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    "https://api.sms-activate.org/stubs/handler_api.php",
                    params={
                        "api_key": self.api_key,
                        "action": "getNumber",
                        "service": service,
                        "country": country,
                    },
                )
                text = resp.text
                if text.startswith("ACCESS_NUMBER"):
                    parts = text.split(":")
                    return {"activation_id": parts[1], "phone": parts[2]}

        except Exception as exc:
            console.log(f"[red]SMS service error: {exc}[/red]")

        return None

    async def get_code(
        self, activation_id: str, timeout: float = 120.0
    ) -> Optional[str]:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                for _ in range(int(timeout / 5)):
                    await asyncio.sleep(5)
                    resp = await client.get(
                        "https://api.sms-activate.org/stubs/handler_api.php",
                        params={
                            "api_key": self.api_key,
                            "action": "getStatus",
                            "id": activation_id,
                        },
                    )
                    text = resp.text
                    if text.startswith("STATUS_OK"):
                        return text.split(":")[1]
                    if "STATUS_CANCEL" in text:
                        return None
        except Exception as exc:
            console.log(f"[red]SMS get_code error: {exc}[/red]")

        return None

    async def cancel(self, activation_id: str) -> None:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.get(
                    "https://api.sms-activate.org/stubs/handler_api.php",
                    params={
                        "api_key": self.api_key,
                        "action": "setStatus",
                        "id": activation_id,
                        "status": 8,
                    },
                )
        except Exception:
            pass
