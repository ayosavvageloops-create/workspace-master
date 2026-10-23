"""Screenshot → one action JSON via Anthropic vision model."""

from __future__ import annotations

import base64
import json
import re

import anthropic

from reger import config
from reger.prompt import SYSTEM_PROMPT, build_user_message

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
    return _client


def decide(screenshot_png: bytes, goal: str) -> dict:
    """Send screenshot + goal to the vision model and return one action dict."""
    screenshot_b64 = base64.b64encode(screenshot_png).decode()
    client = _get_client()

    message = client.messages.create(
        model=config.VISION_MODEL,
        max_tokens=256,
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": build_user_message(goal, screenshot_b64),
            }
        ],
    )

    raw = message.content[0].text.strip()
    return _parse_action(raw)


def _parse_action(raw: str) -> dict:
    """Extract the first JSON object from the model's response."""
    # Strip markdown fences if the model ignores the no-markdown rule
    raw = re.sub(r"```[a-z]*\n?", "", raw).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Try to find a JSON object anywhere in the text
        match = re.search(r"\{[^{}]+\}", raw)
        if match:
            return json.loads(match.group())
        raise ValueError(f"No valid JSON action in model response: {raw!r}")


if __name__ == "__main__":
    print("brain self-test  (parses action without hitting the API)")
    for raw, expected_action in [
        ('{"action":"wait"}', "wait"),
        ('```json\n{"action":"click","x":100,"y":200}\n```', "click"),
        ('Here is your action: {"action":"done"}', "done"),
    ]:
        result = _parse_action(raw)
        assert result["action"] == expected_action, f"Got {result} for {raw!r}"
    print("  OK")
