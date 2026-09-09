from __future__ import annotations

import sys
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image

from musecam.camera import Picamera2Camera, SimulatorCamera, focus_window, prepare_capture
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
            self.state = camera.focus_states.pop(0) if camera.focus_states else 2
            self.metadata = camera.metadata.pop(0) if camera.metadata else {"AfState": self.state}

        def save(self, stream, output, format=None):
            if self.camera.save_error:
                raise self.camera.save_error
            Image.new("RGB", self.camera.config[stream]["size"], "red").save(output, "JPEG")

        def release(self):
            assert not self.released
            self.released = True

        def get_metadata(self):
            return self.metadata

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
            self.camera_properties = {"Model": "imx415"}
            self.camera_controls = {}
            self.focus_states = []
            self.metadata = []
            self.control_changes = []

        def set_controls(self, values):
            self.control_changes.append(values)

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
    monkeypatch.setitem(sys.modules, "libcamera", SimpleNamespace(controls=SimpleNamespace(
        AfModeEnum=SimpleNamespace(Continuous=2), AfStateEnum=SimpleNamespace(Scanning=1),
        AfMeteringEnum=SimpleNamespace(Auto=0, Windows=1),
        AfPauseEnum=SimpleNamespace(Immediate=0, Resume=2),
        AfPauseStateEnum=SimpleNamespace(Running=0, Paused=2),
    )))
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


@pytest.mark.parametrize("model,profile_id", [
    ("imx519", "pi3bplus-imx519-dsi43"), ("imx708", "pi3bplus-cam3-dsi43"),
    ("imx708_wide", "pi3bplus-cam3-dsi43"), ("imx708_noir", "pi3bplus-cam3-dsi43"),
    ("imx708_wide_noir", "pi3bplus-cam3-dsi43"),
])
def test_autofocus_cameras_settle_without_reconfiguring(fake_picamera, tmp_path, model, profile_id):
    fake_picamera.camera_properties = {"Model": model}
    fake_picamera.camera_controls = {"AfMode": (0, 2, 0)}
    fake_picamera.focus_states = [1, 1, 2]
    profile = load_profile(profile_id, Path(__file__).parents[1] / "profiles")
    camera = Picamera2Camera(profile)
    camera.start()
    try:
        camera.capture(tmp_path / "focused.jpg")
        assert fake_picamera.config["controls"]["AfMode"] == 2
        assert len(fake_picamera.requests) == 3
        assert all(request.released for request in fake_picamera.requests)
        assert fake_picamera.configurations == 1 and fake_picamera.config["raw"] is None
    finally:
        camera.close()


def test_focus_timeout_still_saves_photo(fake_picamera, tmp_path, monkeypatch):
    profile = load_profile("pi3bplus-imx415-dsi43", Path(__file__).parents[1] / "profiles")
    fake_picamera.camera_controls = {"AfMode": (0, 2, 0)}
    fake_picamera.focus_states = [1] * 20
    clock = iter([0, 0.5, 1.3])
    monkeypatch.setattr("musecam.camera.time.monotonic", lambda: next(clock))
    camera = Picamera2Camera(replace(profile, camera_autofocus=True))
    camera.start()
    try:
        assert camera.capture(tmp_path / "still-scanning.jpg").is_file()
        assert len(fake_picamera.requests) == 2
        assert all(request.released for request in fake_picamera.requests)
    finally:
        camera.close()


@pytest.mark.parametrize("wrong_model", [True, False])
def test_wrong_sensor_or_missing_af_controls_fails_clearly(fake_picamera, wrong_model):
    profile = load_profile("pi3bplus-imx519-dsi43", Path(__file__).parents[1] / "profiles")
    fake_picamera.camera_properties = {"Model": "imx415" if wrong_model else "imx519"}
    camera = Picamera2Camera(profile)
    message = "expects imx519" if wrong_model else "Autofocus is unavailable"
    with pytest.raises(RuntimeError, match=message):
        camera.start()
    assert fake_picamera.closed and camera._camera is None


@pytest.mark.parametrize("point,expected", [
    ((0.5, 0.5), (850, 700, 300, 180)),
    ((0, 0), (0, 190, 300, 180)),
    ((1, 1), (1700, 1210, 300, 180)),
])
def test_focus_window_respects_sensor_crop_offset_and_edges(point, expected):
    assert focus_window(point, (0, 190, 2000, 1200)) == expected


@pytest.fixture(params=["imx519", "cam3"])
def autofocus_camera(fake_picamera, request):
    model = "imx519" if request.param == "imx519" else "imx708"
    fake_picamera.camera_properties = {"Model": model}
    fake_picamera.camera_controls = dict.fromkeys(["AfMode", "AfWindows", "AfMetering", "AfPause"])
    profile = load_profile(
        f"pi3bplus-{request.param}-dsi43", Path(__file__).parents[1] / "profiles"
    )
    camera = Picamera2Camera(profile)
    camera.start()
    fake_picamera.metadata = [{"AfState": 2, "ScalerCrop": (0, 190, 2000, 1200)}]
    camera.preview()
    yield camera
    camera.close()


def finish_focus_scan(camera, fake, result=2):
    # Old focused frames must never acknowledge the new target.
    fake.metadata = ([{"AfState": 2, "AfPauseState": 0}] * 3
                     + [{"AfState": 0, "AfPauseState": 2}]
                     + [{"AfState": 2, "AfPauseState": 2}] * 3
                     + [{"AfState": 1, "AfPauseState": 0}]
                     + [{"AfState": result, "AfPauseState": 0}])
    for _ in range(8):
        camera.preview()
        assert camera.focus.status == "scanning"
    camera.preview()


def test_tap_waits_for_fresh_focus_and_preserves_area_after_capture(
    autofocus_camera, fake_picamera, tmp_path
):
    camera = autofocus_camera
    assert camera.focus.supported
    camera.focus_at((0.5, 0.5))
    assert fake_picamera.control_changes[-1] == {
        "AfMetering": 1, "AfPause": 0, "AfWindows": [(850, 700, 300, 180)],
    }
    finish_focus_scan(camera, fake_picamera)
    assert camera.focus.status == "focused"
    assert fake_picamera.control_changes[-1] == {"AfPause": 2}
    camera.capture(tmp_path / "spot.jpg")
    assert camera.focus.point == (0.5, 0.5)
    assert fake_picamera.configurations == 1
    assert all(request.released for request in fake_picamera.requests)

    camera.focus_at(None)
    assert camera.focus.point is None
    assert fake_picamera.control_changes[-1] == {"AfMetering": 0, "AfPause": 0}
    finish_focus_scan(camera, fake_picamera)
    assert camera.focus.status == "focused"
    camera.start()
    assert camera.focus.point is None
    assert camera.focus.status == "unavailable"


def test_rapid_retarget_and_failed_focus_do_not_show_old_lock(autofocus_camera, fake_picamera):
    camera = autofocus_camera
    camera.focus_at((0.2, 0.3))
    fake_picamera.metadata = [{"AfState": 2, "AfPauseState": 2}]
    camera.preview()
    camera.focus_at((0.8, 0.7))
    finish_focus_scan(camera, fake_picamera, result=3)
    assert camera.focus.point == (0.8, 0.7)
    assert camera.focus.status == "failed"
    fake_picamera.metadata = [{}]
    camera.preview()
    assert camera.focus.status == "unavailable"


def test_missing_pause_metadata_times_out_and_resumes_af(
    autofocus_camera, fake_picamera, monkeypatch
):
    camera = autofocus_camera
    monkeypatch.setattr("musecam.camera.time.monotonic", lambda: 0)
    camera.focus_at((0.5, 0.5))
    monkeypatch.setattr("musecam.camera.time.monotonic", lambda: 6)
    camera.preview()
    assert camera.focus.status == "unavailable"
    assert fake_picamera.control_changes[-1] == {"AfPause": 2}
    camera.preview()  # Late Focused from the previous area is not confirmation.
    assert camera.focus.status == "unavailable"


def test_fixed_focus_rejects_tap_without_touching_hardware(fake_picamera):
    profile = load_profile("pi3bplus-imx415-dsi43", Path(__file__).parents[1] / "profiles")
    camera = Picamera2Camera(profile)
    camera.start()
    try:
        assert not camera.focus.supported
        with pytest.raises(ValueError, match="unavailable"):
            camera.focus_at((0.5, 0.5))
        assert not fake_picamera.control_changes
    finally:
        camera.close()
