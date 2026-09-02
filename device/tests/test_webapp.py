from __future__ import annotations

import time
from pathlib import Path

from musecam.config import DeviceConfig, load_profile
from musecam.webapp import CameraWebController


def wait_for_status(controller: CameraWebController, status: str, timeout: float = 2) -> dict:
    deadline = time.monotonic() + timeout
    state = controller.state()
    while state["status"] != status and time.monotonic() < deadline:
        state = controller.wait_for_state(state["revision"], timeout=0.1)
    return state


def test_browser_controller_capture_flow(tmp_path: Path) -> None:
    profile = load_profile(
        "pi3bplus-imx415-dsi43", Path(__file__).parents[1] / "profiles"
    )
    config = DeviceConfig(
        server_url="http://127.0.0.1:3000",
        device_token="unused",
        profile_id=profile.id,
        data_dir=tmp_path,
        profiles_dir=Path(__file__).parents[1] / "profiles",
    )
    controller = CameraWebController(config, profile, simulate=True, offline=True)
    controller.start()
    try:
        state = wait_for_status(controller, "live")
        assert state["presetCount"] == 6

        controller.dispatch("next")
        changed = controller.wait_for_state(state["revision"])
        assert changed["presetIndex"] == 1

        controller.dispatch("capture")
        result = wait_for_status(controller, "result")
        assert result["resultUrl"].startswith("/media/result.jpg?v=")
        assert result["shared"] is False
        assert len(list((tmp_path / "results").glob("*.jpg"))) == 1
    finally:
        controller.close()
