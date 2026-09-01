from __future__ import annotations

import mimetypes
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from .config import DeviceConfig
from .models import Generation, Preset


class MuseCamClient:
    def __init__(self, config: DeviceConfig) -> None:
        self._config = config
        self._client = httpx.Client(
            base_url=config.server_url,
            headers={"Authorization": f"Bearer {config.device_token}"},
            timeout=httpx.Timeout(300.0, connect=20.0),
        )

    def close(self) -> None:
        self._client.close()

    def health(self) -> dict[str, Any]:
        response = self._client.get("/api/health", timeout=10.0)
        response.raise_for_status()
        return response.json()

    def presets(self) -> list[Preset]:
        response = self._client.get("/api/device/presets", timeout=10.0)
        response.raise_for_status()
        return [Preset.from_api(value) for value in response.json()["presets"]]

    def generate(self, image: Path, capture_id: str, preset_id: str) -> Generation:
        content_type = mimetypes.guess_type(image.name)[0] or "image/jpeg"
        with image.open("rb") as image_file:
            response = self._client.post(
                "/api/device/generations",
                data={
                    "capture_id": capture_id,
                    "preset_id": preset_id,
                    "captured_at": datetime.now(UTC).isoformat(),
                },
                files={"image": (image.name, image_file, content_type)},
            )
        response.raise_for_status()
        return Generation.from_api(response.json())

    def download_result(self, image_url: str, output: Path) -> Path:
        response = self._client.get(image_url)
        response.raise_for_status()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(response.content)
        return output

    def share(self, generation_id: str) -> Generation:
        response = self._client.post(f"/api/device/generations/{generation_id}/share")
        response.raise_for_status()
        return Generation.from_api(response.json())
