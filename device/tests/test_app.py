from __future__ import annotations

import httpx
import pytest
from PIL import Image

from musecam.app import (
    CAMERA_UNAVAILABLE_MESSAGE,
    MuseCamApp,
    api_error_code,
    friendly_generation_error,
)
from musecam.models import Action, ScreenState


def test_reads_generation_error_code_from_api_response() -> None:
    request = httpx.Request("POST", "https://camera.example/api/device/generations")
    response = httpx.Response(
        422,
        json={"error": "filtered", "details": {"code": "content_filtered"}},
        request=request,
    )
    error = httpx.HTTPStatusError("filtered", request=request, response=response)

    assert api_error_code(error) == "content_filtered"
    assert friendly_generation_error(api_error_code(error)) == (
        "Try another style or framing. Tap BACK."
    )


@pytest.mark.parametrize("action", (Action.BACK, Action.SHUTTER, Action.SHARE))
def test_error_controls_return_to_live_view(action: Action) -> None:
    app = object.__new__(MuseCamApp)
    app._camera_available = True
    app._state = ScreenState.ERROR
    app._message = "Remix failed"
    app._result = Image.new("RGB", (2, 2))

    app._handle_action(action)

    assert app._state == ScreenState.LIVE
    assert app._message == ""
    assert app._result is None


def test_error_cannot_hide_an_unavailable_camera() -> None:
    app = object.__new__(MuseCamApp)
    app._camera_available = False
    app._state = ScreenState.ERROR
    app._message = CAMERA_UNAVAILABLE_MESSAGE
    app._result = None

    app._handle_action(Action.BACK)

    assert app._state == ScreenState.ERROR
    assert app._message == CAMERA_UNAVAILABLE_MESSAGE
