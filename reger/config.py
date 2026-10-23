"""All settings loaded from .env — nothing hardcoded."""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()


def _require(key: str) -> str:
    value = os.getenv(key)
    if not value:
        raise RuntimeError(f"Missing required env var: {key}")
    return value


# Vision model
ANTHROPIC_API_KEY: str = _require("ANTHROPIC_API_KEY")
VISION_MODEL: str = os.getenv("VISION_MODEL", "claude-opus-4-5")

# Target
TARGET_URL: str = _require("TARGET_URL")

# Proxy (optional)
PROXY_URL: str | None = os.getenv("PROXY_URL") or None

# SMS activation
SMS_API_KEY: str = os.getenv("SMS_API_KEY", "")
SMS_SERVICE: str = os.getenv("SMS_SERVICE", "ig")
SMS_COUNTRY: int = int(os.getenv("SMS_COUNTRY", "0"))

# Account data
ACCOUNT_FIRST_NAME: str = os.getenv("ACCOUNT_FIRST_NAME", "")
ACCOUNT_LAST_NAME: str = os.getenv("ACCOUNT_LAST_NAME", "")
ACCOUNT_EMAIL: str = os.getenv("ACCOUNT_EMAIL", "")
ACCOUNT_PASSWORD: str = os.getenv("ACCOUNT_PASSWORD", "")

# Browser
HEADLESS: bool = os.getenv("HEADLESS", "false").lower() == "true"
SLOW_MO: int = int(os.getenv("SLOW_MO", "0"))

# Paths
PROFILES_DIR: Path = Path(os.getenv("PROFILES_DIR", "profiles"))
ACCOUNTS_FILE: Path = Path(os.getenv("ACCOUNTS_FILE", "accounts.xlsx"))


if __name__ == "__main__":
    print("config self-test")
    print(f"  TARGET_URL      = {TARGET_URL}")
    print(f"  VISION_MODEL    = {VISION_MODEL}")
    print(f"  HEADLESS        = {HEADLESS}")
    print(f"  PROFILES_DIR    = {PROFILES_DIR}")
    print(f"  ACCOUNTS_FILE   = {ACCOUNTS_FILE}")
    print(f"  PROXY_URL       = {PROXY_URL}")
    print("  OK")
