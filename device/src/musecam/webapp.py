from __future__ import annotations

import asyncio
import json
import logging
import shutil
import subprocess
import threading
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from queue import Empty, Full, Queue
from typing import Any

import httpx
from aiohttp import web

from .app import (
    CAMERA_UNAVAILABLE_MESSAGE,
    FALLBACK_PRESETS,
    CaptureOutcome,
    api_error_code,
    friendly_generation_error,
)
from .battery import create_battery
from .camera import Camera, create_camera, prepare_capture
from .client import MuseCamClient
from .config import DeviceConfig, HardwareProfile
from .models import CaptureJob, Generation, Preset, ScreenState
from .store import CaptureStore

LOGGER = logging.getLogger(__name__)
STATIC_DIR = Path(__file__).with_name("static")
API_ACTIONS = {"previous", "next", "capture", "back", "share", "power"}


class HardwareButtons:
    """Optional GPIO buttons for the browser runtime; touch remains in Chromium."""

    def __init__(self, profile: HardwareProfile, emit: Any, *, simulate: bool) -> None:
        self._buttons: list[Any] = []
        if simulate:
            return
        try:
            from gpiozero import Button
        except ImportError:
            LOGGER.warning("gpiozero is unavailable; physical buttons are disabled")
            return

        if profile.shutter_gpio is not None:
            shutter = Button(profile.shutter_gpio, pull_up=True, bounce_time=0.05)
            shutter.when_pressed = lambda: emit("capture")
            self._buttons.append(shutter)
        if profile.power_gpio is not None:
            power = Button(
                profile.power_gpio,
                pull_up=True,
                bounce_time=0.05,
                hold_time=1.5,
            )
            power.when_held = lambda: emit("power")
            self._buttons.append(power)

    def close(self) -> None:
        for button in self._buttons:
            button.close()


class CameraWebController:
    """Own camera hardware and expose thread-safe state to the local web server."""

    def __init__(
        self,
        config: DeviceConfig,
        profile: HardwareProfile,
        *,
        simulate: bool = False,
        offline: bool = False,
    ) -> None:
        self._config = config
        self._profile = profile
        self._simulate = simulate
        self._offline = offline
        self._captures_dir = config.data_dir / "captures"
        self._results_dir = config.data_dir / "results"
        self._captures_dir.mkdir(parents=True, exist_ok=True)
        self._results_dir.mkdir(parents=True, exist_ok=True)

        self._store = CaptureStore(config.data_dir / "musecam.sqlite3")
        self._client = None if offline else MuseCamClient(config)
        self._camera: Camera = create_camera(profile, simulate=simulate)
        self._battery = create_battery(profile.battery_telemetry and not simulate)
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="musecam-network")
        self._actions: Queue[str] = Queue(maxsize=16)
        self._stop = threading.Event()
        self._state_changed = threading.Condition(threading.RLock())
        self._frame_changed = threading.Condition(threading.RLock())
        self._thread: threading.Thread | None = None
        self._buttons: HardwareButtons | None = None

        self._presets: list[Preset] = FALLBACK_PRESETS
        self._preset_index = 0
        self._status = ScreenState.STARTING
        self._message = "Starting camera"
        self._network_online = not offline
        self._camera_available = False
        self._active_job: CaptureJob | None = None
        self._future: Future[CaptureOutcome | Generation] | None = None
        self._future_kind: str | None = None
        self._battery_percentage: int | None = None
        self._revision = 0
        self._frame_revision = 0
        self._preview_jpeg: bytes | None = None
        self._last_battery_read = 0.0
        self._last_retry = 0.0

    def start(self) -> None:
        self._load_presets()
        self._thread = threading.Thread(target=self._run, name="musecam-camera", daemon=True)
        self._thread.start()
        self._buttons = HardwareButtons(self._profile, self.dispatch, simulate=self._simulate)

    def _load_presets(self) -> None:
        presets: list[Preset] = []
        if self._client is not None:
            try:
                presets = self._client.presets()
                self._store.save_presets(presets)
                self._network_online = True
            except (httpx.HTTPError, ValueError, KeyError):
                LOGGER.warning("Unable to refresh presets; using cache", exc_info=True)
                self._network_online = False
        self._presets = presets or self._store.load_presets() or FALLBACK_PRESETS

    def dispatch(self, action: str) -> None:
        if action not in API_ACTIONS:
            raise ValueError(f"Unsupported camera action: {action}")
        try:
            self._actions.put_nowait(action)
        except Full:
            LOGGER.warning("Dropping action because the camera queue is full: %s", action)

    def _run(self) -> None:
        try:
            self._camera.start()
            with self._state_changed:
                self._camera_available = True
                self._status = ScreenState.LIVE
                self._message = ""
                self._publish_locked()
            frame_interval = 1 / self._profile.preview_fps
            next_frame = 0.0

            while not self._stop.is_set():
                self._poll_actions()
                self._poll_future()
                self._retry_pending()
                self._refresh_battery()
                now = time.monotonic()
                if self._status == ScreenState.LIVE and now >= next_frame:
                    self._refresh_preview()
                    next_frame = now + frame_interval
                self._stop.wait(0.01)
        except Exception:
            LOGGER.exception("Camera runtime failed")
            with self._state_changed:
                self._camera_available = False
                self._status = ScreenState.ERROR
                self._message = CAMERA_UNAVAILABLE_MESSAGE
                self._publish_locked()
        finally:
            self._camera.close()

    def _poll_actions(self) -> None:
        while True:
            try:
                action = self._actions.get_nowait()
            except Empty:
                return
            try:
                self._handle_action(action)
            except Exception as error:
                LOGGER.exception("Camera action failed: %s", action)
                with self._state_changed:
                    self._status = ScreenState.ERROR
                    self._message = str(error)
                    self._publish_locked()

    def _handle_action(self, action: str) -> None:
        if action == "power":
            self._power_off()
            return
        if action == "back":
            self._return_to_live()
            return
        if action in {"previous", "next"} and self._status in {
            ScreenState.LIVE,
            ScreenState.RESULT,
            ScreenState.ERROR,
        }:
            delta = -1 if action == "previous" else 1
            with self._state_changed:
                self._preset_index = (self._preset_index + delta) % len(self._presets)
                self._status = ScreenState.LIVE if self._camera_available else ScreenState.ERROR
                self._message = "" if self._camera_available else CAMERA_UNAVAILABLE_MESSAGE
                self._active_job = None
                self._publish_locked()
        elif action == "capture" and self._status in {ScreenState.LIVE, ScreenState.RESULT}:
            self._capture()
        elif action == "share" and self._status == ScreenState.RESULT:
            self._share()

    def _capture(self) -> None:
        if self._future is not None:
            return
        preset = self._presets[self._preset_index]
        capture_id = f"pi_{int(time.time())}_{uuid.uuid4().hex[:8]}"
        source_path = self._captures_dir / f"{capture_id}.jpg"
        with self._state_changed:
            self._status = ScreenState.CAPTURING
            self._message = "Hold still"
            self._active_job = None
            self._publish_locked()
        try:
            self._camera.capture(source_path)
            prepare_capture(source_path)
        except Exception as error:
            LOGGER.exception("Capture failed")
            with self._state_changed:
                self._status = ScreenState.ERROR
                self._message = f"Camera error: {error}"
                self._publish_locked()
            return

        self._store.enqueue(capture_id, preset.id, source_path)
        job = self._store.get(capture_id)
        if job is None:
            raise RuntimeError("Could not save capture")
        with self._state_changed:
            self._active_job = job
            self._status = ScreenState.PROCESSING
            self._message = "Sending to Muse Image"
            self._future_kind = "generate"
            self._future = self._executor.submit(self._process_job, job)
            self._publish_locked()

    def _process_job(self, job: CaptureJob) -> CaptureOutcome:
        self._store.mark_uploading(job.capture_id)
        result_path = self._results_dir / f"{job.capture_id}.jpg"
        if self._client is None:
            shutil.copyfile(job.source_path, result_path)
            generation = Generation(
                id=f"offline-{job.capture_id}",
                capture_id=job.capture_id,
                status="complete",
                preset_id=job.preset_id,
                image_url=None,
                share_url=None,
                error_code=None,
            )
            self._store.mark_complete(job.capture_id, generation.id, result_path)
            self._prune_local_history()
            return CaptureOutcome(self._store.get(job.capture_id) or job, generation)

        try:
            generation = self._client.generate(job.source_path, job.capture_id, job.preset_id)
            if generation.status != "complete" or not generation.image_url:
                message = friendly_generation_error(generation.error_code)
                self._store.mark_failed(job.capture_id, message)
                return CaptureOutcome(self._store.get(job.capture_id) or job, generation)
            self._client.download_result(generation.image_url, result_path)
            self._store.mark_complete(
                job.capture_id, generation.id, result_path, generation.share_url
            )
            self._prune_local_history()
            return CaptureOutcome(self._store.get(job.capture_id) or job, generation)
        except httpx.TransportError as error:
            self._store.mark_queued(job.capture_id, str(error))
            return CaptureOutcome(self._store.get(job.capture_id) or job, None, queued=True)
        except httpx.HTTPStatusError as error:
            message = friendly_generation_error(api_error_code(error))
            self._store.mark_failed(job.capture_id, message)
            return CaptureOutcome(self._store.get(job.capture_id) or job, None)
        except (OSError, ValueError):
            self._store.mark_failed(job.capture_id, friendly_generation_error(None))
            return CaptureOutcome(self._store.get(job.capture_id) or job, None)

    def _poll_future(self) -> None:
        if self._future is None or not self._future.done():
            return
        future = self._future
        kind = self._future_kind
        self._future = None
        self._future_kind = None
        try:
            result = future.result()
        except Exception:
            LOGGER.exception("Background camera operation failed")
            with self._state_changed:
                if kind == "share":
                    self._status = ScreenState.RESULT
                    self._message = "Could not share. Try again when the connection returns."
                    self._network_online = False
                else:
                    self._status = ScreenState.ERROR
                    self._message = friendly_generation_error(None)
                self._publish_locked()
            return

        if kind == "share" and isinstance(result, Generation):
            if self._active_job and result.share_url:
                self._store.mark_shared(self._active_job.capture_id, result.share_url)
                self._active_job = self._store.get(self._active_job.capture_id)
            with self._state_changed:
                self._status = ScreenState.RESULT
                self._message = "Shared to the public roll"
                self._network_online = True
                self._publish_locked()
            return

        if not isinstance(result, CaptureOutcome):
            return
        with self._state_changed:
            self._active_job = result.job
            if result.job.status == "complete" and result.job.result_path:
                self._status = ScreenState.RESULT
                self._message = ""
                self._network_online = not self._offline
            elif result.queued:
                self._status = ScreenState.ERROR
                self._message = "No connection. Your photo is safe and will retry."
                self._network_online = False
            else:
                self._status = ScreenState.ERROR
                self._message = result.job.error or "Muse Image could not finish this photo."
            self._publish_locked()

    def _share(self) -> None:
        if (
            self._client is None
            or self._future is not None
            or self._active_job is None
            or self._active_job.generation_id is None
            or self._active_job.generation_id.startswith("offline-")
        ):
            with self._state_changed:
                self._message = "Sharing needs a network connection"
                self._publish_locked()
            return
        if self._active_job.share_url:
            return
        with self._state_changed:
            self._status = ScreenState.SHARING
            self._message = "Publishing your creation"
            self._future_kind = "share"
            self._future = self._executor.submit(self._client.share, self._active_job.generation_id)
            self._publish_locked()

    def _retry_pending(self) -> None:
        now = time.monotonic()
        if (
            self._offline
            or self._future is not None
            or self._status not in {ScreenState.LIVE, ScreenState.ERROR}
            or now - self._last_retry < 15
        ):
            return
        self._last_retry = now
        pending = self._store.pending(limit=1)
        if not pending:
            return
        with self._state_changed:
            self._active_job = pending[0]
            self._status = ScreenState.PROCESSING
            self._message = "Retrying saved photo"
            self._future_kind = "generate"
            self._future = self._executor.submit(self._process_job, pending[0])
            self._publish_locked()

    def _refresh_preview(self) -> None:
        try:
            frame = self._camera.preview()
            output = BytesIO()
            frame.save(output, "JPEG", quality=76)
            with self._frame_changed:
                self._preview_jpeg = output.getvalue()
                self._frame_revision += 1
                self._frame_changed.notify_all()
        except Exception as error:
            LOGGER.exception("Camera preview failed")
            with self._state_changed:
                self._status = ScreenState.ERROR
                self._message = str(error)
                self._publish_locked()

    def _refresh_battery(self) -> None:
        now = time.monotonic()
        if now - self._last_battery_read < 5:
            return
        self._last_battery_read = now
        percentage = self._battery.percentage()
        if percentage != self._battery_percentage:
            with self._state_changed:
                self._battery_percentage = percentage
                self._publish_locked()

    def _return_to_live(self) -> None:
        with self._state_changed:
            self._status = ScreenState.LIVE if self._camera_available else ScreenState.ERROR
            self._message = "" if self._camera_available else CAMERA_UNAVAILABLE_MESSAGE
            self._active_job = None
            self._publish_locked()

    def _power_off(self) -> None:
        with self._state_changed:
            self._status = ScreenState.SHUTTING_DOWN
            self._message = "Safe to unplug when the screen turns off"
            self._publish_locked()
        if self._simulate:
            return
        subprocess.run(
            ["sudo", "-n", "/usr/bin/systemctl", "poweroff"],
            check=True,
            timeout=10,
        )

    def _prune_local_history(self) -> None:
        for path in self._store.prune_finished(keep=100):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                LOGGER.warning("Could not remove old capture %s", path, exc_info=True)

    def _publish_locked(self) -> None:
        self._revision += 1
        self._state_changed.notify_all()

    def state(self) -> dict[str, Any]:
        with self._state_changed:
            preset = self._presets[self._preset_index]
            job = self._active_job
            result_url = None
            if job and job.result_path and job.result_path.is_file():
                result_url = f"/media/result.jpg?v={self._revision}"
            status = self._status.value.replace("-", "_")
            return {
                "status": status,
                "preset": {
                    "id": preset.id,
                    "name": preset.name,
                    "description": preset.description,
                    "accent": preset.accent,
                },
                "presetIndex": self._preset_index,
                "presetCount": len(self._presets),
                "message": self._message,
                "networkOnline": self._network_online,
                "queued": len(self._store.pending()),
                "battery": self._battery_percentage,
                "shared": bool(job and job.share_url),
                "shareUrl": job.share_url if job else None,
                "resultUrl": result_url,
                "revision": self._revision,
            }

    def wait_for_state(self, revision: int, timeout: float = 15) -> dict[str, Any]:
        with self._state_changed:
            self._state_changed.wait_for(lambda: self._revision > revision, timeout=timeout)
        return self.state()

    def wait_for_frame(self, revision: int, timeout: float = 2) -> tuple[int, bytes | None]:
        with self._frame_changed:
            self._frame_changed.wait_for(lambda: self._frame_revision > revision, timeout=timeout)
            return self._frame_revision, self._preview_jpeg

    def result_path(self) -> Path | None:
        with self._state_changed:
            if self._active_job and self._active_job.result_path:
                return self._active_job.result_path
        return None

    def close(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
        if self._buttons is not None:
            self._buttons.close()
        if self._future is not None:
            self._future.cancel()
        self._executor.shutdown(wait=False, cancel_futures=True)
        if self._client is not None:
            self._client.close()
        self._store.close()


async def _state(request: web.Request) -> web.Response:
    controller: CameraWebController = request.app["controller"]
    return web.json_response(controller.state(), headers={"Cache-Control": "no-store"})


async def _events(request: web.Request) -> web.StreamResponse:
    controller: CameraWebController = request.app["controller"]
    response = web.StreamResponse(
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store",
            "Connection": "keep-alive",
        }
    )
    await response.prepare(request)
    revision = -1
    try:
        while True:
            state = await asyncio.to_thread(controller.wait_for_state, revision)
            revision = state["revision"]
            payload = json.dumps(state, separators=(",", ":"))
            await response.write(f"data: {payload}\n\n".encode())
    except (ConnectionResetError, asyncio.CancelledError):
        pass
    return response


async def _action(request: web.Request) -> web.Response:
    controller: CameraWebController = request.app["controller"]
    action = request.match_info["action"]
    if action not in API_ACTIONS:
        raise web.HTTPNotFound()
    controller.dispatch(action)
    return web.json_response(controller.state(), headers={"Cache-Control": "no-store"})


async def _preview(request: web.Request) -> web.StreamResponse:
    controller: CameraWebController = request.app["controller"]
    response = web.StreamResponse(
        headers={
            "Content-Type": "multipart/x-mixed-replace; boundary=frame",
            "Cache-Control": "no-store",
        }
    )
    await response.prepare(request)
    revision = -1
    try:
        while True:
            revision, frame = await asyncio.to_thread(controller.wait_for_frame, revision)
            if frame is None:
                continue
            await response.write(
                b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                + str(len(frame)).encode()
                + b"\r\n\r\n"
                + frame
                + b"\r\n"
            )
    except (ConnectionResetError, asyncio.CancelledError):
        pass
    return response


async def _result(request: web.Request) -> web.StreamResponse:
    controller: CameraWebController = request.app["controller"]
    path = controller.result_path()
    if path is None or not path.is_file():
        raise web.HTTPNotFound()
    return web.FileResponse(path, headers={"Cache-Control": "no-store"})


async def _index(_: web.Request) -> web.StreamResponse:
    index = STATIC_DIR / "index.html"
    if not index.is_file():
        raise web.HTTPServiceUnavailable(
            text="Camera UI has not been built. Run `pnpm --dir device-ui build`."
        )
    return web.FileResponse(index, headers={"Cache-Control": "no-cache"})


def create_web_app(controller: CameraWebController) -> web.Application:
    app = web.Application()
    app["controller"] = controller
    app.router.add_get("/", _index)
    app.router.add_get("/api/state", _state)
    app.router.add_get("/api/events", _events)
    app.router.add_post("/api/actions/{action}", _action)
    app.router.add_get("/preview.mjpg", _preview)
    app.router.add_get("/media/result.jpg", _result)
    if (STATIC_DIR / "assets").is_dir():
        app.router.add_static("/assets", STATIC_DIR / "assets")
    return app


def run_web_app(
    config: DeviceConfig,
    profile: HardwareProfile,
    *,
    simulate: bool,
    offline: bool,
    host: str,
    port: int,
) -> None:
    controller = CameraWebController(
        config,
        profile,
        simulate=simulate,
        offline=offline,
    )
    controller.start()
    try:
        web.run_app(create_web_app(controller), host=host, port=port, print=None)
    finally:
        controller.close()
