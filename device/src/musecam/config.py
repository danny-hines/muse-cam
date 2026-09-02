from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_CONFIG_PATH = Path("/etc/musecam/device.env")
DEFAULT_DATA_DIR = Path("/var/lib/musecam")
BUILTIN_PROFILES_DIR = Path(__file__).resolve().parents[2] / "profiles"
INSTALL_PROFILES_DIR = Path("/opt/muse-cam/device/profiles")


def default_profiles_dir() -> Path:
    return INSTALL_PROFILES_DIR if INSTALL_PROFILES_DIR.is_dir() else BUILTIN_PROFILES_DIR


@dataclass(frozen=True)
class HardwareProfile:
    id: str
    board: str
    display_backend: str
    display_width: int
    display_height: int
    display_rotation: int
    input_backend: str
    touch_swap_xy: bool
    touch_invert_x: bool
    touch_invert_y: bool
    camera_backend: str
    camera_overlay: str
    capture_width: int
    capture_height: int
    camera_fps: int
    preview_fps: int
    shutter_gpio: int | None
    power_gpio: int | None
    power_backend: str
    battery_telemetry: bool


@dataclass(frozen=True)
class DeviceConfig:
    server_url: str
    device_token: str
    profile_id: str = "pi3bplus-imx415-tft35"
    data_dir: Path = DEFAULT_DATA_DIR
    log_level: str = "INFO"
    sdl_video_driver: str | None = None
    framebuffer_device: str | None = None
    profiles_dir: Path = BUILTIN_PROFILES_DIR


def _read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def load_config(
    path: Path = DEFAULT_CONFIG_PATH, *, require_credentials: bool = True
) -> DeviceConfig:
    values = {**_read_env_file(path), **os.environ}
    server_url = values.get("MUSECAM_SERVER_URL", "").rstrip("/")
    token = values.get("MUSECAM_DEVICE_TOKEN", "")
    if require_credentials and (not server_url or not token):
        raise ValueError(f"Missing MUSECAM_SERVER_URL or MUSECAM_DEVICE_TOKEN in {path}")

    return DeviceConfig(
        server_url=server_url or "http://127.0.0.1:3000",
        device_token=token or "simulator-token",
        profile_id=values.get("MUSECAM_PROFILE", "pi3bplus-imx415-tft35"),
        data_dir=Path(values.get("MUSECAM_DATA_DIR", str(DEFAULT_DATA_DIR))).expanduser(),
        log_level=values.get("MUSECAM_LOG_LEVEL", "INFO").upper(),
        sdl_video_driver=values.get("MUSECAM_SDL_VIDEODRIVER") or None,
        framebuffer_device=values.get("MUSECAM_FRAMEBUFFER") or None,
        profiles_dir=Path(values.get("MUSECAM_PROFILES_DIR", str(default_profiles_dir()))),
    )


def _optional_int(values: dict[str, Any], key: str) -> int | None:
    value = values.get(key)
    return int(value) if value is not None else None


def load_profile(profile_id: str, profiles_dir: Path | None = None) -> HardwareProfile:
    profiles_dir = profiles_dir or default_profiles_dir()
    path = profiles_dir / f"{profile_id}.toml"
    if not path.is_file():
        available = ", ".join(sorted(item.stem for item in profiles_dir.glob("*.toml")))
        raise ValueError(f"Unknown hardware profile {profile_id!r}. Available: {available}")

    values = tomllib.loads(path.read_text(encoding="utf-8"))
    if values.get("id") != profile_id:
        raise ValueError(f"Profile ID mismatch in {path}")

    preview_fps = max(1, int(values.get("preview_fps", 10)))
    return HardwareProfile(
        id=profile_id,
        board=str(values["board"]),
        display_backend=str(values["display_backend"]),
        display_width=int(values["display_width"]),
        display_height=int(values["display_height"]),
        display_rotation=int(values.get("display_rotation", 0)),
        input_backend=str(values["input_backend"]),
        touch_swap_xy=bool(values.get("touch_swap_xy", False)),
        touch_invert_x=bool(values.get("touch_invert_x", False)),
        touch_invert_y=bool(values.get("touch_invert_y", False)),
        camera_backend=str(values["camera_backend"]),
        camera_overlay=str(values.get("camera_overlay", "auto")),
        capture_width=int(values.get("capture_width", 1920)),
        capture_height=int(values.get("capture_height", 1080)),
        camera_fps=max(1, int(values.get("camera_fps", preview_fps))),
        preview_fps=preview_fps,
        shutter_gpio=_optional_int(values, "shutter_gpio"),
        power_gpio=_optional_int(values, "power_gpio"),
        power_backend=str(values.get("power_backend", "none")),
        battery_telemetry=bool(values.get("battery_telemetry", False)),
    )
