"""Save and load browser profiles (cookies + localStorage)."""

from __future__ import annotations

import json
from pathlib import Path

from patchright.sync_api import BrowserContext

from reger import config


def _profile_path(name: str) -> Path:
    config.PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    return config.PROFILES_DIR / f"{name}.json"


def save(context: BrowserContext, name: str) -> Path:
    """Persist cookies and origins storage state to disk."""
    path = _profile_path(name)
    state = context.storage_state()
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def load(context: BrowserContext, name: str) -> bool:
    """Restore cookies and origins storage state from disk.

    Returns True when the profile was found and applied.
    """
    path = _profile_path(name)
    if not path.exists():
        return False
    state = json.loads(path.read_text(encoding="utf-8"))
    context.add_cookies(state.get("cookies", []))
    return True


def exists(name: str) -> bool:
    return _profile_path(name).exists()


def list_profiles() -> list[str]:
    if not config.PROFILES_DIR.exists():
        return []
    return [p.stem for p in sorted(config.PROFILES_DIR.glob("*.json"))]


if __name__ == "__main__":
    import tempfile, os
    from unittest.mock import MagicMock

    print("profiles self-test")

    # Patch PROFILES_DIR to a temp dir so we don't pollute real data
    tmp = Path(tempfile.mkdtemp())
    original = config.PROFILES_DIR
    config.PROFILES_DIR = tmp

    mock_ctx = MagicMock()
    mock_ctx.storage_state.return_value = {"cookies": [{"name": "test", "value": "1"}], "origins": []}

    saved_path = save(mock_ctx, "test_profile")
    assert saved_path.exists(), "profile file should exist"

    assert exists("test_profile"), "exists() should return True"
    assert "test_profile" in list_profiles(), "list_profiles() should include test_profile"

    loaded = load(mock_ctx, "test_profile")
    assert loaded, "load() should return True for existing profile"

    not_found = load(mock_ctx, "nonexistent")
    assert not not_found, "load() should return False for missing profile"

    config.PROFILES_DIR = original
    print("  OK")
