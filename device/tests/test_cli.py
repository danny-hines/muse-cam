import json
from pathlib import Path

import pytest
from PIL import Image

from musecam.cli import _update_env_file, main


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


def standalone_env(tmp_path: Path, monkeypatch, **values: str) -> Path:
    for key in ("MUSECAM_MODE", "MUSECAM_MODEL_PROVIDER", "META_API_KEY", "MUSECAM_MODEL_ID"):
        monkeypatch.delenv(key, raising=False)
    path = tmp_path / "device.env"
    lines = {"MUSECAM_MODE": "standalone", **values}
    path.write_text("".join(f"{key}={value}\n" for key, value in lines.items()), encoding="utf-8")
    return path


def run_cli(monkeypatch, capsys, *args: str) -> tuple[int, str]:
    monkeypatch.setattr("sys.argv", ["musecam", *args])
    with pytest.raises(SystemExit) as exit_info:
        main()
    return exit_info.value.code, capsys.readouterr().out


def test_standalone_health_checks_the_key_without_printing_it(tmp_path, monkeypatch, capsys):
    config = standalone_env(tmp_path, monkeypatch, META_API_KEY="m-secret-value")
    code, output = run_cli(monkeypatch, capsys, "--config", str(config), "health")
    assert code == 0
    assert json.loads(output)["apiKey"] == "META_API_KEY is set"
    assert "m-secret-value" not in output

    missing = standalone_env(tmp_path, monkeypatch, MUSECAM_MODEL_PROVIDER="openai")
    code, output = run_cli(monkeypatch, capsys, "--config", str(missing), "health")
    assert code == 1
    assert json.loads(output)["apiKey"] == "OPENAI_API_KEY is missing"


def test_standalone_submit_transforms_a_local_file(tmp_path, monkeypatch, capsys):
    config = standalone_env(tmp_path, monkeypatch, MUSECAM_MODEL_PROVIDER="mock")
    monkeypatch.setattr("musecam.image_model.time.sleep", lambda _: None)
    photo = tmp_path / "photo.jpg"
    Image.new("RGB", (400, 300), "teal").save(photo)
    output = tmp_path / "out.jpg"

    code, printed = run_cli(
        monkeypatch, capsys, "--config", str(config), "submit", str(photo),
        "--preset", "claymation", "--output", str(output),
    )

    assert code == 0
    assert json.loads(printed)["presetName"] == "Tiny Clay World"
    with Image.open(output) as result:
        assert result.size == (400, 300)
    assert photo.read_bytes() != output.read_bytes()
