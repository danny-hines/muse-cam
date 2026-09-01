from __future__ import annotations

from pathlib import Path

import httpx

from musecam.client import MuseCamClient
from musecam.config import DeviceConfig


def test_client_parses_presets_and_generation(tmp_path: Path) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/api/device/presets":
            return httpx.Response(
                200,
                json={
                    "presets": [
                        {
                            "id": "storybook",
                            "version": 1,
                            "name": "Bedtime Legend",
                            "description": "Painted storybook",
                            "accent": "#6657de",
                        }
                    ]
                },
            )
        if request.url.path == "/api/device/generations":
            return httpx.Response(
                201,
                json={
                    "id": "generation_1",
                    "captureId": "capture_0001",
                    "status": "complete",
                    "presetId": "storybook",
                    "imageUrl": "https://camera.example/private/image",
                    "shareUrl": None,
                    "errorCode": None,
                },
            )
        raise AssertionError(f"Unexpected request: {request.url}")

    image = tmp_path / "source.jpg"
    image.write_bytes(b"jpeg-test-payload")
    client = MuseCamClient(
        DeviceConfig(server_url="https://camera.example", device_token="device-secret")
    )
    client._client.close()
    client._client = httpx.Client(
        base_url="https://camera.example",
        headers={"Authorization": "Bearer device-secret"},
        transport=httpx.MockTransport(handler),
    )
    try:
        presets = client.presets()
        generation = client.generate(image, "capture_0001", "storybook")
    finally:
        client.close()

    assert presets[0].name == "Bedtime Legend"
    assert generation.id == "generation_1"
    assert generation.image_url == "https://camera.example/private/image"
    assert requests[1].headers["authorization"] == "Bearer device-secret"
    assert "multipart/form-data" in requests[1].headers["content-type"]
    assert b"capture_0001" in requests[1].content
