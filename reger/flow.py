"""Drive the signup form using the vision-model loop."""

from __future__ import annotations

import time

from patchright.sync_api import Page

from reger import brain, executor

_MAX_STEPS = 60


def run_form(page: Page, goal: str) -> None:
    """Loop: screenshot → brain.decide → executor.run until done or max_steps."""
    for step in range(_MAX_STEPS):
        screenshot = page.screenshot(type="png")
        action = brain.decide(screenshot, goal)
        print(f"  step {step + 1:03d}: {action}")
        should_continue = executor.run(page, action)
        if not should_continue:
            print("  flow done")
            return
        # Give the page a moment to react before next screenshot
        time.sleep(0.5)

    raise RuntimeError(f"Flow did not complete within {_MAX_STEPS} steps")


if __name__ == "__main__":
    from unittest.mock import MagicMock, patch

    print("flow self-test  (mocked brain + executor)")

    actions = [
        {"action": "click", "x": 100, "y": 200},
        {"action": "type", "x": 100, "y": 200, "text": "test"},
        {"action": "done"},
    ]
    call_count = {"n": 0}

    def fake_decide(screenshot, goal):
        a = actions[call_count["n"]]
        call_count["n"] += 1
        return a

    page = MagicMock()
    page.screenshot.return_value = b"\x89PNG\r\n"

    with patch("reger.flow.brain.decide", side_effect=fake_decide), \
         patch("reger.flow.time.sleep"):
        run_form(page, "Заполни форму")

    assert call_count["n"] == 3
    print("  OK")
