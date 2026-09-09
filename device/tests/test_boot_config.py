import subprocess
from pathlib import Path

import pytest

from musecam.boot_config import camera_boot_config, configure_camera


def active_lines(text):
    return [line.strip() for line in text.splitlines() if not line.lstrip().startswith("#")]


@pytest.mark.parametrize("overlay", ["imx415", "imx519", "imx708", "auto"])
def test_camera_switch_replaces_conflicts_and_is_idempotent(overlay):
    before = (
        "[all]\ncamera_auto_detect=1\ndtoverlay=imx415,rotation=180\n"
        "dtoverlay=imx519\ndtoverlay=vc4-kms-v3d,cma-256\n"
        "dtoverlay=musecam-i2s-out\n[pi4]\narm_boost=1\n"
    )
    after = camera_boot_config(before, overlay)
    assert camera_boot_config(after, overlay) == after
    lines = active_lines(after)
    assert "dtoverlay=musecam-i2s-out" in lines
    assert "dtoverlay=vc4-kms-v3d,cma-256" in lines
    assert "arm_boost=1" in lines
    assert f"camera_auto_detect={int(overlay == 'auto')}" in lines
    camera_lines = [line for line in lines if line.startswith("dtoverlay=imx")]
    expected = [] if overlay == "auto" else [
        "dtoverlay=imx415,rotation=180" if overlay == "imx415" else f"dtoverlay={overlay}"
    ]
    assert camera_lines == expected
    assert lines.index("[all]", lines.index("[pi4]")) > lines.index("arm_boost=1")


def test_switching_between_managed_profiles_removes_previous_camera():
    text = "dtparam=audio=off\n"
    for overlay in ["imx415", "imx519", "imx708", "auto", "imx415"]:
        text = camera_boot_config(text, overlay)
        assert text.count("# BEGIN Muse Cam camera") == 1
        assert camera_boot_config(text, overlay) == text
        assert sum(line.startswith("dtoverlay=imx") for line in active_lines(text)) == (
            0 if overlay == "auto" else 1
        )


def test_configuration_checks_driver_and_preserves_backup(tmp_path: Path):
    config = tmp_path / "config.txt"
    config.write_text("[all]\ndtoverlay=imx415\n")
    original = config.read_bytes()
    config.chmod(0o640)
    overlays = tmp_path / "overlays"
    overlays.mkdir()
    with pytest.raises(ValueError, match="Install the camera driver first"):
        configure_camera(config, "imx519", overlays)
    assert config.read_bytes() == original
    (overlays / "imx519.dtbo").touch()
    assert configure_camera(config, "imx519", overlays)
    assert next(tmp_path.glob("config.txt.musecam-*.bak")).read_bytes() == original
    assert config.stat().st_mode & 0o777 == 0o640
    assert not configure_camera(config, "imx519", overlays)
    assert len(list(tmp_path.glob("*.bak"))) == 1


def test_malformed_managed_block_is_not_overwritten():
    with pytest.raises(ValueError, match="Unterminated"):
        camera_boot_config("# BEGIN Muse Cam camera\ndtoverlay=imx415\n", "imx519")


@pytest.mark.parametrize("existing", [
    "dtoverlay=vc4-kms-v3d,cma-256\n", "# dtoverlay=vc4-kms-v3d\n",
])
def test_installer_preserves_display_memory_parameters(tmp_path, existing):
    config = tmp_path / "config.txt"
    original = existing + "dtoverlay=musecam-i2s-output\n"
    config.write_text(original)
    installer = Path(__file__).parents[2] / "scripts/install-device.sh"
    functions = installer.read_text().split('\nwhile [[ $# -gt 0 ]]; do')[0]
    # Override the path without running the installer's apt/systemd/boot operations.
    command = functions + '''
boot_config_path() { printf '%s\\n' "$TEST_BOOT_CONFIG"; }
TEST_BOOT_CONFIG="$1"
ensure_boot_config_overlay vc4-kms-v3d
ensure_boot_config_overlay vc4-kms-v3d
'''
    subprocess.run(["bash", "-c", command, "test-installer", str(config)], check=True)
    if existing.startswith("#"):
        assert config.read_text() == original + "\ndtoverlay=vc4-kms-v3d\n"
    else:
        assert config.read_text() == original
