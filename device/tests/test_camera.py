from __future__ import annotations

import sys
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

from PIL import Image

from musecam.camera import Picamera2Camera, SimulatorCamera, prepare_capture
from musecam.config import load_profile


def test_simulator_camera_previews_and_captures(tmp_path: Path) -> None:
    camera = SimulatorCamera(480, 320)
    camera.start()
    frame = camera.preview()
    output = camera.capture(tmp_path / "capture.jpg")
    camera.close()

    assert frame.size == (640, 480)
    assert output.is_file()
    with Image.open(output) as captured:
        assert captured.format == "JPEG"
        assert captured.size == (640, 480)


def test_prepare_capture_normalizes_and_caps_upload(tmp_path: Path) -> None:
    output = tmp_path / "large.png"
    Image.effect_noise((2600, 1800), 80).convert("RGB").save(output, "PNG")

    prepare_capture(output, max_bytes=350_000)

    assert output.stat().st_size <= 350_000
    with Image.open(output) as prepared:
        assert prepared.format == "JPEG"
        assert max(prepared.size) <= 2_048


def test_picamera_preview_uses_pillow_rgb_byte_order(monkeypatch) -> None:
    class FakePicamera2:
        def __init__(self) -> None:
            self.options: dict[str, int] = {}
            self.preview_config = None

        def create_preview_configuration(self, **kwargs):
            self.preview_config = kwargs
            return kwargs

        def create_still_configuration(self, **kwargs):
            return kwargs

        def configure(self, config) -> None:
            self.config = config

        def start(self) -> None:
            pass

    fake = FakePicamera2()
    monkeypatch.setitem(sys.modules, "picamera2", SimpleNamespace(Picamera2=lambda: fake))
    profile = replace(
        load_profile("pi3bplus-imx415-tft35", Path(__file__).parents[1] / "profiles"),
        preview_fps=10,
    )

    camera = Picamera2Camera(profile)
    camera.start()

    assert fake.preview_config["main"] == {"size": (480, 320), "format": "BGR888"}
    assert fake.preview_config["controls"] == {"FrameRate": 10}
