"""Entry point — one run creates one account."""

from __future__ import annotations

import sys
from datetime import datetime, timezone

from reger import config, browser, flow, geo, profiles, store
from reger.store import Account


def _make_profile_name() -> str:
    return f"profile_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"


def main() -> None:
    print("=== reger starting ===")
    print(f"  target : {config.TARGET_URL}")

    exit = geo.exit_ip()
    print(f"  exit IP: {exit}")

    profile_name = _make_profile_name()
    print(f"  profile: {profile_name}")

    brow, ctx, page = browser.launch()
    try:
        page.goto(config.TARGET_URL, wait_until="domcontentloaded", timeout=30_000)

        goal = (
            f"Зарегистрируй аккаунт. "
            f"Имя: {config.ACCOUNT_FIRST_NAME}, "
            f"Фамилия: {config.ACCOUNT_LAST_NAME}, "
            f"Email: {config.ACCOUNT_EMAIL}, "
            f"Пароль: {config.ACCOUNT_PASSWORD}."
        )

        flow.run_form(page, goal)

        saved = profiles.save(ctx, profile_name)
        print(f"  profile saved: {saved}")

        account = Account(
            email=config.ACCOUNT_EMAIL,
            password=config.ACCOUNT_PASSWORD,
            phone="",
            first_name=config.ACCOUNT_FIRST_NAME,
            last_name=config.ACCOUNT_LAST_NAME,
            proxy=config.PROXY_URL or "",
            exit_ip=exit,
            profile=profile_name,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        store.append(account)
        print(f"  account saved to {config.ACCOUNTS_FILE}")

    finally:
        brow.close()

    print("=== done ===")


if __name__ == "__main__":
    main()
