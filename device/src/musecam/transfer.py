"""Photo transfer: a read-only gallery for a phone or computer on the camera's network.

The camera's own server answers only the camera itself. This one listens on the
network, only while the Get photos screen is open, and every address in it starts
with a random code that the screen shows as a QR code. It lists and downloads
photos and can change nothing.
"""

from __future__ import annotations

import asyncio
import re
import secrets
import zipfile
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from time import monotonic
from typing import Any

from aiohttp import web
from PIL import Image

PAGE = Path(__file__).with_name("transfer.html")
PAGE_SIZE = 60
# The Get photos screen asks for the status every few seconds. When it stops
# asking, because it closed or the screen reloaded, the photos close too.
IDLE_SECONDS = 30
THUMBNAIL_SIDE = 480
# The code can be typed on a computer, so it leaves out letters that look alike.
CODE_LETTERS = "abcdefghjkmnpqrstuvwxyz23456789"
CODE_LENGTH = 12
HEADERS = {
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex",
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; connect-src 'self'; "
    "style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'",
}


def _taken(created_at: str) -> str:
    """When a photo was taken, in the camera's time zone, for a file name."""
    try:
        taken = datetime.fromisoformat(created_at).replace(tzinfo=UTC).astimezone()
    except ValueError:
        return "photo"
    return taken.strftime("%Y-%m-%d %H.%M.%S")


def _file_name(created_at: str, name: str, path: Path) -> str:
    name = re.sub(r"[^A-Za-z0-9 &,.'()-]", "", name).strip() or "Photo"
    return f"Muse Cam {_taken(created_at)} {name}{path.suffix.lower() or '.jpg'}"


def _images(controller: Any, photo: Any, versions: list) -> list[dict]:
    """A photo's finished images, newest version first and the original last."""
    images = []
    for job in reversed(versions):
        if job.status == "complete" and job.result_path and job.result_path.is_file():
            images.append(
                {
                    "base": f"image/version/{job.capture_id}",
                    "name": controller._job_preset_name(job),
                    "path": job.result_path,
                }
            )
    if photo.source_path.is_file():
        images.append(
            {
                "base": f"image/original/{photo.photo_id}",
                "name": "Original",
                "path": photo.source_path,
            }
        )
    for image in images:
        image["file"] = _file_name(photo.created_at, image["name"], image["path"])
    return images


def _all_images(controller: Any) -> list[dict]:
    images, offset = [], 0
    while photos := controller._store.photos(limit=200, offset=offset):
        versions = controller._store.versions(photo.photo_id for photo in photos)
        for photo in photos:
            images.extend(_images(controller, photo, versions[photo.photo_id]))
        offset += len(photos)
    return images


def photo_list(controller: Any, offset: int) -> dict:
    photos = controller._store.photos(limit=PAGE_SIZE, offset=offset)
    versions = controller._store.versions(photo.photo_id for photo in photos)
    items = []
    for photo in photos:
        images = _images(controller, photo, versions[photo.photo_id])
        if images:
            items.append(
                {
                    "id": photo.photo_id,
                    "createdAt": controller._timestamp(photo.created_at),
                    "images": [
                        {
                            "base": image["base"],
                            "name": image["name"],
                            # An edit can replace a version's image, so the address changes.
                            "v": image["path"].stat().st_mtime_ns // 1_000_000,
                        }
                        for image in images
                    ],
                }
            )
    result: dict[str, Any] = {
        "items": items,
        "nextOffset": offset + PAGE_SIZE if len(photos) == PAGE_SIZE else None,
    }
    if offset == 0:
        everything = _all_images(controller)
        result["total"] = {
            "photos": controller._store.photo_counts()["all"],
            "images": len(everything),
            "bytes": sum(image["path"].stat().st_size for image in everything),
        }
    return result


def _thumbnail(path: Path) -> bytes:
    with Image.open(path) as original:
        image = original.convert("RGB")
        image.thumbnail((THUMBNAIL_SIDE, THUMBNAIL_SIDE))
        output = BytesIO()
        image.save(output, "JPEG", quality=78)
        return output.getvalue()


class _Chunks:
    """Collects what zipfile writes so it can be sent as it is made."""

    def __init__(self) -> None:
        self._parts: list[bytes] = []

    def write(self, data: bytes) -> int:
        self._parts.append(bytes(data))
        return len(data)

    def flush(self) -> None:
        pass

    def take(self) -> bytes:
        data = b"".join(self._parts)
        self._parts.clear()
        return data


def create_transfer_app(controller: Any, token: str, visited: Any) -> web.Application:
    app = web.Application()
    prefix = f"/{token}"

    async def add_headers(_: web.Request, response: web.StreamResponse) -> None:
        for name, value in HEADERS.items():
            response.headers.setdefault(name, value)

    app.on_response_prepare.append(add_headers)

    def image(request: web.Request) -> tuple[Path, str]:
        kind, image_id = request.match_info["kind"], request.match_info["image_id"]
        try:
            if kind == "original":
                photo = controller._store.get_photo(image_id)
                if photo is None:
                    raise ValueError("Photo unavailable")
                path = controller._media_file(photo.source_path)
                return path, _file_name(photo.created_at, "Original", path)
            job = controller._store.get(image_id)
            if job is None or job.status != "complete":
                raise ValueError("Photo unavailable")
            path = controller._media_file(job.result_path)
            photo = controller._store.get_photo(job.photo_id) if job.photo_id else None
            created = photo.created_at if photo else job.created_at
            return path, _file_name(created, controller._job_preset_name(job), path)
        except ValueError:
            raise web.HTTPNotFound() from None

    async def page(_: web.Request) -> web.StreamResponse:
        visited()
        return web.FileResponse(PAGE, headers={"Cache-Control": "no-store"})

    async def to_page(_: web.Request) -> web.StreamResponse:
        raise web.HTTPFound(f"{prefix}/")

    async def photos(request: web.Request) -> web.Response:
        try:
            offset = max(0, int(request.query.get("offset", "0")))
        except ValueError:
            raise web.HTTPBadRequest() from None
        return web.json_response(
            await asyncio.to_thread(photo_list, controller, offset),
            headers={"Cache-Control": "no-store"},
        )

    async def media(request: web.Request) -> web.StreamResponse:
        path, name = await asyncio.to_thread(image, request)
        size = request.match_info["size"]
        headers = {"Cache-Control": "private, max-age=86400"}
        if size == "thumb":
            return web.Response(
                body=await asyncio.to_thread(_thumbnail, path),
                content_type="image/jpeg",
                headers=headers,
            )
        if size == "save":
            headers["Content-Disposition"] = f'attachment; filename="{name}"'
        return web.FileResponse(path, headers=headers)

    async def everything(request: web.Request) -> web.StreamResponse:
        images = await asyncio.to_thread(_all_images, controller)
        response = web.StreamResponse(
            headers={
                "Content-Type": "application/zip",
                "Content-Disposition": 'attachment; filename="Muse Cam photos.zip"',
                "Cache-Control": "no-store",
            }
        )
        await response.prepare(request)
        chunks = _Chunks()
        used: set[str] = set()
        # Photos are already compressed, so the archive only stores them.
        with zipfile.ZipFile(chunks, "w", zipfile.ZIP_STORED) as archive:
            for item in images:
                name, count = item["file"], 1
                while name in used:
                    count += 1
                    stem, dot, suffix = item["file"].rpartition(".")
                    name = f"{stem} {count}{dot}{suffix}"
                used.add(name)
                try:
                    await asyncio.to_thread(archive.write, item["path"], name)
                except OSError:
                    # Deleted on the camera since the list was made.
                    continue
                await response.write(chunks.take())
        await response.write(chunks.take())
        await response.write_eof()
        return response

    app.router.add_get(prefix, to_page)
    app.router.add_get(f"{prefix}/", page)
    app.router.add_get(f"{prefix}/photos", photos)
    app.router.add_get(
        f"{prefix}/image/{{kind:original|version}}/{{image_id}}/{{size:thumb|full|save}}", media
    )
    app.router.add_get(f"{prefix}/all.zip", everything)
    return app


class PhotoTransfer:
    """Opens the photos to the network and closes them again."""

    def __init__(self, controller: Any, *, port: int) -> None:
        self._controller = controller
        self._port = port
        # The simulator's photos stay on the computer running it.
        self._host = "127.0.0.1" if controller._simulate else "0.0.0.0"
        self._runner: web.AppRunner | None = None
        self._watch: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        self._seen = 0.0
        self._details: dict[str, Any] = {}
        self._visits = 0

    def _network(self) -> tuple[str, str]:
        device = self._controller._system.request("status")
        for address in device.get("addresses", []):
            # hostname -I lists IPv6 too; a phone's camera opens an IPv4 address most reliably.
            if re.fullmatch(r"\d+(\.\d+){3}", address) and (
                self._controller._simulate or not address.startswith("127.")
            ):
                return address, str(device.get("ssid") or "")
        raise ValueError("Connect the camera to Wi-Fi in Settings, then try again.")

    def _visited(self) -> None:
        self._visits += 1
        self._seen = monotonic()

    def status(self) -> dict:
        """What the Get photos screen shows. Asking keeps the photos open."""
        self._seen = monotonic()
        if self._runner is None:
            return {"active": False}
        return {"active": True, **self._details, "visits": self._visits}

    async def start(self) -> dict:
        async with self._lock:
            if self._runner is None:
                address, ssid = await asyncio.to_thread(self._network)
                token = "".join(secrets.choice(CODE_LETTERS) for _ in range(CODE_LENGTH))
                runner = web.AppRunner(
                    create_transfer_app(self._controller, token, self._visited),
                    access_log=None,
                    shutdown_timeout=1,
                )
                await runner.setup()
                try:
                    await web.TCPSite(runner, self._host, self._port).start()
                except OSError as error:
                    await runner.cleanup()
                    raise ValueError(
                        "Couldn't open the photos to the network. Restart the camera."
                    ) from error
                port = runner.addresses[0][1]
                self._runner = runner
                self._visits = 0
                self._details = {"url": f"http://{address}:{port}/{token}/", "ssid": ssid}
                self._watch = asyncio.create_task(self._close_when_idle())
            return self.status()

    async def _close_when_idle(self) -> None:
        while monotonic() - self._seen < IDLE_SECONDS:
            await asyncio.sleep(2)
        self._watch = None
        await self.stop()

    async def stop(self) -> dict:
        async with self._lock:
            runner, self._runner = self._runner, None
            watch, self._watch = self._watch, None
            if watch is not None:
                watch.cancel()
            if runner is not None:
                await runner.cleanup()
            return {"active": False}
