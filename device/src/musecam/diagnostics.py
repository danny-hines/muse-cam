from __future__ import annotations

import shutil
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal

import httpx

from .client import MuseCamClient
from .config import DeviceConfig, HardwareProfile


@dataclass(frozen=True)
class DiagnosticCheck:
    name: str
    status: Literal["ok", "warning", "failed"]
    detail: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


def _boot_config() -> Path | None:
    for path in (Path("/boot/firmware/config.txt"), Path("/boot/config.txt")):
        if path.is_file():
            return path
    return None


def _camera_check() -> DiagnosticCheck:
    command = shutil.which("rpicam-hello") or shutil.which("libcamera-hello")
    if not command:
        return DiagnosticCheck("camera", "failed", "rpicam-hello is not installed")
    try:
        result = subprocess.run(
            [command, "--list-cameras"],
            capture_output=True,
            text=True,
            timeout=12,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as error:
        return DiagnosticCheck("camera", "failed", str(error))
    output = f"{result.stdout}\n{result.stderr}".strip()
    if result.returncode == 0 and "Available cameras" in output and "No cameras" not in output:
        summary = next(
            (line.strip() for line in output.splitlines() if line.strip().startswith("0")), output
        )
        return DiagnosticCheck("camera", "ok", summary[:180])
    return DiagnosticCheck("camera", "failed", output[-180:] or "No camera detected")


def run_diagnostics(config: DeviceConfig, profile: HardwareProfile) -> list[DiagnosticCheck]:
    checks: list[DiagnosticCheck] = []
    model_path = Path("/proc/device-tree/model")
    if model_path.is_file():
        model = model_path.read_bytes().rstrip(b"\0").decode("utf-8", errors="replace")
        checks.append(DiagnosticCheck("board", "ok", model))
    else:
        checks.append(DiagnosticCheck("board", "warning", "Not running on Raspberry Pi hardware"))

    checks.append(_camera_check())

    boot_config = _boot_config()
    if profile.camera_overlay == "auto":
        checks.append(
            DiagnosticCheck("camera overlay", "ok", "Automatic camera detection selected")
        )
    elif boot_config is None:
        checks.append(
            DiagnosticCheck("camera overlay", "warning", "Boot configuration is not available")
        )
    else:
        text = boot_config.read_text(encoding="utf-8", errors="replace")
        expected = f"dtoverlay={profile.camera_overlay}"
        status = "ok" if expected in text else "warning"
        detail = (
            f"{expected} found in {boot_config}"
            if status == "ok"
            else f"Confirm {expected} in {boot_config}"
        )
        checks.append(DiagnosticCheck("camera overlay", status, detail))

    if profile.display_backend == "displayhatmini":
        device = Path("/dev/spidev0.1")
        checks.append(
            DiagnosticCheck(
                "display",
                "ok" if device.exists() else "failed",
                str(device) if device.exists() else "SPI device /dev/spidev0.1 is missing",
            )
        )
    elif profile.display_backend == "browser":
        connectors = sorted(Path("/sys/class/drm").glob("card*-DSI-*/status"))
        connected = [path for path in connectors if path.read_text().strip() == "connected"]
        browser = shutil.which("chromium") or shutil.which("chromium-browser")
        checks.append(
            DiagnosticCheck(
                "display",
                "ok" if connected else "failed",
                str(connected[0]) if connected else "No connected DSI display found",
            )
        )
        checks.append(
            DiagnosticCheck(
                "kiosk browser",
                "ok" if browser else "failed",
                browser or "Chromium is not installed",
            )
        )
    else:
        framebuffers = sorted(Path("/dev").glob("fb*"))
        checks.append(
            DiagnosticCheck(
                "display",
                "ok" if framebuffers else "failed",
                ", ".join(map(str, framebuffers)) or "No framebuffer devices found",
            )
        )

    gpio_chips = sorted(Path("/dev").glob("gpiochip*"))
    checks.append(
        DiagnosticCheck(
            "GPIO",
            "ok" if gpio_chips else "failed",
            ", ".join(map(str, gpio_chips)) or "No GPIO chip devices found",
        )
    )

    if profile.battery_telemetry:
        battery_socket = Path("/tmp/pisugar-server.sock")
        checks.append(
            DiagnosticCheck(
                "battery",
                "ok" if battery_socket.exists() else "warning",
                str(battery_socket)
                if battery_socket.exists()
                else "PiSugar server socket is not available",
            )
        )

    try:
        config.data_dir.mkdir(parents=True, exist_ok=True)
        probe = config.data_dir / ".write-test"
        probe.touch()
        probe.unlink()
        checks.append(DiagnosticCheck("storage", "ok", str(config.data_dir)))
    except OSError as error:
        checks.append(DiagnosticCheck("storage", "failed", str(error)))

    client = MuseCamClient(config)
    try:
        health = client.health()
        ready = health.get("status") == "ready"
        checks.append(
            DiagnosticCheck(
                "Muse Cam API",
                "ok" if ready else "failed",
                f"{config.server_url}: {health.get('status', 'unknown')}",
            )
        )
    except (httpx.HTTPError, ValueError) as error:
        checks.append(DiagnosticCheck("Muse Cam API", "failed", str(error)))
    finally:
        client.close()

    return checks
