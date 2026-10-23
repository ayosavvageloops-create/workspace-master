"""Execute one action dict on a Playwright Page."""

from __future__ import annotations

import time

from patchright.sync_api import Page


_SUPPORTED_ACTIONS = {"click", "type", "press", "scroll", "wait", "done"}


def run(page: Page, action: dict) -> bool:
    """Execute *action* on *page*.

    Returns False when action is 'done' (signals the caller to stop the loop).
    Raises ValueError for unknown action names.
    """
    name = action.get("action")
    if name not in _SUPPORTED_ACTIONS:
        raise ValueError(f"Unknown action: {name!r}")

    if name == "done":
        return False

    if name == "wait":
        time.sleep(2)
        return True

    if name == "click":
        page.mouse.click(action["x"], action["y"])
        return True

    if name == "type":
        page.mouse.click(action["x"], action["y"])
        page.keyboard.type(action["text"], delay=40)
        return True

    if name == "press":
        page.keyboard.press(action["key"])
        return True

    if name == "scroll":
        dy = action.get("dy", 0)
        dx = action.get("dx", 0)
        page.mouse.wheel(dx, dy)
        return True

    return True  # pragma: no cover


if __name__ == "__main__":
    from unittest.mock import MagicMock, call, patch
    import time as _time

    print("executor self-test")

    page = MagicMock()

    # click
    run(page, {"action": "click", "x": 10, "y": 20})
    page.mouse.click.assert_called_with(10, 20)

    # type
    page.reset_mock()
    run(page, {"action": "type", "x": 5, "y": 5, "text": "hello"})
    page.mouse.click.assert_called_with(5, 5)
    page.keyboard.type.assert_called_once()

    # press
    page.reset_mock()
    run(page, {"action": "press", "key": "Enter"})
    page.keyboard.press.assert_called_with("Enter")

    # scroll
    page.reset_mock()
    run(page, {"action": "scroll", "dy": 300})
    page.mouse.wheel.assert_called_with(0, 300)

    # wait
    with patch("reger.executor.time.sleep") as mock_sleep:
        run(page, {"action": "wait"})
        mock_sleep.assert_called_with(2)

    # done
    result = run(page, {"action": "done"})
    assert result is False

    # unknown
    try:
        run(page, {"action": "fly"})
        assert False, "should have raised"
    except ValueError:
        pass

    print("  OK")
