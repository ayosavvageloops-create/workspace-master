"""System prompt for the vision model that drives the browser."""

SYSTEM_PROMPT = """\
Ты управляешь одним окном Chrome.

Верни ровно один JSON-объект и больше ничего.
Без текста. Без markdown. Без комментариев.

Действия:
{"action":"click","x":412,"y":640}
{"action":"type","x":412,"y":640,"text":"Иван"}
{"action":"press","key":"Enter"}
{"action":"scroll","dy":400}
{"action":"wait"}
{"action":"done"}

Правила:
- x и y — пиксели на приложенной картинке.
- Одно действие на ответ.
- Если в поле уже есть текст, не трогай его.
- Если непонятно, что делать, верни {"action":"wait"}.
"""


def build_user_message(goal: str, screenshot_b64: str) -> list[dict]:
    """Return the user message content list for one vision-model turn."""
    return [
        {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/png",
                "data": screenshot_b64,
            },
        },
        {
            "type": "text",
            "text": f"Цель: {goal}",
        },
    ]


if __name__ == "__main__":
    print("prompt self-test")
    assert "JSON" in SYSTEM_PROMPT
    msg = build_user_message("Заполни форму регистрации", "FAKEB64==")
    assert len(msg) == 2
    assert msg[0]["type"] == "image"
    assert msg[1]["type"] == "text"
    print("  OK")
