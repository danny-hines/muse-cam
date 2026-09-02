from __future__ import annotations

import math
import time
from io import BytesIO
from pathlib import Path
from typing import Protocol

from PIL import Image, ImageDraw, ImageOps

from .config import HardwareProfile

MAX_UPLOAD_BYTES = 2_350_000
MAX_UPLOAD_EDGE = 2_048


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
    def start(self) -> None: ...

    def preview(self) -> Image.Image: ...

    def capture(self, output: Path) -> Path: ...

    def close(self) -> None: ...


class SimulatorCamera:
    def __init__(self, width: int, height: int) -> None:
        self._width = max(width, 640)
        self._height = max(height, 480)
        self._started_at = time.monotonic()
        self._last_frame: Image.Image | None = None

    def start(self) -> None:
        self._started_at = time.monotonic()

    def preview(self) -> Image.Image:
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

    def capture(self, output: Path) -> Path:
        output.parent.mkdir(parents=True, exist_ok=True)
        image = self._last_frame or self.preview()
        image.save(output, "JPEG", quality=90)
        return output

    def close(self) -> None:
        self._last_frame = None


class Picamera2Camera:
    def __init__(self, profile: HardwareProfile) -> None:
        self._profile = profile
        self._camera = None
        self._still_config = None

    def start(self) -> None:
        try:
            from picamera2 import Picamera2
        except ImportError as error:
            raise RuntimeError(
                "Picamera2 is not installed; run the Muse Cam installer on Raspberry Pi OS"
            ) from error

        camera = Picamera2()
        preview_size = (self._profile.display_width, self._profile.display_height)
        preview_config = camera.create_preview_configuration(
            # Picamera2's format names follow the DRM/V4L2 convention. BGR888
            # is RGB byte order in a numpy array, which is what Pillow expects.
            main={"size": preview_size, "format": "BGR888"},
            controls={"FrameRate": self._profile.camera_fps},
            buffer_count=3,
        )
        self._still_config = camera.create_still_configuration(
            main={
                "size": (self._profile.capture_width, self._profile.capture_height),
                "format": "RGB888",
            },
            buffer_count=2,
        )
        camera.options["quality"] = 90
        camera.configure(preview_config)
        camera.start()
        self._camera = camera

    def preview(self) -> Image.Image:
        if self._camera is None:
            raise RuntimeError("Camera is not started")
        return Image.fromarray(self._camera.capture_array("main"))

    def capture(self, output: Path) -> Path:
        if self._camera is None or self._still_config is None:
            raise RuntimeError("Camera is not started")
        output.parent.mkdir(parents=True, exist_ok=True)
        self._camera.switch_mode_and_capture_file(self._still_config, str(output))
        return output

    def close(self) -> None:
        if self._camera is not None:
            self._camera.stop()
            self._camera.close()
            self._camera = None


def create_camera(profile: HardwareProfile, *, simulate: bool) -> Camera:
    if simulate:
        return SimulatorCamera(profile.display_width, profile.display_height)
    if profile.camera_backend == "picamera2":
        return Picamera2Camera(profile)
    raise ValueError(f"Unsupported camera backend: {profile.camera_backend}")
