from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass, replace
from io import BytesIO
from pathlib import Path
from typing import Protocol

from PIL import Image, ImageDraw, ImageOps

from .config import HardwareProfile

MAX_UPLOAD_BYTES = 2_350_000
MAX_UPLOAD_EDGE = 2_048
FOCUS_SETTLE_SECONDS = 1.2
LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class FocusState:
    supported: bool = False
    point: tuple[float, float] | None = None
    status: str = "unavailable"

    def to_dict(self) -> dict:
        return {
            "supported": self.supported,
            "point": {"x": self.point[0], "y": self.point[1]} if self.point else None,
            "mode": "spot" if self.point else "auto",
            "status": self.status,
        }


def focus_window(point: tuple[float, float], crop: tuple[int, int, int, int]) -> tuple:
    """Map a normalized preview point into the sensor's current scaler crop."""
    x, y, width, height = crop
    box_width, box_height = max(1, round(width * 0.15)), max(1, round(height * 0.15))
    left = max(x, min(x + width - box_width, round(x + point[0] * width - box_width / 2)))
    top = max(y, min(y + height - box_height, round(y + point[1] * height - box_height / 2)))
    return left, top, box_width, box_height


def prepare_capture(path: Path, max_bytes: int = MAX_UPLOAD_BYTES) -> Path:
    with Image.open(path) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")
    image.thumbnail((MAX_UPLOAD_EDGE, MAX_UPLOAD_EDGE), Image.Resampling.LANCZOS)

    encoded = b""
    for quality in (90, 84, 78, 72, 66):
        output = BytesIO()
        image.save(output, "JPEG", quality=quality, optimize=True)
        encoded = output.getvalue()
        if len(encoded) <= max_bytes:
            break
    if len(encoded) > max_bytes:
        scale = math.sqrt(max_bytes / len(encoded)) * 0.92
        resized = image.resize(
            (max(320, round(image.width * scale)), max(240, round(image.height * scale))),
            Image.Resampling.LANCZOS,
        )
        output = BytesIO()
        resized.save(output, "JPEG", quality=70, optimize=True)
        encoded = output.getvalue()
    if len(encoded) > max_bytes:
        raise RuntimeError(f"Captured image is still larger than {max_bytes} bytes")

    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_bytes(encoded)
    temporary.replace(path)
    return path


class Camera(Protocol):
    @property
    def focus(self) -> FocusState: ...

    def focus_at(self, point: tuple[float, float] | None) -> None: ...

    def start(self) -> None: ...

    def preview(self) -> Image.Image: ...

    def preview_jpeg(self, quality: int = 72) -> bytes: ...

    def capture(self, output: Path) -> Path: ...

    def close(self) -> None: ...


class SimulatorCamera:
    def __init__(self, width: int, height: int, *, autofocus: bool = False) -> None:
        self._width = max(width, 640)
        self._height = max(height, 480)
        self._started_at = time.monotonic()
        self._last_frame: Image.Image | None = None
        self.focus = FocusState(supported=autofocus)
        self._focus_at = 0.0

    def start(self) -> None:
        self._started_at = time.monotonic()
        self.focus = FocusState(self.focus.supported, status="idle")

    def focus_at(self, point: tuple[float, float] | None) -> None:
        if not self.focus.supported:
            raise ValueError("This camera has a fixed-focus lens")
        self.focus = FocusState(True, point, "scanning")
        self._focus_at = time.monotonic() + 0.6

    def preview(self) -> Image.Image:
        if self.focus.status == "scanning" and time.monotonic() >= self._focus_at:
            self.focus = replace(self.focus, status="focused")
        elapsed = time.monotonic() - self._started_at
        image = Image.new("RGB", (self._width, self._height), "#17252a")
        draw = ImageDraw.Draw(image)
        horizon = int(self._height * 0.62)
        draw.rectangle((0, 0, self._width, horizon), fill="#64b6c4")
        draw.rectangle((0, horizon, self._width, self._height), fill="#d8a55d")

        sun_x = int(self._width * 0.78)
        sun_y = int(self._height * 0.22)
        radius = int(min(self._width, self._height) * 0.09)
        draw.ellipse(
            (sun_x - radius, sun_y - radius, sun_x + radius, sun_y + radius), fill="#ffd76a"
        )

        house_w = int(self._width * 0.34)
        house_h = int(self._height * 0.28)
        house_x = int(self._width * 0.18)
        house_y = horizon - house_h
        draw.rectangle((house_x, house_y, house_x + house_w, horizon), fill="#f2675e")
        draw.polygon(
            (
                (house_x - 18, house_y),
                (house_x + house_w // 2, house_y - house_h // 2),
                (house_x + house_w + 18, house_y),
            ),
            fill="#304f7a",
        )
        draw.rectangle(
            (
                house_x + house_w * 0.42,
                house_y + house_h * 0.42,
                house_x + house_w * 0.62,
                horizon,
            ),
            fill="#f9cf77",
        )

        subject_x = int(self._width * 0.67 + math.sin(elapsed * 0.8) * self._width * 0.06)
        subject_y = int(horizon - self._height * 0.12)
        head = int(self._height * 0.045)
        draw.ellipse(
            (subject_x - head, subject_y - head * 3, subject_x + head, subject_y - head),
            fill="#f1b987",
        )
        draw.line(
            (subject_x, subject_y - head, subject_x, subject_y + head * 2), fill="#242e49", width=10
        )
        draw.line(
            (subject_x, subject_y, subject_x - head * 2, subject_y + head), fill="#242e49", width=8
        )
        draw.line(
            (subject_x, subject_y, subject_x + head * 2, subject_y + head), fill="#242e49", width=8
        )
        draw.line(
            (subject_x, subject_y + head * 2, subject_x - head, subject_y + head * 4),
            fill="#242e49",
            width=8,
        )
        draw.line(
            (subject_x, subject_y + head * 2, subject_x + head, subject_y + head * 4),
            fill="#242e49",
            width=8,
        )

        self._last_frame = image
        return image

    def preview_jpeg(self, quality: int = 72) -> bytes:
        output = BytesIO()
        self.preview().save(output, "JPEG", quality=quality)
        return output.getvalue()

    def capture(self, output: Path) -> Path:
        output.parent.mkdir(parents=True, exist_ok=True)
        image = self._last_frame or self.preview()
        image.save(output, "JPEG", quality=90)
        return output

    def close(self) -> None:
        self._last_frame = None
        self.focus = FocusState(self.focus.supported)


class Picamera2Camera:
    def __init__(self, profile: HardwareProfile) -> None:
        self._profile = profile
        self._camera = None
        self._af_scanning = None
        self.focus = FocusState()
        self._scaler_crop = None
        self._focus_phase = ""
        self._focus_frames = 0
        self._focus_deadline = 0.0

    def start(self) -> None:
        try:
            from picamera2 import Picamera2
        except ImportError as error:
            raise RuntimeError(
                "Picamera2 is not installed; run the Muse Cam installer on Raspberry Pi OS"
            ) from error

        self.close()
        self._camera = camera = Picamera2()
        try:
            model = str(camera.camera_properties.get("Model", "unknown")).lower()
            if not self._profile.matches_camera_model(model):
                raise RuntimeError(
                    f"Profile {self._profile.id} expects {self._profile.camera_model}, "
                    f"but detected {model}. Select the matching camera profile and reboot."
                )
            camera_controls = {"FrameRate": self._profile.camera_fps}
            if self._profile.camera_autofocus:
                if "AfMode" not in camera.camera_controls:
                    raise RuntimeError(
                        f"Autofocus is unavailable on {model}. Check the camera profile, "
                        "focus motor connection, and camera driver installation. "
                        "IMX519 autofocus requires Arducam's libcamera packages."
                    )
                from libcamera import controls

                camera_controls["AfMode"] = controls.AfModeEnum.Continuous
                self._af_scanning = controls.AfStateEnum.Scanning
            # Keep both streams allocated for the lifetime of the camera. Mode
            # switches fragmented the Pi's CMA pool and could stop the preview
            # while allocating another full-resolution raw buffer after a shot.
            config = camera.create_still_configuration(
                main={
                    "size": (self._profile.capture_width, self._profile.capture_height),
                    "format": "RGB888",
                },
                lores={
                    "size": (self._profile.display_width, self._profile.display_height),
                    "format": "YUV420",
                },
                raw=None,
                controls=camera_controls,
                buffer_count=3,
                queue=False,
            )
            camera.options["quality"] = 90
            camera.configure(config)
            self.focus = FocusState(supported=self._profile.camera_autofocus and all(
                key in camera.camera_controls for key in ("AfWindows", "AfMetering", "AfPause")
            ))
            camera.start()
            LOGGER.info(
                "Camera %s started: %sx%s, autofocus=%s",
                model, self._profile.capture_width, self._profile.capture_height,
                "continuous" if self._profile.camera_autofocus else "off",
            )
        except Exception:
            self.close()
            raise

    def focus_at(self, point: tuple[float, float] | None) -> None:
        if not self.focus.supported or self._camera is None:
            raise ValueError("Tap to focus is unavailable on this camera")
        if point is not None and self._scaler_crop is None:
            raise ValueError("Waiting for camera framing. Try again in a moment.")
        from libcamera import controls

        values = {
            "AfMetering": (
                controls.AfMeteringEnum.Windows if point else controls.AfMeteringEnum.Auto
            ),
            "AfPause": controls.AfPauseEnum.Immediate,
        }
        if point is not None:
            values["AfWindows"] = [focus_window(point, self._scaler_crop)]
        # Changing the metering window alone does not trigger a new scan. Pause
        # continuous AF, acknowledge it in frame metadata, then resume. All of
        # this runs on the controller's camera thread without changing streams.
        self._camera.set_controls(values)
        self.focus = FocusState(True, point, "scanning")
        self._focus_phase, self._focus_frames = "pausing", 0
        self._focus_deadline = time.monotonic() + 5.0
        LOGGER.info("Focus area: %s", values.get("AfWindows", "auto"))

    def _read_focus(self, metadata: dict) -> None:
        if crop := metadata.get("ScalerCrop"):
            self._scaler_crop = tuple(crop)
        if self._af_scanning is None:
            return
        status = {0: "idle", 1: "scanning", 2: "focused", 3: "failed"}.get(
            metadata.get("AfState"), "unavailable"
        )
        if self._focus_phase:
            from libcamera import controls

            self._focus_frames += 1
            if self._focus_phase == "unconfirmed":
                # Without pause/resume acknowledgement, later AF metadata might
                # still refer to the old area. Leave the target unconfirmed until
                # another tap or Auto area starts a new, acknowledged cycle.
                return
            elif time.monotonic() >= self._focus_deadline:
                self._camera.set_controls({"AfPause": controls.AfPauseEnum.Resume})
                self._focus_phase = "unconfirmed"
                self.focus = replace(self.focus, status="unavailable")
                return
            elif self._focus_frames <= 3:
                # Drain the three configured buffers after each control change,
                # including rapid retaps, so stale metadata cannot turn the box green.
                return
            elif self._focus_phase == "pausing":
                if metadata.get("AfPauseState") == controls.AfPauseStateEnum.Paused:
                    self._camera.set_controls({"AfPause": controls.AfPauseEnum.Resume})
                    self._focus_phase, self._focus_frames = "resuming", 0
                return
            elif metadata.get("AfPauseState") != controls.AfPauseStateEnum.Running:
                return
            else:
                self._focus_phase = ""
        self.focus = replace(self.focus, status=status)

    def _request(self):
        if self._camera is None:
            raise RuntimeError("Camera is not started")
        # A stopped/disconnected camera must not block the controller forever.
        # Close cancels timed-out jobs before releasing the camera.
        return self._camera.capture_request(wait=3.0)

    def preview(self) -> Image.Image:
        with Image.open(BytesIO(self.preview_jpeg(quality=90))) as image:
            return image.copy()

    def preview_jpeg(self, quality: int = 72) -> bytes:
        request = self._request()
        output = BytesIO()
        previous_quality = self._camera.options.get("quality", 90)
        try:
            self._read_focus(request.get_metadata())
            # Picamera2's JPEG encoder handles YUV plane padding and colour order.
            # The Pi 3's low-resolution stream cannot output RGB directly.
            # Camera operations are serialized; restore still quality before the
            # next capture, including when encoding fails.
            self._camera.options["quality"] = quality
            request.save("lores", output, format="jpeg")
        finally:
            self._camera.options["quality"] = previous_quality
            request.release()
        return output.getvalue()

    def capture(self, output: Path) -> Path:
        output.parent.mkdir(parents=True, exist_ok=True)
        request = None
        deadline = time.monotonic() + FOCUS_SETTLE_SECONDS
        try:
            while True:
                request = self._request()
                if self._af_scanning is None:
                    break
                self._read_focus(request.get_metadata())
                if self.focus.status != "scanning" or time.monotonic() >= deadline:
                    if self.focus.status == "scanning":
                        LOGGER.info("Autofocus is still scanning; saving the latest frame")
                    break
                # Let continuous AF settle without switching sensor modes or holding a buffer.
                request.release()
                request = None
            request.save("main", str(output))
        finally:
            if request is not None:
                request.release()
        return output

    def close(self) -> None:
        camera, self._camera = self._camera, None
        self._af_scanning = None
        self.focus = FocusState()
        self._scaler_crop = None
        self._focus_phase = ""
        if camera is not None:
            try:
                camera.cancel_all_and_flush()
            finally:
                camera.close()


def create_camera(profile: HardwareProfile, *, simulate: bool) -> Camera:
    if simulate:
        return SimulatorCamera(
            profile.display_width, profile.display_height, autofocus=profile.camera_autofocus
        )
    if profile.camera_backend == "picamera2":
        return Picamera2Camera(profile)
    raise ValueError(f"Unsupported camera backend: {profile.camera_backend}")
