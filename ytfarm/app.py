#!/usr/bin/env python3
"""BrowserFarm Desktop Launcher — macOS menu bar app + dashboard server."""

import os
import sys
import time
import signal
import socket
import subprocess
import threading
import webbrowser
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
os.chdir(APP_DIR)

HOST = "127.0.0.1"
PORT = 8787
APP_NAME = "BrowserFarm"


def find_free_port(start: int = PORT) -> int:
    for p in range(start, start + 100):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex((HOST, p)) != 0:
                return p
    return start


def wait_for_server(port: int, timeout: float = 12.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex((HOST, p := port)) == 0:
                return True
        time.sleep(0.25)
    return False


# ── macOS menu bar integration ─────────────────────────────────────────────

def run_with_menubar(port: int, server_proc: subprocess.Popen) -> None:
    """Launch rumps menu bar app (macOS only)."""
    import rumps  # type: ignore

    url = f"http://{HOST}:{port}"

    class BrowserFarmApp(rumps.App):
        def __init__(self):
            super().__init__(
                APP_NAME,
                icon=None,
                quit_button=None,
            )
            self._url = url
            self._proc = server_proc
            self._running = True
            self.title = "🌐"

            self.menu = [
                rumps.MenuItem("Open Dashboard", callback=self.open_dashboard),
                rumps.MenuItem("Copy URL", callback=self.copy_url),
                None,  # separator
                rumps.MenuItem("Farm Control", callback=self.open_farm),
                rumps.MenuItem("Profiles", callback=self.open_profiles),
                None,
                rumps.MenuItem(f"Running on port {port}", callback=None),
                None,
                rumps.MenuItem("Quit BrowserFarm", callback=self.quit_app),
            ]

            # Poll server status in background
            threading.Thread(target=self._poll_status, daemon=True).start()

        def _poll_status(self):
            """Update menu bar icon based on farm running state."""
            import urllib.request
            while self._running:
                try:
                    with urllib.request.urlopen(f"{self._url}/api/farm/status", timeout=2) as r:
                        import json
                        data = json.loads(r.read())
                        self.title = "🌐▶" if data.get("running") else "🌐"
                except Exception:
                    self.title = "🌐⚠"
                time.sleep(5)

        @rumps.clicked("Open Dashboard")
        def open_dashboard(self, _):
            webbrowser.open(self._url)

        @rumps.clicked("Farm Control")
        def open_farm(self, _):
            webbrowser.open(f"{self._url}/#farm")

        @rumps.clicked("Profiles")
        def open_profiles(self, _):
            webbrowser.open(f"{self._url}/#profiles")

        @rumps.clicked("Copy URL")
        def copy_url(self, _):
            try:
                subprocess.run(["pbcopy"], input=self._url.encode(), check=True)
                rumps.notification(APP_NAME, "URL Copied", self._url)
            except Exception:
                pass

        @rumps.clicked("Quit BrowserFarm")
        def quit_app(self, _):
            self._running = False
            self._proc.terminate()
            try:
                self._proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._proc.kill()
            rumps.quit_application()

    BrowserFarmApp().run()


# ── Headless / non-macOS launcher ─────────────────────────────────────────

def run_headless(port: int, server_proc: subprocess.Popen) -> None:
    url = f"http://{HOST}:{port}"

    def _cleanup(*_):
        server_proc.terminate()
        try:
            server_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server_proc.kill()
        sys.exit(0)

    signal.signal(signal.SIGINT, _cleanup)
    signal.signal(signal.SIGTERM, _cleanup)

    print(f"  {APP_NAME} Dashboard  →  {url}")
    print("  Press Ctrl+C to stop\n")

    try:
        server_proc.wait()
    except KeyboardInterrupt:
        _cleanup()


# ── Entry point ────────────────────────────────────────────────────────────

def main():
    port = find_free_port()
    url = f"http://{HOST}:{port}"

    sys.path.insert(0, str(APP_DIR))

    server_proc = subprocess.Popen(
        [
            sys.executable, "-m", "uvicorn",
            "dashboard.server:app",
            "--host", HOST,
            "--port", str(port),
            "--log-level", "warning",
        ],
        cwd=str(APP_DIR),
    )

    if wait_for_server(port):
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    else:
        print("  Warning: server slow to start, opening browser anyway")
        webbrowser.open(url)

    is_macos = sys.platform == "darwin"
    has_rumps = False
    if is_macos:
        try:
            import rumps  # noqa: F401
            has_rumps = True
        except ImportError:
            pass

    if is_macos and has_rumps:
        run_with_menubar(port, server_proc)
    else:
        run_headless(port, server_proc)


if __name__ == "__main__":
    main()
