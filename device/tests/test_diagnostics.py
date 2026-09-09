from pathlib import Path
from types import SimpleNamespace

import pytest

from musecam.config import load_profile
from musecam.diagnostics import _camera_check, _camera_overlay_check


@pytest.mark.parametrize("detected,expected_status", [
    ("imx708", "ok"), ("imx708_wide", "ok"), ("imx415", "failed"),
])
def test_doctor_checks_sensor_against_selected_profile(monkeypatch, detected, expected_status):
    monkeypatch.setattr("musecam.diagnostics.shutil.which", lambda _: "/usr/bin/rpicam-hello")
    result = SimpleNamespace(
        stdout=f"Available cameras\n0 : {detected} [4656x3496]\n", stderr="", returncode=0,
    )
    monkeypatch.setattr("musecam.diagnostics.subprocess.run", lambda *args, **kwargs: result)
    profile = load_profile("pi3bplus-cam3-dsi43", Path(__file__).parents[1] / "profiles")
    result = _camera_check(profile)
    assert result.status == expected_status
    if expected_status == "failed":
        assert "expects imx708" in result.detail


@pytest.mark.parametrize("settings,status", [
    ("# dtoverlay=imx708\n", "warning"),
    ("dtoverlay=imx708,rotation=180\n# dtoverlay=imx415\n", "ok"),
    ("dtoverlay=imx708\ndtoverlay=imx519\n", "failed"),
])
def test_doctor_ignores_comments_and_reports_conflicting_overlays(tmp_path, settings, status):
    config = tmp_path / "config.txt"
    config.write_text(settings)
    profile = load_profile("pi3bplus-cam3-dsi43", Path(__file__).parents[1] / "profiles")
    assert _camera_overlay_check(config, profile).status == status
