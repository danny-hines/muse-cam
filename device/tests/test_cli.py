from pathlib import Path

from musecam.cli import _update_env_file


def test_update_env_file_preserves_profile_and_replaces_credentials(tmp_path: Path) -> None:
    path = tmp_path / "device.env"
    path.write_text(
        "# camera settings\n"
        "MUSECAM_SERVER_URL=https://old.example\n"
        "MUSECAM_DEVICE_TOKEN=old-token\n"
        "MUSECAM_PROFILE=pi3bplus-imx415-dsi43\n",
        encoding="utf-8",
    )

    _update_env_file(
        path,
        {
            "MUSECAM_SERVER_URL": "https://www.muse-cam.com",
            "MUSECAM_DEVICE_TOKEN": "new-token",
            "MUSECAM_DEVICE_ID": "cam_123",
        },
    )

    assert path.read_text(encoding="utf-8") == (
        "# camera settings\n"
        "MUSECAM_SERVER_URL=https://www.muse-cam.com\n"
        "MUSECAM_DEVICE_TOKEN=new-token\n"
        "MUSECAM_PROFILE=pi3bplus-imx415-dsi43\n"
        "MUSECAM_DEVICE_ID=cam_123\n"
    )
    assert path.stat().st_mode & 0o777 == 0o640
