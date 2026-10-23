"""CLI entrypoint: generate, warmup, farm, stats commands."""

import asyncio
import json
import sys
import uuid
from pathlib import Path
from typing import Optional

import typer
import yaml
from pydantic import BaseModel, Field
from rich.console import Console
from rich.table import Table

from core.fingerprint import generate_fingerprint
from core.profile_store import ProfileStore
from core.proxy import parse_proxy_url
from engine.queue import TaskQueue
from engine.scheduler import Scheduler

console = Console()
app = typer.Typer(help="YTFarm — YouTube session automation tool")


class AppConfig(BaseModel):
    db_path: str = "ytfarm.db"
    max_workers: int = 3
    headless: bool = True
    timeout: int = 15000
    max_retries: int = 3
    proxies: Optional[list[str]] = Field(default_factory=list)
    tasks: Optional[list[dict]] = Field(default_factory=list)
    captcha_api_key: str = ""
    captcha_provider: str = "2captcha"
    sms_api_key: str = ""
    sms_provider: str = "sms-activate"

    def model_post_init(self, __context) -> None:
        if self.proxies is None:
            self.proxies = []
        if self.tasks is None:
            self.tasks = []


def _load_config(config_path: str) -> AppConfig:
    path = Path(config_path)
    if not path.exists():
        console.log(f"[red]Config file not found: {config_path}[/red]")
        raise typer.Exit(1)
    with open(path) as f:
        raw = yaml.safe_load(f) or {}
    return AppConfig(**raw)


@app.command()
def generate(
    config: str = typer.Option("config.yaml", "--config", "-c"),
    count: int = typer.Option(5, "--count", "-n", help="Number of profiles"),
) -> None:
    """Generate N browser profiles with unique fingerprints."""
    cfg = _load_config(config)
    store = ProfileStore(cfg.db_path)

    if cfg.proxies:
        for raw_proxy in cfg.proxies:
            url = parse_proxy_url(raw_proxy)
            try:
                store.add_proxy(url)
                console.log(f"  Added proxy: {url}")
            except Exception:
                console.log(f"  Proxy already exists: {url}")

    created = 0
    for _ in range(count):
        seed = uuid.uuid4().hex
        fp = generate_fingerprint(seed)
        try:
            store.add_profile(seed=seed, fingerprint_json=fp.to_json())
            created += 1
        except Exception as exc:
            console.log(f"  [red]Failed to create profile: {exc}[/red]")

    console.print(f"[green]Created {created} profiles[/green]")

    stats = store.get_stats()
    console.print(
        f"Total: {stats['profiles_total']} profiles, "
        f"{stats['proxies_total']} proxies"
    )


@app.command()
def warmup(
    config: str = typer.Option("config.yaml", "--config", "-c"),
    count: int = typer.Option(0, "--count", "-n", help="Profiles to warm up (0=all)"),
) -> None:
    """Warm up profiles by visiting YouTube homepage and browsing briefly."""
    cfg = _load_config(config)
    store = ProfileStore(cfg.db_path)

    warmup_tasks = []
    urls = [
        "https://www.youtube.com",
        "https://www.youtube.com/feed/trending",
        "https://www.youtube.com/feed/explore",
    ]

    limit = count if count > 0 else cfg.max_workers * 2
    for i in range(limit):
        url = urls[i % len(urls)]
        warmup_tasks.append(
            {
                "url": url,
                "watch_seconds": 10,
                "source": "direct",
                "actions": [],
            }
        )

    tq = TaskQueue(store)
    loaded = tq.load_from_config(warmup_tasks)
    console.print(f"[green]Loaded {loaded} warmup tasks[/green]")

    scheduler = Scheduler(
        store=store,
        task_queue=tq,
        max_workers=cfg.max_workers,
        headless=cfg.headless,
        timeout=cfg.timeout,
        max_retries=1,
    )
    asyncio.run(scheduler.run())


@app.command()
def farm(
    config: str = typer.Option("config.yaml", "--config", "-c"),
) -> None:
    """Run the main farming loop: execute all tasks from config."""
    cfg = _load_config(config)
    store = ProfileStore(cfg.db_path)

    if not cfg.tasks:
        console.print("[red]No tasks defined in config[/red]")
        raise typer.Exit(1)

    tq = TaskQueue(store)
    loaded = tq.load_from_config(cfg.tasks)
    console.print(f"[green]Loaded {loaded} tasks from config[/green]")

    scheduler = Scheduler(
        store=store,
        task_queue=tq,
        max_workers=cfg.max_workers,
        headless=cfg.headless,
        timeout=cfg.timeout,
        max_retries=cfg.max_retries,
    )
    asyncio.run(scheduler.run())


@app.command()
def stats(
    config: str = typer.Option("config.yaml", "--config", "-c"),
    logs: int = typer.Option(20, "--logs", "-l", help="Recent log entries to show"),
) -> None:
    """Show current database statistics and recent logs."""
    cfg = _load_config(config)
    store = ProfileStore(cfg.db_path)

    st = store.get_stats()
    table = Table(title="Database Stats")
    table.add_column("Metric", style="cyan")
    table.add_column("Value", style="green")
    for key, val in st.items():
        table.add_row(key.replace("_", " ").title(), str(val))
    console.print(table)

    recent = store.get_recent_logs(limit=logs)
    if recent:
        log_table = Table(title=f"Recent Logs (last {logs})")
        log_table.add_column("ID", style="dim")
        log_table.add_column("Profile", style="cyan")
        log_table.add_column("Task", style="cyan")
        log_table.add_column("Result", style="green")
        log_table.add_column("Duration", style="yellow")
        log_table.add_column("Time", style="dim")
        log_table.add_column("Error", style="red")

        for log in recent:
            style = "green" if log.result == "ok" else "red"
            log_table.add_row(
                str(log.id),
                str(log.profile_id),
                str(log.task_id),
                f"[{style}]{log.result}[/{style}]",
                f"{log.duration_sec:.1f}s" if log.duration_sec else "-",
                str(log.ts)[:19] if log.ts else "-",
                (log.error_message or "")[:60],
            )
        console.print(log_table)
    else:
        console.print("[dim]No log entries yet[/dim]")


@app.command()
def reset(
    config: str = typer.Option("config.yaml", "--config", "-c"),
) -> None:
    """Reset all busy profiles/proxies and running tasks back to free/pending."""
    cfg = _load_config(config)
    store = ProfileStore(cfg.db_path)

    p = store.reset_busy_profiles()
    px = store.reset_busy_proxies()
    t = store.reset_running_tasks()
    console.print(
        f"[green]Reset: {p} profiles, {px} proxies, {t} tasks[/green]"
    )


if __name__ == "__main__":
    app()
