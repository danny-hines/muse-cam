from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Preset:
    id: str
    version: int
    name: str
    description: str
    accent: str

    @classmethod
    def from_api(cls, value: dict[str, Any]) -> Preset:
        return cls(
            id=str(value["id"]),
            version=int(value["version"]),
            name=str(value["name"]),
            description=str(value["description"]),
            accent=str(value["accent"]),
        )


@dataclass(frozen=True)
class Generation:
    id: str
    capture_id: str
    status: str
    preset_id: str
    image_url: str | None
    share_url: str | None
    error_code: str | None

    @classmethod
    def from_api(cls, value: dict[str, Any]) -> Generation:
        return cls(
            id=str(value["id"]),
            capture_id=str(value["captureId"]),
            status=str(value["status"]),
            preset_id=str(value["presetId"]),
            image_url=value.get("imageUrl"),
            share_url=value.get("shareUrl"),
            error_code=value.get("errorCode"),
        )


@dataclass(frozen=True)
class CaptureJob:
    capture_id: str
    preset_id: str
    source_path: Path
    result_path: Path | None
    generation_id: str | None
    status: str
    attempts: int
    error: str | None
    share_url: str | None


class ScreenState(StrEnum):
    STARTING = "starting"
    LIVE = "live"
    CAPTURING = "capturing"
    PROCESSING = "processing"
    RESULT = "result"
    SHARING = "sharing"
    ERROR = "error"
    SHUTTING_DOWN = "shutting-down"


class Action(StrEnum):
    PREVIOUS = "previous"
    NEXT = "next"
    SHUTTER = "shutter"
    SHARE = "share"
    BACK = "back"
    POWER = "power"
    QUIT = "quit"
