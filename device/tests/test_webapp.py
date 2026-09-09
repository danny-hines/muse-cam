from __future__ import annotations

import asyncio
import threading
import time
from pathlib import Path

import httpx
import pytest
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image

from musecam.app import FALLBACK_PRESETS, RETIRED_PRESETS
from musecam.config import DeviceConfig, load_profile
from musecam.webapp import CameraWebController, create_web_app


def wait_until(predicate, timeout: float = 6):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(0.02)
    raise AssertionError("Timed out waiting for camera state")


def make_controller(tmp_path: Path) -> CameraWebController:
    profiles = Path(__file__).parents[1] / "profiles"
    profile = load_profile("pi3bplus-imx415-dsi43", profiles)
    config = DeviceConfig(
        server_url="http://127.0.0.1:3000",
        device_token="do-not-expose",
        profile_id=profile.id,
        data_dir=tmp_path,
        profiles_dir=profiles,
    )
    return CameraWebController(config, profile, simulate=True, offline=True)


def test_retired_styles_leave_cached_picker_but_keep_gallery_and_retry(tmp_path: Path) -> None:
    controller = make_controller(tmp_path)
    try:
        controller._store.save_presets([*FALLBACK_PRESETS, *RETIRED_PRESETS.values()])
        controller._store.set_setting("presetId", "elven-dawn")
        controller._load_presets()
        state = controller.state()
        assert not {p["id"] for p in state["presets"]} & RETIRED_PRESETS.keys()
        assert state["preset"]["id"] == "age-of-legends"

        source = tmp_path / "captures" / "retired.jpg"
        Image.new("RGB", (100, 80), "orange").save(source)
        controller._store.enqueue("retired", "elven-dawn", source)
        controller._store.mark_failed("retired", "Generation failed")
        assert controller.gallery()["items"][0]["presetName"] == "Elven Dawn"
        with pytest.raises(ValueError, match="available style"):
            controller.dispatch("select", {"presetId": "elven-dawn"})
        with pytest.raises(ValueError, match="available style"):
            controller._remix({"captureId": "retired", "presetId": "elven-dawn"}, retry=False)

        controller._remix({"captureId": "retired"}, retry=True)
        pending = controller._store.pending()
        assert len(pending) == 1
        assert pending[0].preset_id == "elven-dawn"
        assert pending[0].source_path != source
        assert pending[0].source_path.read_bytes() == source.read_bytes()
        assert controller._store.get("retired").status == "failed"
    finally:
        controller.close()


@pytest.mark.parametrize("failure", ["capture", "preview"])
def test_camera_error_recovers_and_allows_another_photo(tmp_path, monkeypatch, failure):
    controller = make_controller(tmp_path)
    monkeypatch.setattr("musecam.webapp.CAMERA_RETRY_DELAY", 0.3)
    original = getattr(controller._camera, failure)
    fail_next = threading.Event()

    def interrupt_once(*args):
        if fail_next.is_set():
            fail_next.clear()
            if failure == "capture":
                raise OSError(12, "Cannot allocate memory")
            raise TimeoutError("No preview frame")
        return original(*args)

    monkeypatch.setattr(controller._camera, failure, interrupt_once)
    controller._preview_consumers = 1
    controller.start()
    try:
        wait_until(lambda: controller._preview_jpeg is not None)
        fail_next.set()
        if failure == "capture":
            controller.dispatch("capture")
        wait_until(lambda: controller.state()["status"] == "error")
        assert not controller._camera_available
        assert controller._preview_jpeg is None
        assert controller.state()["message"] != "Hold steady"
        assert controller.state()["galleryCount"] == 0
        assert not list((tmp_path / "captures").iterdir())
        controller.dispatch("next")
        wait_until(lambda: controller.state()["presetIndex"] == 1)
        wait_until(lambda: controller.state()["status"] == "live")
        wait_until(lambda: controller._preview_jpeg is not None)
        assert controller.state()["message"] == ""
        controller.dispatch("capture")
        wait_until(lambda: controller._store.counts().get("complete") == 1)
    finally:
        controller.close()


def test_camera_start_retries_are_bounded_and_manual_restart_works(tmp_path, monkeypatch):
    controller = make_controller(tmp_path)
    monkeypatch.setattr("musecam.webapp.CAMERA_RETRY_DELAY", 0.01)
    original_start = controller._camera.start

    def fail_start():
        raise OSError(12, "Cannot allocate memory")

    monkeypatch.setattr(controller._camera, "start", fail_start)
    controller.start()
    try:
        wait_until(lambda: controller._camera_start_attempts == 3)
        wait_until(lambda: controller._camera_restart_at is None)
        assert controller.state()["status"] == "error"
        assert controller._thread.is_alive()
        # The action loop remains available while the sensor is down.
        controller.dispatch("next")
        wait_until(lambda: controller.state()["presetIndex"] == 1)
        monkeypatch.setattr(controller._camera, "start", original_start)
        controller.dispatch("restart_camera")
        wait_until(lambda: controller.state()["status"] == "live")
        controller.dispatch("capture")
        wait_until(lambda: controller._store.counts().get("complete") == 1)
    finally:
        controller.close()


def test_capture_remains_available_during_generation(tmp_path: Path, monkeypatch) -> None:
    controller = make_controller(tmp_path)
    release = threading.Event()
    entered = threading.Event()
    process = controller._process_job

    def delayed(job):
        entered.set()
        assert release.wait(5)
        return process(job)

    monkeypatch.setattr(controller, "_process_job", delayed)
    controller.start()
    try:
        wait_until(lambda: controller.state()["status"] == "live")
        controller.dispatch("capture")
        assert entered.wait(2)
        first = controller.state()["processingId"]
        next_style = controller.state()["presets"][1]["id"]
        controller.dispatch("select", {"presetId": next_style})
        controller.dispatch("capture")
        wait_until(lambda: controller.state()["galleryCount"] == 2)
        state = controller.state()
        assert state["status"] == "live"
        assert state["processingId"] == first
        assert state["queued"] == 1
        assert controller.gallery()["items"][0]["presetId"] == next_style
        release.set()
        wait_until(lambda: controller._store.counts().get("complete") == 2)
        # The worker commits first; the camera loop then publishes its completion notice.
        wait_until(
            lambda: (
                len([n for n in controller.state()["notifications"] if n["kind"] == "success"]) == 2
            )
        )
        assert controller.state()["status"] == "live"
        assert len([n for n in controller.state()["notifications"] if n["kind"] == "success"]) == 2
    finally:
        release.set()
        controller.close()


def test_gallery_retry_and_restyle_preserve_originals(tmp_path: Path) -> None:
    controller = make_controller(tmp_path)
    source = tmp_path / "captures" / "old.jpg"
    Image.new("RGB", (100, 80), "orange").save(source)
    style = controller._presets[0].id
    controller._store.enqueue("old", style, source)
    controller._store.mark_failed("old", "Generation failed")
    controller.start()
    try:
        controller.dispatch("retry", {"captureId": "old"})
        wait_until(lambda: controller._store.counts().get("complete") == 1)
        retried = controller.gallery()["items"][0]
        assert retried["id"] != "old"
        assert controller._store.get("old").status == "failed"
        assert controller.media_path(retried["id"], "source").read_bytes() == source.read_bytes()
        assert controller.media_path(retried["id"], "source") != source
        controller.dispatch(
            "remix", {"captureId": retried["id"], "presetId": controller._presets[2].id}
        )
        wait_until(lambda: controller._store.counts().get("complete") == 2)
        newest = controller.gallery()["items"][0]
        assert newest["id"] != retried["id"]
        assert newest["presetId"] == controller._presets[2].id
        assert controller._store.get(retried["id"]).preset_id == style
        assert controller.state()["galleryCount"] == 3
    finally:
        controller.close()


def test_failed_network_job_backs_off_and_allows_new_capture(tmp_path: Path) -> None:
    controller = make_controller(tmp_path)
    controller.start()

    class OfflineClient:
        def generate(self, *args):
            raise httpx.ConnectError("No network")

        def close(self):
            pass

    controller._client = OfflineClient()
    try:
        controller.dispatch("capture")
        wait_until(lambda: bool(controller._retry_after))
        first = next(iter(controller._retry_after))
        assert controller._store.get(first).attempts == 1
        assert controller._store.get(first).status == "queued"
        controller.dispatch("capture")
        wait_until(lambda: len(controller._retry_after) == 2)
        assert controller._store.get(first).attempts == 1
        assert controller.state()["status"] == "live"
        assert controller.state()["networkOnline"] is False
    finally:
        controller.close()


def test_settings_and_history_survive_restart(tmp_path: Path) -> None:
    controller = make_controller(tmp_path)
    controller.save_settings({"volume": 0, "processingSound": False})
    source = tmp_path / "captures" / "persist.jpg"
    Image.new("RGB", (80, 60), "blue").save(source)
    controller._store.enqueue("persist", controller._presets[0].id, source)
    controller._store.mark_uploading("persist")
    session = controller.state()["sessionId"]
    controller.close()
    reopened = make_controller(tmp_path)
    try:
        assert reopened.state()["sessionId"] != session
        assert reopened.state()["volume"] == 0
        assert reopened.state()["processingSound"] is False
        assert reopened.gallery()["items"][0]["status"] == "queued"
        assert reopened.settings()["battery"]["percentage"] is None
        assert reopened.settings()["battery"]["supported"] is False
    finally:
        reopened.close()


def test_delete_removes_one_photo_and_preserves_restyled_original(tmp_path: Path) -> None:
    controller = make_controller(tmp_path)
    source = tmp_path / "captures" / "old.jpg"
    result = tmp_path / "results" / "old.jpg"
    Image.new("RGB", (100, 80), "orange").save(source)
    Image.new("RGB", (100, 80), "blue").save(result)
    style = controller._presets[0].id
    controller._store.enqueue("old", style, source)
    controller._store.mark_complete("old", "generation-old", result, "https://example.com/p/shared")
    controller._remix({"captureId": "old", "presetId": style}, retry=False)
    sibling = controller._store.pending()[0]
    source_bytes = source.read_bytes()
    controller._last_capture_id = controller._last_result_id = "old"
    controller._notify("success", "Ready", "", "old")
    revision = controller.state()["galleryRevision"]
    try:
        controller.delete_photo("old")
        assert not source.exists() and not result.exists()
        assert controller._store.get("old") is None
        assert sibling.source_path.read_bytes() == source_bytes
        assert controller._store.get(sibling.capture_id) is not None
        assert controller.state()["galleryCount"] == 1
        assert controller.state()["galleryRevision"] > revision
        assert controller.state()["lastCaptureId"] is None
        assert controller._last_result_id is None
        assert not any(n["captureId"] == "old" for n in controller.state()["notifications"])
        assert controller.state()["notifications"][-1]["kind"] == "deleted"
        with pytest.raises(ValueError, match="unavailable"):
            controller.media_path("old", "source")
    finally:
        controller.close()
    reopened = make_controller(tmp_path)
    try:
        assert reopened._store.get("old") is None
        assert reopened.state()["galleryCount"] == 1
    finally:
        reopened.close()


@pytest.mark.parametrize("status", ["queued", "failed"])
def test_delete_waiting_or_failed_photo_cleans_partial_download(
    tmp_path: Path, status: str
) -> None:
    controller = make_controller(tmp_path)
    source = tmp_path / "captures" / "old.jpg"
    source.write_bytes(b"original")
    partial = tmp_path / "results" / "old.download"
    partial.write_bytes(b"partial download")
    controller._store.enqueue("old", controller._presets[0].id, source)
    if status == "failed":
        controller._store.mark_failed("old", "Could not finish")
    controller._retry_after["old"] = time.monotonic() + 60
    try:
        controller.delete_photo("old")
        assert not source.exists() and not partial.exists()
        assert "old" not in controller._retry_after
        controller._start_pending()
        assert controller._future is None
        assert controller.state()["galleryCount"] == 0
    finally:
        controller.close()


@pytest.mark.parametrize("busy", ["uploading", "processing", "sharing", "maintenance"])
def test_delete_refuses_busy_photo_without_removing_files(tmp_path: Path, busy: str) -> None:
    controller = make_controller(tmp_path)
    source = tmp_path / "captures" / "busy.jpg"
    source.write_bytes(b"keep me")
    controller._store.enqueue("busy", controller._presets[0].id, source)
    controller._store.mark_failed("busy", "Previous failure")
    if busy == "uploading":
        controller._store.mark_uploading("busy")
    elif busy == "processing":
        controller._processing_id = "busy"  # Worker finished; publication is still pending.
    elif busy == "sharing":
        controller._sharing_id = "busy"
    else:
        controller._maintenance = True
    try:
        with pytest.raises(ValueError):
            controller.delete_photo("busy")
        assert source.read_bytes() == b"keep me"
        assert controller._store.get("busy") is not None
    finally:
        controller.close()


def test_delete_validates_all_paths_and_preserves_shared_legacy_files(tmp_path: Path) -> None:
    controller = make_controller(tmp_path)
    source = tmp_path / "captures" / "shared.jpg"
    source.write_bytes(b"shared original")
    unrelated = tmp_path / "unrelated.txt"
    unrelated.write_bytes(b"not a photo")
    style = controller._presets[0].id
    controller._store.enqueue("one", style, source)
    controller._store.mark_complete("one", "gen-one", unrelated)
    controller._store.enqueue("two", style, source)
    try:
        with pytest.raises(ValueError, match="outside"):
            controller.delete_photo("one")
        assert source.exists() and unrelated.exists()
        result = tmp_path / "results" / "one.jpg"
        result.symlink_to(unrelated)
        controller._store.mark_complete("one", "gen-one", result)
        with pytest.raises(ValueError, match="outside"):
            controller.delete_photo("one")
        assert source.exists() and unrelated.exists()
        result.unlink()
        controller.delete_photo("one")  # Missing result is also tolerated.
        assert source.exists() and unrelated.exists()
        assert controller._store.get("one") is None
        assert controller._store.get("two") is not None
        controller.delete_photo("two")
        assert not source.exists()
        with pytest.raises(ValueError, match="not found"):
            controller.delete_photo("two")
    finally:
        controller.close()


def test_update_is_blocked_with_saved_pending_photos(tmp_path: Path) -> None:
    controller = make_controller(tmp_path)
    try:
        controller._store.enqueue("pending", "style", tmp_path / "pending.jpg")
        with pytest.raises(ValueError, match="queued photos"):
            controller.update()
        assert controller.state()["maintenance"] is False
    finally:
        controller.close()


def test_gallery_filter_finds_failures_older_than_first_page(tmp_path: Path) -> None:
    controller = make_controller(tmp_path)
    try:
        controller._store.enqueue("old-failed", "style", tmp_path / "old.jpg")
        controller._store.mark_failed("old-failed", "Try again")
        for index in range(45):
            controller._store.enqueue(f"new-{index}", "style", tmp_path / "new.jpg")
        assert "old-failed" not in [p["id"] for p in controller.gallery()["items"]]
        assert controller.gallery(status="failed")["items"][0]["id"] == "old-failed"
        assert len(controller.gallery(offset=40, status="waiting")["items"]) == 5
    finally:
        controller.close()


def test_old_device_job_cannot_clear_update_maintenance(tmp_path: Path, monkeypatch) -> None:
    controller = make_controller(tmp_path)
    try:
        controller._maintenance = True
        controller._maintenance_job = "current-update"
        monkeypatch.setattr(
            controller._system,
            "request",
            lambda action: {"job": {"id": "old-wifi", "kind": "wifi", "phase": "complete"}},
        )
        controller.settings()
        assert controller.state()["maintenance"] is True
        monkeypatch.setattr(
            controller._system,
            "request",
            lambda action: {"job": {"id": "current-update", "kind": "update", "phase": "failed"}},
        )
        controller.settings()
        assert controller.state()["maintenance"] is False
    finally:
        controller.close()


def test_preview_slows_when_hot_and_recovers_after_cooling(tmp_path: Path, monkeypatch) -> None:
    controller = make_controller(tmp_path)
    try:
        for temperature, expected in [(78, True), (72, True), (67, False)]:
            monkeypatch.setattr(controller._system, "temperature", lambda value=temperature: value)
            controller._last_battery_read = 0
            controller._refresh_battery()
            assert controller.settings()["previewThrottled"] is expected
            assert controller.settings()["temperature"] == temperature
        assert controller._profile.capture_width == 1920
    finally:
        controller.close()


def test_http_gallery_and_local_settings_boundary(tmp_path: Path) -> None:
    controller = make_controller(tmp_path)
    source = tmp_path / "captures" / "private.jpg"
    Image.new("RGB", (160, 120), "red").save(source)
    controller._store.enqueue("private", controller._presets[0].id, source)
    headers = {"X-MuseCam-Request": "1"}

    async def exercise():
        async with TestClient(TestServer(create_web_app(controller))) as client:
            assert (await client.post("/api/settings", json={"volume": 0})).status == 403
            assert (
                await client.post(
                    "/api/settings",
                    json={"volume": 0},
                    headers={**headers, "Origin": "https://evil.example"},
                )
            ).status == 403
            assert (
                await client.get("/api/settings", headers={"Host": "evil.example"})
            ).status == 403
            response = await client.post("/api/settings", json={"volume": 0}, headers=headers)
            assert response.status == 200
            assert (await response.json())["volume"] == 0
            assert (
                await client.post("/api/settings", json={"volume": 999}, headers=headers)
            ).status == 400
            for path, body in [
                ("/api/settings", []),
                ("/api/sound", []),
                ("/api/sound", {"cue": []}),
                ("/api/system/wifi-scan", {"action": "update-apply"}),
            ]:
                assert (await client.post(path, json=body, headers=headers)).status == 400
            response = await client.get("/api/gallery")
            item = (await response.json())["items"][0]
            assert item["id"] == "private"
            assert "do-not-expose" not in await (await client.get("/api/state")).text()
            assert (await client.get(item["sourceUrl"])).status == 200
            assert (await client.get(item["thumbnailUrl"])).content_type == "image/jpeg"
            assert (await client.get("/api/gallery/missing")).status == 404
            assert (await client.get("/api/gallery/private/result")).status == 400
            delete_url = "/api/gallery/private/delete"
            assert (await client.post(delete_url, json={})).status == 403
            assert (
                await client.post(
                    delete_url, json={}, headers={**headers, "Origin": "https://evil.example"}
                )
            ).status == 403
            assert source.exists()
            response = await client.post(delete_url, json={}, headers=headers)
            assert response.status == 200
            assert (await response.json())["deleted"] is True
            assert not source.exists()
            assert (await client.get("/api/gallery/private")).status == 404
            assert (await client.get(item["sourceUrl"])).status == 400
            assert (await client.get("/api/gallery")).status == 200
            assert (await client.post(delete_url, json={}, headers=headers)).status == 400

    try:
        asyncio.run(exercise())
    finally:
        controller.close()


def test_shutdown_ends_open_event_and_preview_streams(tmp_path: Path) -> None:
    controller = make_controller(tmp_path)
    controller.start()

    async def exercise():
        client = TestClient(TestServer(create_web_app(controller)))
        await client.start_server()
        events = await client.get("/api/events")
        preview = await client.get("/preview.mjpg")
        await events.content.readline()
        await preview.content.readline()
        try:
            await asyncio.wait_for(client.server.close(), timeout=3)
            assert controller._stop.is_set()
        finally:
            await client.close()

    try:
        asyncio.run(exercise())
    finally:
        controller.close()
