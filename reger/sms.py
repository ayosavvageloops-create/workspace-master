"""SMS activation via sms-activate.org API."""

from __future__ import annotations

import time

import httpx

from reger import config

_BASE = "https://api.sms-activate.org/stubs/handler_api.php"
_POLL_INTERVAL = 5   # seconds between status polls
_POLL_TIMEOUT = 300  # seconds before giving up


class SmsError(Exception):
    pass


def _get(params: dict) -> str:
    params["api_key"] = config.SMS_API_KEY
    with httpx.Client(timeout=20) as client:
        resp = client.get(_BASE, params=params)
        resp.raise_for_status()
        return resp.text.strip()


def get_number() -> tuple[str, str]:
    """Request a phone number.

    Returns (activation_id, phone_number).
    """
    result = _get({
        "action": "getNumber",
        "service": config.SMS_SERVICE,
        "country": config.SMS_COUNTRY,
    })
    if result.startswith("ACCESS_NUMBER"):
        parts = result.split(":")
        activation_id = parts[1]
        phone = parts[2]
        return activation_id, phone
    raise SmsError(f"getNumber failed: {result}")


def set_status(activation_id: str, status: int) -> str:
    """Update activation status (6 = waiting for SMS, 8 = cancel)."""
    return _get({"action": "setStatus", "id": activation_id, "status": status})


def wait_for_code(activation_id: str) -> str:
    """Poll until an SMS code arrives or timeout.

    Returns the code string.
    """
    deadline = time.time() + _POLL_TIMEOUT
    while time.time() < deadline:
        result = _get({"action": "getStatus", "id": activation_id})
        if result.startswith("STATUS_OK"):
            code = result.split(":")[1]
            return code
        if result in ("STATUS_CANCEL", "STATUS_WAIT_RESEND"):
            raise SmsError(f"Activation cancelled or resend: {result}")
        # STATUS_WAIT_CODE — keep polling
        time.sleep(_POLL_INTERVAL)
    raise SmsError("Timed out waiting for SMS code")


def cancel(activation_id: str) -> None:
    set_status(activation_id, 8)


if __name__ == "__main__":
    from unittest.mock import patch

    print("sms self-test  (no real API calls)")

    _mod = __name__  # "__main__" when run directly

    # get_number
    with patch(f"{_mod}._get", return_value="ACCESS_NUMBER:12345:79001234567"):
        aid, phone = get_number()
    assert aid == "12345"
    assert phone == "79001234567"

    # wait_for_code — immediate success
    with patch(f"{_mod}._get", return_value="STATUS_OK:1234"):
        code = wait_for_code("12345")
    assert code == "1234"

    # wait_for_code — cancel
    with patch(f"{_mod}._get", return_value="STATUS_CANCEL"):
        try:
            wait_for_code("12345")
            assert False, "should have raised"
        except SmsError:
            pass

    print("  OK")
