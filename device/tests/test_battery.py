from pathlib import Path

from musecam.battery import PiSugarBattery


def test_missing_pisugar_socket_returns_no_percentage(tmp_path: Path) -> None:
    assert PiSugarBattery(tmp_path / "missing.sock").percentage() is None
