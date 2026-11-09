from __future__ import annotations

import asyncio
import base64
import json
import threading
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
from musecam.looks import LOOK_PRESETS
from musecam.models import Preset
from musecam.webapp import RANDOM_PRESET, CameraWebController, create_web_app

API_KEY = "sk-standalone-do-not-expose"


def wait_until(predicate, timeout: float = 6):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if result := predicate():
            return result
        time.sleep(0.02)
    raise AssertionError("Timed out waiting for camera state")


def make_standalone(
    tmp_path: Path, *, offline: bool = False, environment: dict[str, str] | None = None
) -> CameraWebController:
    profiles = Path(__file__).parents[1] / "profiles"
    profile = load_profile("pi3bplus-cam3-dsi43", profiles)
    config = DeviceConfig(
        server_url="",
        device_token="",
        profile_id=profile.id,
        data_dir=tmp_path,
        profiles_dir=profiles,
        mode="standalone",
        environment={"META_API_KEY": API_KEY} if environment is None else environment,
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
            "original",
            *(p.id for p in LOOK_PRESETS),
            "random",
            *(p.id for p in FALLBACK_PRESETS),
        ]
        assert [p["kind"] for p in state["presets"][:3]] == ["original", "look", "look"]
        assert state["presets"][len(LOOK_PRESETS) + 2]["kind"] == "imagined"
        assert state["preset"]["id"] == "random"
        wait_until(lambda: controller.state()["status"] == "live")
        controller.dispatch("select", {"presetId": "alien-visitor"})
        controller.dispatch("capture")
        wait_until(lambda: controller._store.counts().get("complete") == 1)

        [item] = controller.gallery()["items"]
        cover = item["cover"]
        assert cover["presetId"] == "alien-visitor"
        assert cover["presetName"] == "First Contact"
        assert cover["shareUrl"] is None
        assert controller.version_path(cover["id"], "result").read_bytes() == result_jpeg()
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
        assert item["cover"]["error"] == "Try another style or framing."
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
            controller._share(item["cover"]["id"])
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
        result = controller.version_path(item["cover"]["id"], "result")
        assert result.read_bytes() != controller.original_path(item["id"]).read_bytes()
        with Image.open(result) as image:
            assert image.format == "JPEG"
    finally:
        controller.close()


def test_original_takes_a_plain_photo_that_can_be_styled_later(tmp_path: Path) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return success(request)

    controller = make_standalone(tmp_path)
    controller._image_model = meta_api(handler)
    controller.start()
    try:
        wait_until(lambda: controller.state()["status"] == "live")
        assert controller.state()["latestPhoto"] is None
        controller.dispatch("select", {"presetId": "original"})
        controller.dispatch("capture")
        wait_until(lambda: controller.state()["galleryCount"] == 1)
        [item] = controller.gallery()["items"]
        assert (item["status"], item["cover"], item["versionCount"]) == ("original", None, 0)
        # The camera screen's gallery button shows the newest photo.
        assert controller.state()["latestPhoto"] == {
            "id": item["id"],
            "thumbnailUrl": f"/api/gallery/{item['id']}/thumbnail",
        }
        assert controller._store.counts() == {}
        notice = controller.state()["notifications"][-1]
        assert (notice["captureId"], notice["photoId"]) == (None, item["id"])
        assert notice["message"].startswith("Original")
        assert requests == []
        # Restarting keeps the choice.
        controller._load_presets()
        assert controller.state()["preset"]["id"] == "original"

        with pytest.raises(ValueError, match="available style"):
            controller._remix({"photoId": item["id"], "presetId": "original"}, retry=False)
        controller.dispatch("remix", {"photoId": item["id"], "presetId": "claymation"})
        wait_until(lambda: controller._store.counts().get("complete") == 1)
        detail = controller.photo_detail(item["id"])
        [version] = detail["versions"]
        assert version["presetId"] == "claymation"
        assert detail["cover"]["id"] == version["id"]
        assert controller.state()["latestPhoto"]["thumbnailUrl"] == (
            f"/api/versions/{version['id']}/thumbnail?kind=result"
        )
        assert len(requests) == 1
    finally:
        controller.close()


def queue_versions(controller: CameraWebController, tmp_path: Path, count: int) -> list[str]:
    ids = []
    for index in range(count):
        source = tmp_path / f"waiting-{index}.jpg"
        source.write_bytes(result_jpeg("gray"))
        controller._store.enqueue(f"waiting-{index}", "claymation", source)
        ids.append(f"waiting-{index}")
    return ids


def test_a_camera_without_a_key_takes_plain_photos(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("A camera without a key never calls the model")

    controller = make_standalone(tmp_path, environment={})
    controller._image_model = meta_api(handler)
    controller._store.set_setting("presetId", "claymation")
    waiting = queue_versions(controller, tmp_path, 2)
    controller.start()
    try:
        wait_until(lambda: controller.state()["status"] == "live")
        state = controller.state()
        assert [p["id"] for p in state["presets"]] == [
            "original", *(p.id for p in LOOK_PRESETS)
        ]
        assert state["preset"]["id"] == "original"
        assert state["stylesOff"].startswith("Add META_API_KEY to /etc/musecam/device.env")
        # Versions queued before the key went missing fail now instead of waiting forever.
        assert [controller._store.get(i).status for i in waiting] == ["failed", "failed"]
        assert controller._store.get(waiting[0]).error == state["stylesOff"]
        # Versions keep their style's name although the rail no longer lists it.
        version = controller.version_json(controller._store.get(waiting[0]))
        assert version["presetName"] == "Tiny Clay World"

        controller.dispatch("capture")
        wait_until(lambda: controller.state()["galleryCount"] == 3)
        newest = controller.gallery()["items"][0]
        assert (newest["status"], newest["versionCount"]) == ("original", 0)
        with pytest.raises(ValueError, match="Add META_API_KEY"):
            controller._remix({"photoId": newest["id"], "presetId": "claymation"}, retry=False)
        with pytest.raises(ValueError, match="Add META_API_KEY"):
            controller._remix({"captureId": waiting[0]}, retry=True)
        # Choosing Original now keeps the saved style for when the key is back.
        controller.dispatch("select", {"presetId": "original"})
        wait_until(lambda: controller._actions.empty())
        assert controller._store.setting("presetId") == "claymation"
    finally:
        controller.close()

    restarted = make_standalone(tmp_path)
    restarted._load_presets()
    assert restarted.state()["preset"]["id"] == "claymation"
    assert restarted.state()["stylesOff"] is None


@pytest.mark.parametrize(
    ("status", "error", "reason"),
    (
        (401, {"code": "invalid_api_key", "message": "bad"}, "The API key was rejected"),
        (429, {"code": "insufficient_quota", "message": "quota"}, "out of credit"),
    ),
)
def test_a_broken_key_turns_styles_off_until_restart(
    tmp_path: Path, status: int, error: dict, reason: str
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(status, json={"error": error})

    controller = make_standalone(tmp_path)
    controller._image_model = meta_api(handler)
    controller._store.set_setting("presetId", "claymation")
    waiting = queue_versions(controller, tmp_path, 3)
    controller.start()
    try:
        wait_until(lambda: controller.state()["stylesOff"])
        wait_until(lambda: not controller._store.pending())
        state = controller.state()
        assert reason in state["stylesOff"]
        assert state["stylesOff"].endswith("then restart the camera.")
        # One call finds the problem; the rest of the queue fails without calling.
        assert len(requests) == 1
        assert {controller._store.get(i).status for i in waiting} == {"failed"}
        assert [p["id"] for p in state["presets"]] == [
            "original", *(p.id for p in LOOK_PRESETS)
        ]
        wait_until(lambda: controller.state()["notifications"])
        notice = controller.state()["notifications"][-1]
        assert (notice["kind"], notice["title"]) == ("error", "Styles are off")

        controller.dispatch("capture")
        wait_until(lambda: controller.state()["galleryCount"] == 4)
        assert controller.gallery()["items"][0]["versionCount"] == 0
        assert len(requests) == 1
        assert controller._store.setting("presetId") == "claymation"
    finally:
        controller.close()


def test_looks_are_made_on_the_camera_without_a_model_call(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("Looks never call the model")

    controller = make_standalone(tmp_path)
    controller._image_model = meta_api(handler)
    controller.start()
    try:
        wait_until(lambda: controller.state()["status"] == "live")
        controller.dispatch("select", {"presetId": "look-bw"})
        controller.dispatch("capture")
        wait_until(lambda: controller._store.counts().get("complete") == 1)
        [item] = controller.gallery()["items"]
        assert (item["status"], item["cover"]["presetName"]) == ("complete", "Black & White")
        assert controller.version_path(item["cover"]["id"], "result").is_file()
        wait_until(
            lambda: controller.state()["notifications"][-1]["title"] == "Your photo is ready"
        )
    finally:
        controller.close()


def test_looks_keep_working_when_styles_are_off(tmp_path: Path) -> None:
    controller = make_standalone(tmp_path, environment={})
    controller.start()
    try:
        wait_until(lambda: controller.state()["status"] == "live")
        assert controller.state()["stylesOff"]
        controller.dispatch("select", {"presetId": "look-vintage"})
        controller.dispatch("capture")
        wait_until(lambda: controller._store.counts().get("complete") == 1)
        [item] = controller.gallery()["items"]
        controller._remix({"photoId": item["id"], "presetId": "look-faded"}, retry=False)
        wait_until(lambda: controller._store.counts().get("complete") == 2)
        with pytest.raises(ValueError, match="Add META_API_KEY"):
            controller._remix({"photoId": item["id"], "presetId": "claymation"}, retry=False)
        # Random needs a model, and the saved choice stays a look.
        assert "random" not in {p["id"] for p in controller.state()["presets"]}
        assert controller._store.setting("presetId") == "look-vintage"
    finally:
        controller.close()


def test_a_look_does_not_wait_behind_a_model_call(tmp_path: Path) -> None:
    release = threading.Event()

    def handler(request: httpx.Request) -> httpx.Response:
        release.wait(5)
        return success(request)

    controller = make_standalone(tmp_path)
    controller._image_model = meta_api(handler)
    controller.start()
    try:
        wait_until(lambda: controller.state()["status"] == "live")
        controller.dispatch("select", {"presetId": "claymation"})
        controller.dispatch("capture")
        wait_until(lambda: controller.state()["processingId"])
        controller.dispatch("select", {"presetId": "look-punchy"})
        controller.dispatch("capture")
        wait_until(lambda: controller._store.counts().get("complete") == 1)
        newest = controller.gallery()["items"][0]
        assert newest["cover"]["presetId"] == "look-punchy"
        assert controller.state()["processingId"]
        release.set()
        wait_until(lambda: controller._store.counts().get("complete") == 2)
    finally:
        release.set()
        controller.close()


def test_random_picks_only_imagined_styles(tmp_path: Path, monkeypatch) -> None:
    controller = make_standalone(tmp_path, offline=True)
    controller._load_presets()
    seen = []
    monkeypatch.setattr(
        "musecam.webapp.random.choice", lambda options: seen.extend(options) or options[0]
    )
    try:
        controller._resolve_preset(RANDOM_PRESET)
        assert {p.id for p in seen} == {p.id for p in FALLBACK_PRESETS}
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
