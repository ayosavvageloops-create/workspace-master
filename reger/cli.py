"""Entry point — one run creates one account."""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone


def _make_profile_name() -> str:
    return f"profile_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"


def cmd_run(args: argparse.Namespace) -> None:
    from reger import config, browser, flow, geo, profiles, store
    from reger.store import Account

    print("=== reger starting ===")
    print(f"  target : {config.TARGET_URL}")

    exit_ip = geo.exit_ip()
    print(f"  exit IP: {exit_ip}")

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
            exit_ip=exit_ip,
            profile=profile_name,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        store.append(account)
        print(f"  account saved to {config.ACCOUNTS_FILE}")

    finally:
        brow.close()

    print("=== done ===")


def cmd_test(_args: argparse.Namespace) -> None:
    """Run all module self-tests."""
    import subprocess, os

    env = os.environ.copy()
    env.setdefault("TARGET_URL", "https://example.com/register")
    env.setdefault("ANTHROPIC_API_KEY", "fake")

    modules = [
        "reger.prompt",
        "reger.brain",
        "reger.executor",
        "reger.profiles",
        "reger.store",
        "reger.flow",
        "reger.sms",
    ]
    failed: list[str] = []
    for mod in modules:
        result = subprocess.run(
            [sys.executable, "-m", mod],
            env=env,
            capture_output=True,
            text=True,
        )
        status = "OK" if result.returncode == 0 else "FAIL"
        print(f"  [{status}] {mod}")
        if result.returncode != 0:
            print(result.stdout)
            print(result.stderr)
            failed.append(mod)

    if failed:
        print(f"\n{len(failed)} test(s) failed: {failed}")
        sys.exit(1)
    else:
        print(f"\nAll {len(modules)} self-tests passed.")


def cmd_ip(_args: argparse.Namespace) -> None:
    """Print exit IP (respects PROXY_URL)."""
    from reger.geo import exit_ip
    print(exit_ip())


def cmd_profiles(_args: argparse.Namespace) -> None:
    """List saved profiles."""
    from reger.profiles import list_profiles
    profs = list_profiles()
    if profs:
        for p in profs:
            print(p)
    else:
        print("No profiles saved yet.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="reger",
        description="Vision-model-driven Chrome signup bot",
    )
    sub = parser.add_subparsers(dest="command", metavar="COMMAND")

    sub.add_parser("run", help="Open browser and register one account")
    sub.add_parser("test", help="Run all module self-tests")
    sub.add_parser("ip", help="Show exit IP (via proxy if configured)")
    sub.add_parser("profiles", help="List saved browser profiles")

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "run":
        cmd_run(args)
    elif args.command == "test":
        cmd_test(args)
    elif args.command == "ip":
        cmd_ip(args)
    elif args.command == "profiles":
        cmd_profiles(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
