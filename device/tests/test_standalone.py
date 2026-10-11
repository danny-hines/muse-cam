from __future__ import annotations

import asyncio
import base64
import json
import time
from io import BytesIO
from pathlib import Path

import httpx
import pytest
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image

from musecam.app import FALLBACK_PRESETS
from musecam.config import DeviceConfig, load_profile
from musecam.image_model import MetaMuseImage, MockImageModel
from musecam.models import Preset
from musecam.webapp import CameraWebController, create_web_app

API_KEY = "sk-standalone-do-not-expose"


def wait_until(predicate, timeout: float = 6):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if result := predicate():
            return result
        time.sleep(0.02)
    raise AssertionError("Timed out waiting for camera state")


def make_standalone(tmp_path: Path, *, offline: bool = False) -> CameraWebController:
    profiles = Path(__file__).parents[1] / "profiles"
    profile = load_profile("pi3bplus-cam3-dsi43", profiles)
    config = DeviceConfig(
        server_url="",
        device_token="",
        profile_id=profile.id,
        data_dir=tmp_path,
        profiles_dir=profiles,
        mode="standalone",
        environment={"META_API_KEY": API_KEY},
    )
    return CameraWebController(config, profile, simulate=True, offline=offline)


def meta_api(handler) -> MetaMuseImage:
    return MetaMuseImage(API_KEY, None, httpx.Client(transport=httpx.MockTransport(handler)))


def result_jpeg(color: str = "purple") -> bytes:
    output = BytesIO()
    Image.new("RGB", (96, 64), color).save(output, "JPEG")
    return output.getvalue()


def success(request: httpx.Request) -> httpx.Response:
    return httpx.Response(
        200, json={"data": [{"b64_json": base64.b64encode(result_jpeg()).decode()}]}
    )


def test_standalone_camera_calls_the_model_directly(tmp_path: Path) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return success(request)

    controller = make_standalone(tmp_path)
    # A server style list cached while the camera was connected has no prompts here.
    controller._store.save_presets(
        [Preset("party-hats", 1, "Party Hats", "Event only", "#ffffff")]
    )
    controller._image_model = meta_api(handler)
    controller.start()
    try:
        state = controller.state()
        assert state["canShare"] is False
        assert [p["id"] for p in state["presets"]] == [
            "random",
            *(p.id for p in FALLBACK_PRESETS),
        ]
        wait_until(lambda: controller.state()["status"] == "live")
        controller.dispatch("select", {"presetId": "alien-visitor"})
        controller.dispatch("capture")
        wait_until(lambda: controller._store.counts().get("complete") == 1)

        [item] = controller.gallery()["items"]
        assert item["presetId"] == "alien-visitor"
        assert item["presetName"] == "First Contact"
        assert item["shareUrl"] is None
        assert controller.media_path(item["id"], "result").read_bytes() == result_jpeg()
        [request] = requests
        assert json.loads(request.content)["prompt"].startswith("Restyle the supplied photograph")
        assert request.headers["Authorization"] == f"Bearer {API_KEY}"
        wait_until(lambda: any(
            n["kind"] == "success" for n in controller.state()["notifications"]
        ))
        assert controller.state()["networkOnline"] is True
    finally:
        controller.close()


def test_busy_model_queues_and_filtered_photo_fails(tmp_path: Path) -> None:
    responses = iter(
        [
            httpx.Response(429, json={"error": {"message": "slow down"}}),
            httpx.Response(400, json={"error": {"message": "Filtered by policy"}}),
        ]
    )
    controller = make_standalone(tmp_path)
    controller._image_model = meta_api(lambda request: next(responses))
    controller.start()
    try:
        wait_until(lambda: controller.state()["status"] == "live")
        controller.dispatch("capture")
        wait_until(lambda: bool(controller._retry_after))
        [job] = controller._store.pending()
        assert job.error == "Service busy. Saved for automatic retry."
        assert controller.state()["networkOnline"] is False

        controller._retry_after.clear()
        wait_until(lambda: controller._store.counts().get("failed") == 1)
        [item] = controller.gallery(status="failed")["items"]
        assert item["error"] == "Try another style or framing."
    finally:
        controller.close()


def test_standalone_never_shares_or_queues_share_removals(tmp_path: Path) -> None:
    controller = make_standalone(tmp_path)
    controller._image_model = meta_api(success)
    controller.start()
    try:
        wait_until(lambda: controller.state()["status"] == "live")
        controller.dispatch("capture")
        # The camera loop releases the photo after the worker finishes.
        wait_until(lambda: controller._store.counts().get("complete") == 1)
        wait_until(lambda: controller.state()["processingId"] is None)
        [item] = controller.gallery()["items"]

        with pytest.raises(ValueError, match="Sharing needs a Muse Cam server"):
            controller._share(item["id"])
        controller.delete_photo(item["id"])

        assert controller._store.retraction_count() == 0
        assert controller.state()["notifications"][-1]["message"] == "Removed from this camera"
    finally:
        controller.close()


def test_offline_standalone_simulator_uses_the_mock_model(tmp_path: Path) -> None:
    controller = make_standalone(tmp_path, offline=True)
    assert isinstance(controller._image_model, MockImageModel)
    controller._image_model = MockImageModel(delay=0)
    controller.start()
    try:
        wait_until(lambda: controller.state()["status"] == "live")
        controller.dispatch("select", {"presetId": "claymation"})
        controller.dispatch("capture")
        wait_until(lambda: controller._store.counts().get("complete") == 1)
        [item] = controller.gallery()["items"]
        result = controller.media_path(item["id"], "result")
        assert result.read_bytes() != controller.media_path(item["id"], "source").read_bytes()
        with Image.open(result) as image:
            assert image.format == "JPEG"
    finally:
        controller.close()


def test_the_browser_never_receives_the_api_key(tmp_path: Path) -> None:
    controller = make_standalone(tmp_path)
    controller._image_model = meta_api(success)
    controller.start()

    async def exercise():
        async with TestClient(TestServer(create_web_app(controller))) as client:
            wait_until(lambda: controller.state()["status"] == "live")
            controller.dispatch("capture")
            await asyncio.to_thread(
                wait_until, lambda: controller._store.counts().get("complete") == 1
            )
            item = controller.gallery()["items"][0]
            paths = ("/api/state", "/api/settings", "/api/gallery", f"/api/gallery/{item['id']}")
            for path in paths:
                response = await client.get(path)
                assert response.status == 200
                assert API_KEY not in await response.text()

    try:
        asyncio.run(exercise())
    finally:
        controller.close()
