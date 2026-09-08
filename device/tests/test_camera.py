from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
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


@pytest.fixture
def fake_picamera(monkeypatch):
    class Request:
        def __init__(self, camera) -> None:
            self.camera = camera
            self.released = False

        def save(self, stream, output, format=None):
            if self.camera.save_error:
                raise self.camera.save_error
            Image.new("RGB", self.camera.config[stream]["size"], "red").save(output, "JPEG")

        def release(self):
            self.released = True

    class FakePicamera2:
        def __init__(self) -> None:
            self.options: dict[str, int] = {}
            self.configurations = 0
            self.requests = []
            self.save_error = None
            self.start_error = None
            self.request_error = None
            self.closed = False
            self.cancelled = False

        def create_still_configuration(self, **kwargs):
            return kwargs

        def configure(self, config) -> None:
            self.config = config
            self.configurations += 1

        def start(self) -> None:
            if self.start_error:
                raise self.start_error

        def capture_request(self, wait):
            assert 0 < wait <= 3
            if self.request_error:
                raise self.request_error
            request = Request(self)
            self.requests.append(request)
            return request

        def cancel_all_and_flush(self):
            self.cancelled = True

        def close(self):
            self.closed = True

    fake = FakePicamera2()
    monkeypatch.setitem(sys.modules, "picamera2", SimpleNamespace(Picamera2=lambda: fake))
    return fake


def test_picamera_keeps_preview_and_still_buffers_across_captures(fake_picamera, tmp_path) -> None:
    profile = load_profile("pi3bplus-imx415-dsi43", Path(__file__).parents[1] / "profiles")
    camera = Picamera2Camera(profile)
    camera.start()
    try:
        for index in range(3):
            preview = camera.preview()
            assert preview.size == (800, 480)
            r, g, b = preview.getpixel((0, 0))
            assert r > 240 and g < 10 and b < 10
            output = camera.capture(tmp_path / f"{index}.jpg")
            with Image.open(output) as saved:
                assert saved.size == (1920, 1280)
        assert fake_picamera.configurations == 1
        assert fake_picamera.config["raw"] is None
        assert fake_picamera.config["queue"] is False
        assert fake_picamera.config["controls"] == {"FrameRate": 15}
        assert all(request.released for request in fake_picamera.requests)
    finally:
        camera.close()


@pytest.mark.parametrize("operation", ["preview", "capture"])
def test_picamera_releases_request_when_image_save_fails(fake_picamera, tmp_path, operation):
    profile = load_profile("pi3bplus-imx415-dsi43", Path(__file__).parents[1] / "profiles")
    camera = Picamera2Camera(profile)
    camera.start()
    fake_picamera.save_error = OSError("Disk or encoder error")
    try:
        with pytest.raises(OSError):
            if operation == "preview":
                camera.preview()
            else:
                camera.capture(tmp_path / "failed.jpg")
        assert fake_picamera.requests[-1].released
    finally:
        camera.close()


def test_picamera_releases_device_on_failed_start_and_cancels_timed_out_jobs(fake_picamera):
    profile = load_profile("pi3bplus-imx415-dsi43", Path(__file__).parents[1] / "profiles")
    camera = Picamera2Camera(profile)
    fake_picamera.start_error = OSError(12, "Cannot allocate memory")
    with pytest.raises(OSError):
        camera.start()
    assert fake_picamera.closed and camera._camera is None

    fake_picamera.start_error = None
    fake_picamera.cancelled = False
    camera.start()
    fake_picamera.request_error = TimeoutError("No frame arrived")
    with pytest.raises(TimeoutError):
        camera.preview()
    camera.close()
    assert fake_picamera.cancelled and camera._camera is None
