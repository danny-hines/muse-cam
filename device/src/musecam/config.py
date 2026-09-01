from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


DEFAULT_CONFIG_PATH = Path("/etc/musecam/device.env")


@dataclass(frozen=True)
class DeviceConfig:
    server_url: str
    device_token: str


def _read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def load_config(path: Path = DEFAULT_CONFIG_PATH) -> DeviceConfig:
    values = _read_env_file(path)
    server_url = values.get("MUSECAM_SERVER_URL", "").rstrip("/")
    token = values.get("MUSECAM_DEVICE_TOKEN", "")
    if not server_url or not token:
        raise ValueError(f"Missing MUSECAM_SERVER_URL or MUSECAM_DEVICE_TOKEN in {path}")
    return DeviceConfig(server_url=server_url, device_token=token)
