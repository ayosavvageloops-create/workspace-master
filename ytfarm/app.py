#!/usr/bin/env python3
"""YTFarm Desktop Launcher — starts the dashboard server and opens the browser."""

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


def find_free_port(start: int = PORT) -> int:
    for p in range(start, start + 100):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex((HOST, p)) != 0:
                return p
    return start


def wait_for_server(port: int, timeout: float = 10.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex((HOST, port)) == 0:
                return True
        time.sleep(0.2)
    return False


def main():
    port = find_free_port()
    url = f"http://{HOST}:{port}"

    print(f"\n  YTFarm Dashboard")
    print(f"  Starting on {url}")
    print(f"  Press Ctrl+C to stop\n")

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

    def _cleanup(*_):
        server_proc.terminate()
        server_proc.wait(timeout=5)
        sys.exit(0)

    signal.signal(signal.SIGINT, _cleanup)
    signal.signal(signal.SIGTERM, _cleanup)

    if wait_for_server(port):
        print(f"  Server ready at {url}")
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    else:
        print("  Warning: server did not start in time, opening browser anyway")
        webbrowser.open(url)

    try:
        server_proc.wait()
    except KeyboardInterrupt:
        _cleanup()


if __name__ == "__main__":
    main()
