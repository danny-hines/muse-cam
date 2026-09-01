from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx

from .config import DeviceConfig


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
        response = self._client.get("/api/health")
        response.raise_for_status()
        return response.json()

    def presets(self) -> dict[str, Any]:
        response = self._client.get("/api/device/presets")
        response.raise_for_status()
        return response.json()

    def generate(self, image: Path, capture_id: str, preset_id: str) -> dict[str, Any]:
        with image.open("rb") as image_file:
            response = self._client.post(
                "/api/device/generations",
                data={"capture_id": capture_id, "preset_id": preset_id},
                files={"image": (image.name, image_file, "image/jpeg")},
            )
        response.raise_for_status()
        return response.json()

    def download_result(self, image_url: str, output: Path) -> Path:
        response = self._client.get(image_url)
        response.raise_for_status()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(response.content)
        return output

    def share(self, generation_id: str) -> dict[str, Any]:
        response = self._client.post(f"/api/device/generations/{generation_id}/share")
        response.raise_for_status()
        return response.json()
