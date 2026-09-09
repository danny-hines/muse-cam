from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal

import httpx

from .boot_config import CAMERA_OVERLAYS
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


def _camera_check(profile: HardwareProfile) -> DiagnosticCheck:
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
        sensor = re.match(r"0\s*:\s*(\S+)", summary)
        if not profile.matches_camera_model(sensor[1] if sensor else "unknown"):
            return DiagnosticCheck(
                "camera", "failed",
                f"{profile.id} expects {profile.camera_model}; detected {summary[:100]}. "
                "Choose the matching hardware profile and reboot.",
            )
        return DiagnosticCheck("camera", "ok", summary[:180])
    return DiagnosticCheck("camera", "failed", output[-180:] or "No camera detected")


def _camera_overlay_check(
    boot_config: Path | None, profile: HardwareProfile
) -> DiagnosticCheck:
    if boot_config is None:
        return DiagnosticCheck("camera overlay", "warning", "Boot configuration is not available")
    else:
        lines = {
            line.split("#", 1)[0].strip()
            for line in boot_config.read_text(encoding="utf-8", errors="replace").splitlines()
        }
        manual = {
            name for name in CAMERA_OVERLAYS
            if any(re.fullmatch(rf"dtoverlay={name}([,:].*)?", line) for line in lines)
        }
        automatic = profile.camera_overlay == "auto"
        expected = "camera_auto_detect=1" if automatic else f"dtoverlay={profile.camera_overlay}"
        matches = expected in lines if automatic else profile.camera_overlay in manual
        conflicts = manual if automatic else manual - {profile.camera_overlay}
        status = "failed" if conflicts else "ok" if matches else "warning"
        detail = (
            f"{expected} found in {boot_config}"
            if status == "ok"
            else f"Confirm {expected} in {boot_config}"
        )
        if conflicts:
            names = ", ".join(sorted(conflicts))
            detail = f"Conflicting camera overlays: {names}. Rerun installer."
        return DiagnosticCheck("camera overlay", status, detail)



def run_diagnostics(config: DeviceConfig, profile: HardwareProfile) -> list[DiagnosticCheck]:
    checks: list[DiagnosticCheck] = []
    model_path = Path("/proc/device-tree/model")
    if model_path.is_file():
        model = model_path.read_bytes().rstrip(b"\0").decode("utf-8", errors="replace")
        checks.append(DiagnosticCheck("board", "ok", model))
    else:
        checks.append(DiagnosticCheck("board", "warning", "Not running on Raspberry Pi hardware"))

    checks.append(_camera_check(profile))

    checks.append(_camera_overlay_check(_boot_config(), profile))

    checks.append(DiagnosticCheck(
        "focus configuration", "ok",
        "Continuous autofocus requested; camera startup verifies driver support."
        if profile.camera_autofocus else "Fixed-focus camera; no autofocus controls requested.",
    ))

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
