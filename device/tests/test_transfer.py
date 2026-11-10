from __future__ import annotations

import asyncio
import zipfile
from io import BytesIO
from pathlib import Path

import aiohttp
import pytest
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image
from test_standalone import make_standalone, take_plain_photo
from test_webapp import make_controller

from musecam import transfer
from musecam.webapp import create_web_app

LOCAL = {"X-MuseCam-Request": "1"}


def test_photos_open_to_the_network_only_behind_the_code(tmp_path: Path) -> None:
    controller = make_standalone(tmp_path, offline=True)
    controller.start()

    async def exercise():
        app = create_web_app(controller, transfer_port=0)
        async with TestClient(TestServer(app)) as client, aiohttp.ClientSession() as phone:
            photo_id = await asyncio.to_thread(take_plain_photo, controller)
            response = await client.post(
                f"/api/edit/{photo_id}", json={"look": "look-bw"}, headers=LOCAL
            )
            version_id = (await response.json())["versionId"]

            assert controller.state()["canTransfer"] is True
            assert await (await client.get("/api/transfer")).json() == {"active": False}
            assert (await client.post("/api/transfer/start", json={})).status == 403
            response = await client.post("/api/transfer/start", json={}, headers=LOCAL)
            started = await response.json()
            assert started["active"] and started["ssid"] == "Studio Wi-Fi"
            url = started["url"]
            assert url.startswith("http://127.0.0.1:") and len(url.split("/")[3]) >= 12
            # Starting again keeps the code a phone has already scanned.
            again = await (await client.post("/api/transfer/start", json={}, headers=LOCAL)).json()
            assert again["url"] == url
            origin = url.split("/", 3)
            origin = f"{origin[0]}//{origin[2]}"

            for path in ("/", "/photos", "/wrong-code/", "/wrong-code/photos", "/api/state"):
                assert (await phone.get(origin + path)).status == 404

            page = await phone.get(url)
            assert page.status == 200 and "Muse Cam photos" in await page.text()
            assert page.headers["Referrer-Policy"] == "no-referrer"
            assert "default-src 'none'" in page.headers["Content-Security-Policy"]
            assert (await (await client.get("/api/transfer")).json())["visits"] == 1

            listed = await (await phone.get(url + "photos")).json()
            assert listed["total"]["photos"] == 1 and listed["total"]["images"] == 2
            assert listed["nextOffset"] is None
            (item,) = listed["items"]
            assert [image["name"] for image in item["images"]] == ["Edited", "Original"]
            assert item["images"][0]["base"] == f"image/version/{version_id}"
            assert item["images"][1]["base"] == f"image/original/{photo_id}"

            for image in item["images"]:
                thumb = await phone.get(f"{url}{image['base']}/thumb")
                assert (thumb.status, thumb.content_type) == (200, "image/jpeg")
                with Image.open(BytesIO(await thumb.read())) as small:
                    assert max(small.size) <= 480
                full = await phone.get(f"{url}{image['base']}/full")
                assert full.status == 200 and "Content-Disposition" not in full.headers
                saved = await phone.get(f"{url}{image['base']}/save")
                name = saved.headers["Content-Disposition"]
                assert name.startswith('attachment; filename="Muse Cam 20')
                assert name.endswith(f' {image["name"]}.jpg"')
                assert await saved.read() == await full.read()
            assert (await phone.get(f"{url}image/original/nope/full")).status == 404
            assert (await phone.get(f"{url}image/original/{photo_id}/source")).status == 404

            archive = await phone.get(url + "all.zip")
            assert archive.content_type == "application/zip"
            with zipfile.ZipFile(BytesIO(await archive.read())) as files:
                assert files.testzip() is None
                names = sorted(files.namelist())
                assert len(names) == 2
                assert names[0].endswith(" Edited.jpg") and names[1].endswith(" Original.jpg")
                original = controller._store.get_photo(photo_id).source_path
                assert files.read(names[1]) == original.read_bytes()

            # The page can look and download, and nothing else.
            for method in ("post", "put", "delete"):
                response = await getattr(phone, method)(f"{url}image/original/{photo_id}/full")
                assert response.status == 405
            assert controller.state()["galleryCount"] == 1

            stopped = await client.post("/api/transfer/stop", json={}, headers=LOCAL)
            assert await stopped.json() == {"active": False}
            with pytest.raises(aiohttp.ClientConnectorError):
                await phone.get(url)
            # A new session gets a new code.
            fresh = await (await client.post("/api/transfer/start", json={}, headers=LOCAL)).json()
            assert fresh["url"] != url
        with pytest.raises(aiohttp.ClientConnectorError):
            async with aiohttp.ClientSession() as phone:
                await phone.get(fresh["url"])

    try:
        asyncio.run(exercise())
    finally:
        controller.close()


def test_photos_close_when_the_screen_stops_asking(tmp_path: Path, monkeypatch) -> None:
    controller = make_standalone(tmp_path, offline=True)
    monkeypatch.setattr(transfer, "IDLE_SECONDS", 0.05)
    real_sleep = asyncio.sleep
    monkeypatch.setattr(transfer.asyncio, "sleep", lambda _: real_sleep(0.02))

    async def exercise():
        sharing = transfer.PhotoTransfer(controller, port=0)
        started = await sharing.start()
        assert started["active"]
        for _ in range(100):
            await real_sleep(0.02)
            if sharing._runner is None:
                break
        assert sharing._runner is None and sharing._watch is None
        assert sharing.status() == {"active": False}

    try:
        asyncio.run(exercise())
    finally:
        controller.close()


def test_a_camera_without_wifi_says_so(tmp_path: Path, monkeypatch) -> None:
    controller = make_standalone(tmp_path, offline=True)
    monkeypatch.setattr(
        controller._system, "request", lambda action: {"addresses": ["fe80::1"], "ssid": None}
    )

    async def exercise():
        async with TestClient(TestServer(create_web_app(controller, transfer_port=0))) as client:
            response = await client.post("/api/transfer/start", json={}, headers=LOCAL)
            assert response.status == 400
            assert "Wi-Fi" in (await response.json())["error"]

    try:
        asyncio.run(exercise())
    finally:
        controller.close()


def test_connected_cameras_keep_their_roll_off_the_network(tmp_path: Path) -> None:
    controller = make_controller(tmp_path)

    async def exercise():
        async with TestClient(TestServer(create_web_app(controller, transfer_port=0))) as client:
            assert controller.state()["canTransfer"] is False
            response = await client.post("/api/transfer/start", json={}, headers=LOCAL)
            assert response.status == 404
            assert (await client.get("/api/transfer")).status == 404

    try:
        asyncio.run(exercise())
    finally:
        controller.close()


def test_file_names_are_readable_and_safe() -> None:
    name = transfer._file_name("2026-11-10 14:03:22", 'Golden/Hour "x"\r\n', Path("a.PNG"))
    assert name.startswith("Muse Cam 2026-11-1") and name.endswith(" GoldenHour x.png")
    assert transfer._file_name("?", "///", Path("a")) == "Muse Cam photo Photo.jpg"
