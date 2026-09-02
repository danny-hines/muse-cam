from __future__ import annotations

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


def test_load_config_requires_credentials(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MUSECAM_SERVER_URL", raising=False)
    monkeypatch.delenv("MUSECAM_DEVICE_TOKEN", raising=False)
    with pytest.raises(ValueError, match="Missing MUSECAM_SERVER_URL"):
        load_config(tmp_path / "missing.env")


@pytest.mark.parametrize(
    ("profile_id", "width", "height", "input_backend"),
    (
        ("pi3bplus-imx415-tft35", 480, 320, "evdev-touch"),
        ("zero2-cam3-displayhat", 320, 240, "displayhat-buttons"),
    ),
)
def test_hardware_profiles_load(
    profile_id: str, width: int, height: int, input_backend: str
) -> None:
    profile = load_profile(profile_id, Path(__file__).parents[1] / "profiles")
    assert (profile.display_width, profile.display_height) == (width, height)
    assert profile.input_backend == input_backend
    assert profile.shutter_gpio == 20
    assert profile.power_gpio == 21


def test_pi3_touch_orientation_matches_landscape_display() -> None:
    profile = load_profile(
        "pi3bplus-imx415-tft35", Path(__file__).parents[1] / "profiles"
    )

    assert profile.touch_swap_xy is True
    assert profile.touch_invert_x is True
    assert profile.touch_invert_y is False
    assert profile.preview_fps == 10
