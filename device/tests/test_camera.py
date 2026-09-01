from __future__ import annotations

from pathlib import Path

from PIL import Image

from musecam.camera import SimulatorCamera, prepare_capture


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
