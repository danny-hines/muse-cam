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
    controller._store.save_presets([Preset("party-hats", 1, "Party Hats", "Event only", "#ffffff")])
    controller._image_model = meta_api(handler)
    controller.start()
    try:
        state = controller.state()
        assert state["canShare"] is False
        assert [p["id"] for p in state["presets"]] == [
            "original",
            "random",
            *(p.id for p in FALLBACK_PRESETS),
        ]
        assert [p["kind"] for p in state["presets"][:3]] == ["original", "random", "imagined"]
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
        wait_until(lambda: any(n["kind"] == "success" for n in controller.state()["notifications"]))
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
        assert [p["id"] for p in state["presets"]] == ["original"]
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
        (
            429,
            {"type": "insufficient_quota", "code": "credit_balance_exhausted", "message": "none"},
            "out of credit",
        ),
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
        assert [p["id"] for p in state["presets"]] == ["original"]
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


def take_plain_photo(controller: CameraWebController) -> str:
    wait_until(lambda: controller.state()["status"] == "live")
    controller.dispatch("select", {"presetId": "original"})
    count = controller.state()["galleryCount"]
    controller.dispatch("capture")
    wait_until(lambda: controller.state()["galleryCount"] == count + 1)
    return controller.gallery()["items"][0]["id"]


def size(path: Path) -> tuple[int, int]:
    with Image.open(path) as image:
        return image.size


def test_an_edit_adds_an_edited_version_and_editing_it_again_updates_it(
    tmp_path: Path,
) -> None:
    controller = make_standalone(tmp_path, offline=True)
    controller.start()
    try:
        photo_id = take_plain_photo(controller)
        original = controller.original_path(photo_id)
        before = original.read_bytes()
        controller.dispatch("view", {"screen": "photo", "photoId": photo_id})
        wait_until(lambda: controller.state()["view"]["photoId"] == photo_id)
        state = controller.state()
        assert state["canEdit"] is True
        assert [item["id"] for item in state["filters"]][:2] == ["look-bw", "look-warm-film"]

        saved = controller.save_edit(
            photo_id, {"target": None, "look": "look-warm-film", "light": 20}
        )
        [version] = controller.photo_detail(photo_id)["versions"]
        assert version["id"] == saved["versionId"]
        assert (version["presetName"], version["status"]) == ("Edited", "complete")
        assert version["edit"] == {
            "look": "look-warm-film",
            "light": 20,
            "contrast": 0,
            "color": 0,
            "warmth": 0,
            "from": None,
        }
        assert controller.state()["view"]["versionId"] == version["id"]
        result = controller.version_path(version["id"], "result")
        assert size(result) == size(original)
        assert controller.version_path(version["id"], "source") == original
        assert controller._store.counts() == {"complete": 1}

        # Editing the Edited version updates it in place, with new image URLs.
        again = controller.save_edit(
            photo_id, {"target": version["id"], "look": None, "color": -100}
        )
        assert again == saved
        [updated] = controller.photo_detail(photo_id)["versions"]
        assert updated["edit"]["look"] is None and updated["edit"]["color"] == -100
        assert updated["resultUrl"] != version["resultUrl"]
        assert updated["thumbnailUrl"] != version["thumbnailUrl"]
        with Image.open(result) as image:
            red, green, blue = image.convert("RGB").getpixel((40, 40))
        assert max(red, green, blue) - min(red, green, blue) <= 3
        assert original.read_bytes() == before
        assert not list((tmp_path / "results").glob("*.edit"))
    finally:
        controller.close()


def test_an_edit_of_a_styled_version_keeps_the_image_it_starts_from(tmp_path: Path) -> None:
    controller = make_standalone(tmp_path, offline=True)
    controller._image_model = MockImageModel(delay=0)
    controller.start()
    try:
        wait_until(lambda: controller.state()["status"] == "live")
        controller.dispatch("select", {"presetId": "claymation"})
        controller.dispatch("capture")
        wait_until(lambda: controller._store.counts().get("complete") == 1)
        wait_until(lambda: controller.state()["processingId"] is None)
        [item] = controller.gallery()["items"]
        styled = item["cover"]

        saved = controller.save_edit(item["id"], {"target": styled["id"], "contrast": 30})
        edited = controller._store.get(saved["versionId"])
        assert edited.edit["from"] == "Tiny Clay World"
        styled_result = controller.version_path(styled["id"], "result")
        assert edited.source_path == styled_result
        assert controller.photo_detail(item["id"])["cover"]["id"] == edited.capture_id

        # Deleting the styled version keeps its image for the edit made from it.
        controller.delete_version(styled["id"])
        assert styled_result.is_file()
        controller.save_edit(item["id"], {"target": edited.capture_id, "contrast": 10})
        controller.delete_version(edited.capture_id)
        assert not styled_result.exists()
        assert controller.original_path(item["id"]).is_file()
    finally:
        controller.close()


def test_edits_still_work_when_styles_are_off(tmp_path: Path) -> None:
    controller = make_standalone(tmp_path, environment={})
    controller.start()
    try:
        photo_id = take_plain_photo(controller)
        assert controller.state()["stylesOff"]
        controller.save_edit(photo_id, {"look": "look-vintage"})
        [version] = controller.photo_detail(photo_id)["versions"]
        assert version["edit"]["look"] == "look-vintage"
    finally:
        controller.close()


def test_edits_check_what_they_edit(tmp_path: Path) -> None:
    controller = make_standalone(tmp_path, offline=True)
    [waiting] = queue_versions(controller, tmp_path, 1)
    other = tmp_path / "other.jpg"
    other.write_bytes(result_jpeg())
    controller._store.add_photo("other", other)
    try:
        with pytest.raises(ValueError, match="Photo was not found"):
            controller.save_edit("missing", {})
        with pytest.raises(ValueError, match="Wait for this version to finish"):
            controller.save_edit(waiting, {"target": waiting})
        with pytest.raises(ValueError, match="version of the photo was not found"):
            controller.save_edit("other", {"target": waiting})
        with pytest.raises(ValueError, match="Invalid edit"):
            controller.save_edit("other", {"target": 3})
        with pytest.raises(ValueError, match="-100 to 100"):
            controller.save_edit("other", {"light": 500})
        with controller._edit_lock, pytest.raises(ValueError, match="Another edit"):
            controller.save_edit("other", {})
        controller._standalone = False
        with pytest.raises(ValueError, match="standalone camera"):
            controller.save_edit("other", {})
        assert controller._store.versions(["other"]) == {"other": []}
    finally:
        controller.close()


def test_a_photo_deleted_while_an_edit_renders_is_not_brought_back(
    tmp_path: Path, monkeypatch
) -> None:
    from musecam import edits

    started, release = threading.Event(), threading.Event()

    def slow_render(source: Path, destination: Path, edit) -> None:
        # Pause after rendering, before the edit is saved.
        edits.render(source, destination, edit)
        started.set()
        release.wait(5)

    monkeypatch.setattr("musecam.webapp.render_edit", slow_render)
    controller = make_standalone(tmp_path, offline=True)
    controller.start()
    try:
        photo_id = take_plain_photo(controller)
        first = controller.save_edit(photo_id, {"light": 10})["versionId"]
        started.clear()

        # An Edited version can't be deleted while it is being edited again.
        errors: list[Exception] = []

        def save(values: dict) -> None:
            try:
                controller.save_edit(photo_id, values)
            except ValueError as error:
                errors.append(error)

        worker = threading.Thread(target=save, args=({"target": first, "light": 30},))
        worker.start()
        started.wait(5)
        with pytest.raises(ValueError, match="Wait for this photo"):
            controller.delete_version(first)
        with pytest.raises(ValueError, match="Wait for this photo"):
            controller.delete_photo(photo_id)
        release.set()
        worker.join(5)
        assert errors == []
        assert controller._store.get(first).edit["light"] == 30

        # A new edit of a photo deleted meanwhile is dropped.
        started.clear()
        release.clear()
        worker = threading.Thread(target=save, args=({"warmth": 50},))
        worker.start()
        started.wait(5)
        controller.delete_photo(photo_id)
        release.set()
        worker.join(5)
        assert [str(error) for error in errors] == ["Photo was not found"]
        assert controller._store.counts() == {}
        assert not list((tmp_path / "results").iterdir())
    finally:
        release.set()
        controller.close()


def test_the_editor_over_http(tmp_path: Path) -> None:
    controller = make_standalone(tmp_path, offline=True)
    controller.start()

    async def exercise():
        async with TestClient(TestServer(create_web_app(controller))) as client:
            photo_id = await asyncio.to_thread(take_plain_photo, controller)
            response = await client.get(
                f"/api/edit/{photo_id}/preview?target=original&filter=look-bw&size=thumb"
            )
            assert (response.status, response.content_type) == (200, "image/jpeg")
            with Image.open(BytesIO(await response.read())) as image:
                assert max(image.size) == 200
            response = await client.get(f"/api/edit/{photo_id}/preview?size=screen")
            with Image.open(BytesIO(await response.read())) as image:
                assert max(image.size) == 800
            response = await client.get(f"/api/edit/{photo_id}/preview?size=huge")
            assert response.status == 400

            response = await client.post(f"/api/edit/{photo_id}", json={"light": 10})
            assert response.status == 403
            response = await client.post(
                f"/api/edit/{photo_id}",
                json={"look": "look-punchy", "warmth": -20},
                headers={"X-MuseCam-Request": "1"},
            )
            assert response.status == 200
            version_id = (await response.json())["versionId"]
            detail = await (await client.get(f"/api/gallery/{photo_id}")).json()
            assert detail["versions"][0]["id"] == version_id
            response = await client.get(detail["versions"][0]["resultUrl"])
            assert (response.status, response.content_type) == (200, "image/jpeg")

    try:
        asyncio.run(exercise())
    finally:
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
        # Looks keep the photo realistic, so Random never lands on one.
        fun = {p.id for p in FALLBACK_PRESETS if p.category == "fun"}
        assert {p.id for p in seen} == fun
        assert fun < {p.id for p in FALLBACK_PRESETS}
    finally:
        controller.close()


def test_looks_follow_the_fun_styles(tmp_path: Path) -> None:
    listed = {"id": "a", "version": 1, "name": "A", "description": "", "accent": "#fff"}
    assert Preset.from_api(listed).category == "fun"
    assert Preset.from_api({**listed, "category": "look"}).category == "look"
    controller = make_standalone(tmp_path, offline=True)
    try:
        controller._load_presets()
        styles = [p for p in controller.state()["presets"] if p["kind"] == "imagined"]
        kinds = [p["category"] for p in styles]
        assert kinds == sorted(kinds)  # "fun" sorts before "look"
        assert {"fun", "look"} == set(kinds)
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
