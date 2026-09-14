from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

from musecam.config import load_config, load_profile


def test_load_config_reads_device_settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    for key in (
        "MUSECAM_SERVER_URL",
        "MUSECAM_DEVICE_TOKEN",
        "MUSECAM_PROFILE",
        "MUSECAM_DATA_DIR",
        "MUSECAM_LOG_LEVEL",
        "MUSECAM_PROFILES_DIR",
        "MUSECAM_POWER_BACKEND",
    ):
        monkeypatch.delenv(key, raising=False)
    config_path = tmp_path / "device.env"
    config_path.write_text(
        "\n".join(
            (
                "MUSECAM_SERVER_URL=https://camera.example/",
                "MUSECAM_DEVICE_TOKEN=secret-token",
                "MUSECAM_PROFILE=zero2-cam3-displayhat",
                f"MUSECAM_DATA_DIR={tmp_path / 'data'}",
                "MUSECAM_LOG_LEVEL=debug",
                "MUSECAM_POWER_BACKEND=pisugar3",
                f"MUSECAM_PROFILES_DIR={Path(__file__).parents[1] / 'profiles'}",
            )
        ),
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert config.server_url == "https://camera.example"
    assert config.device_token == "secret-token"
    assert config.profile_id == "zero2-cam3-displayhat"
    assert config.log_level == "DEBUG"
    assert config.data_dir == tmp_path / "data"
    assert config.power_backend == "pisugar3"


@pytest.mark.parametrize("camera", ("imx415", "imx519", "cam3"))
def test_battery_swap_preserves_camera_profile(camera: str) -> None:
    profiles = Path(__file__).parents[1] / "profiles"
    profile_id = f"pi3bplus-{camera}-dsi43"
    original = load_profile(profile_id, profiles)
    upgraded = load_profile(profile_id, profiles, power_backend="pisugar3")
    assert upgraded == replace(original, power_backend="pisugar3", battery_telemetry=True)
    assert not original.battery_telemetry


@pytest.mark.parametrize("backend", ("none", "pisugar-s-plus"))
def test_non_communicating_power_override_disables_telemetry(backend: str) -> None:
    profile = load_profile(
        "zero2-cam3-displayhat", Path(__file__).parents[1] / "profiles", power_backend=backend
    )
    assert profile.power_backend == backend
    assert not profile.battery_telemetry


def test_unknown_power_backend_is_rejected() -> None:
    with pytest.raises(ValueError, match="Unknown power backend"):
        load_profile("pi3bplus-cam3-dsi43", power_backend="pisguar3")


def test_load_config_requires_credentials(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MUSECAM_SERVER_URL", raising=False)
    monkeypatch.delenv("MUSECAM_DEVICE_TOKEN", raising=False)
    with pytest.raises(ValueError, match="Missing MUSECAM_SERVER_URL"):
        load_config(tmp_path / "missing.env")


@pytest.mark.parametrize(
    ("profile_id", "width", "height", "input_backend", "power_gpio"),
    (
        ("pi3bplus-imx415-tft35", 480, 320, "evdev-touch", 21),
        ("pi3bplus-imx415-dsi43", 800, 480, "browser-touch", None),
        ("pi3bplus-imx519-dsi43", 800, 480, "browser-touch", None),
        ("pi3bplus-cam3-dsi43", 800, 480, "browser-touch", None),
        ("zero2-cam3-displayhat", 320, 240, "displayhat-buttons", 21),
    ),
)
def test_hardware_profiles_load(
    profile_id: str, width: int, height: int, input_backend: str, power_gpio: int | None
) -> None:
    profile = load_profile(profile_id, Path(__file__).parents[1] / "profiles")
    assert (profile.display_width, profile.display_height) == (width, height)
    assert profile.input_backend == input_backend
    assert profile.shutter_gpio == 20
    assert profile.power_gpio == power_gpio
    assert profile.camera_autofocus == ("imx519" in profile_id or "cam3" in profile_id)
    assert profile.camera_model == (
        "imx708" if "cam3" in profile_id else "imx519" if "imx519" in profile_id else "imx415"
    )


def test_pi3_touch_orientation_matches_landscape_display() -> None:
    profile = load_profile(
        "pi3bplus-imx415-tft35", Path(__file__).parents[1] / "profiles"
    )

    assert profile.touch_swap_xy is True
    assert profile.touch_invert_x is True
    assert profile.touch_invert_y is False
    assert profile.camera_fps == 15
    assert profile.preview_fps == 6
