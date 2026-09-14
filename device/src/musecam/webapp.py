from __future__ import annotations

import asyncio
import json
import logging
import shutil
import subprocess
import threading
import time
import uuid
from collections import deque
from concurrent.futures import Future, ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from queue import Empty, Full, Queue
from typing import Any
from urllib.parse import urlsplit

import httpx
from aiohttp import web
from PIL import Image

from .app import (
    CAMERA_UNAVAILABLE_MESSAGE,
    FALLBACK_PRESETS,
    RETIRED_PRESETS,
    CaptureOutcome,
    api_error_code,
    friendly_generation_error,
)
from .audio import SoundPlayer
from .battery import create_battery
from .camera import Camera, FocusState, create_camera, prepare_capture
from .client import MuseCamClient
from .config import DeviceConfig, HardwareProfile
from .models import CaptureJob, Generation, Preset, ScreenState
from .store import CaptureStore
from .system import DeviceSystem

LOGGER = logging.getLogger(__name__)
STATIC_DIR = Path(__file__).with_name("static")
API_ACTIONS = {
    "previous",
    "next",
    "select",
    "capture",
    "back",
    "share",
    "remix",
    "retry",
    "power",
    "restart_camera",
    "focus",
    "focus_auto",
}
MIN_FREE_BYTES = 150 * 1024 * 1024
MAX_PENDING = 30
CAMERA_RETRY_DELAY = 3.0
MAX_CAMERA_START_ATTEMPTS = 3


def gallery_error(message: str | None) -> str | None:
    if message is None:
        return None
    return message.replace(" Tap BACK.", "").replace(
        "Tap BACK and try again.", "Use Retry or Restyle."
    )


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
    """Camera capture and cloud work have independent lifecycles; photos stay on disk."""

    def __init__(
        self,
        config: DeviceConfig,
        profile: HardwareProfile,
        *,
        simulate: bool = False,
        offline: bool = False,
    ) -> None:
        self._config, self._profile = config, profile
        self._simulate, self._offline = simulate, offline
        self._captures_dir = config.data_dir / "captures"
        self._results_dir = config.data_dir / "results"
        for directory in (self._captures_dir, self._results_dir):
            directory.mkdir(parents=True, exist_ok=True)
        self._store = CaptureStore(config.data_dir / "musecam.sqlite3")
        self._client = None if offline else MuseCamClient(config)
        self._camera: Camera = create_camera(profile, simulate=simulate)
        self._battery = create_battery(profile.battery_telemetry and not simulate)
        self._system = DeviceSystem(config.data_dir, simulate=simulate)
        self._sound = SoundPlayer(simulate=simulate, volume=int(self._store.setting("volume", 35)))
        self._sound.configure(
            self._sound.volume, bool(self._store.setting("processingSound", True))
        )
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="musecam-generate")
        self._share_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="musecam-share")
        self._actions: Queue[tuple[str, dict]] = Queue(maxsize=16)
        self._photo_operations = threading.Lock()
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
        self._focus = FocusState()
        self._camera_restart_at: float | None = 0.0
        self._camera_start_attempts = 0
        self._future: Future[CaptureOutcome] | None = None
        self._processing_id: str | None = None
        self._share_future: Future[Generation] | None = None
        self._sharing_id: str | None = None
        self._retry_after: dict[str, float] = {}
        self._last_capture_id: str | None = None
        self._last_result_id: str | None = None
        self._battery_percentage: int | None = None
        self._revision = 0
        self._session_id = uuid.uuid4().hex
        self._frame_revision = 0
        self._gallery_revision = 0
        self._preview_jpeg: bytes | None = None
        self._preview_consumers = 0
        self._last_battery_read = 0.0
        self._temperature: float | None = None
        self._preview_throttled = False
        self._last_processing_sound = 0.0
        self._notifications: deque[dict] = deque(maxlen=12)
        self._notification_id = 0
        self._maintenance = False
        self._maintenance_job: str | None = None

    def start(self) -> None:
        self._load_presets()
        self._thread = threading.Thread(target=self._run, name="musecam-camera", daemon=True)
        self._thread.start()
        self._buttons = HardwareButtons(self._profile, self.dispatch, simulate=self._simulate)

    def _load_presets(self) -> None:
        presets = []
        if self._client is not None:
            try:
                presets = self._client.presets()
                self._store.save_presets(presets)
                self._network_online = True
            except (httpx.HTTPError, ValueError, KeyError):
                LOGGER.warning("Unable to refresh presets; using cache")
                self._network_online = False
        loaded = presets or self._store.load_presets() or FALLBACK_PRESETS
        self._presets = [p for p in loaded if p.id not in RETIRED_PRESETS] or FALLBACK_PRESETS
        selected = self._store.setting("presetId")
        if selected in {"elven-dawn", "frost-and-crown"}:
            selected = "age-of-legends"
        elif selected in {
            "disc-2-smooth",
            "disc-2-wide",
            "disc-2-smooth-wide",
            "disc-2-1996",
            "disc-2-reference",
        }:
            selected = "memory-card"
        self._preset_index = next((i for i, p in enumerate(self._presets) if p.id == selected), 0)

    def dispatch(self, action: str, values: dict | None = None) -> None:
        if action not in API_ACTIONS:
            raise ValueError("Unsupported camera action")
        values = values or {}
        if action == "focus" and (
            set(values) != {"x", "y"}
            or any(
                isinstance(values[key], bool)
                or not isinstance(values[key], (int, float))
                or not 0 <= values[key] <= 1
                for key in ("x", "y")
            )
        ):
            raise ValueError("Choose a focus point inside the preview")
        if action == "focus_auto" and values:
            raise ValueError("Auto area does not take a focus point")
        if action == "select" and values.get("presetId") not in {p.id for p in self._presets}:
            raise ValueError("Choose an available style")
        if action in {"remix", "retry", "share"}:
            if self._store.get(str(values.get("captureId", self._last_result_id))) is None:
                raise ValueError("Photo was not found")
        with self._state_changed:
            if self._maintenance:
                raise ValueError("An update is in progress")
            if action in {"focus", "focus_auto"} and (
                not self._camera_available or not self._focus.supported
            ):
                raise ValueError("Tap to focus is unavailable on this camera")
            try:
                self._actions.put_nowait((action, values))
            except Full as error:
                raise ValueError("Camera is busy. Try again in a moment.") from error

    def _run(self) -> None:
        try:
            next_frame = 0.0
            while not self._stop.is_set():
                if (
                    not self._camera_available
                    and self._camera_restart_at is not None
                    and time.monotonic() >= self._camera_restart_at
                ):
                    self._start_camera()
                # Serialize deletion with capture, restyling, and worker handoffs.
                with self._photo_operations:
                    self._poll_actions()
                    self._poll_future()
                    self._poll_share()
                    self._start_pending()
                self._refresh_battery()
                now = time.monotonic()
                if self._future is not None and now - self._last_processing_sound > 7:
                    self._sound.play("processing")
                    self._last_processing_sound = now
                if (
                    self._camera_available
                    and (self._preview_consumers or self._focus.status == "scanning")
                    and now >= next_frame
                ):
                    self._refresh_preview()
                    fps = (
                        min(5, self._profile.preview_fps)
                        if self._preview_throttled
                        else self._profile.preview_fps
                    )
                    # Include capture/encode time in the frame budget. Sleeping a
                    # whole interval afterwards halved the Pi's delivered FPS.
                    next_frame = now + 1 / fps
                wait = 0.015
                if self._camera_available and (
                    self._preview_consumers or self._focus.status == "scanning"
                ):
                    wait = min(wait, max(0.0, next_frame - time.monotonic()))
                self._stop.wait(wait)
        except Exception:
            LOGGER.exception("Camera runtime failed")
            with self._state_changed:
                self._camera_available = False
                self._focus = FocusState()
                self._status, self._message = ScreenState.ERROR, CAMERA_UNAVAILABLE_MESSAGE
                self._publish_locked()
        finally:
            self._camera.close()

    def _start_camera(self) -> None:
        self._camera_start_attempts += 1
        with self._state_changed:
            self._status, self._message = ScreenState.STARTING, "Connecting to camera"
            self._publish_locked()
        try:
            self._camera.start()
            # Do not advertise Ready until the sensor has delivered a real frame.
            self._camera.preview()
        except Exception:
            LOGGER.exception("Camera startup failed")
            self._camera_failed()
            return
        self._camera_start_attempts = 0
        self._camera_restart_at = None
        with self._state_changed:
            self._camera_available = True
            self._focus = self._camera.focus
            self._status, self._message = ScreenState.LIVE, ""
            self._publish_locked()

    def _camera_failed(self) -> None:
        retry = self._camera_start_attempts < MAX_CAMERA_START_ATTEMPTS
        with self._state_changed:
            self._camera_available = False
            self._focus = FocusState()
            self._status = ScreenState.ERROR
            self._message = (
                "Camera interrupted. Reconnecting shortly."
                if retry
                else "Camera could not start. Try Restart camera."
            )
            self._publish_locked()
        with self._frame_changed:
            self._preview_jpeg = None
            self._frame_revision += 1
            self._frame_changed.notify_all()
        try:
            self._camera.close()
        except Exception:
            LOGGER.exception("Camera cleanup failed")
        self._camera_restart_at = time.monotonic() + CAMERA_RETRY_DELAY if retry else None

    def _poll_actions(self) -> None:
        # One capture per loop keeps completions and state updates responsive.
        try:
            action, values = self._actions.get_nowait()
        except Empty:
            return
        try:
            self._handle_action(action, values)
        except Exception as error:
            LOGGER.warning("Camera action failed: %s", action, exc_info=True)
            message = (
                "Camera interrupted. Please try again when it is ready."
                if action == "capture" and not self._camera_available
                else str(error)[:160]
            )
            self._notify("error", "Couldn’t do that", message)
            self._sound.play("error")
            with self._state_changed:
                self._status = ScreenState.LIVE if self._camera_available else ScreenState.ERROR
                if self._camera_available:
                    self._message = ""
                self._publish_locked()

    def _handle_action(self, action: str, values: dict) -> None:
        if action == "power":
            self._power_off()
        elif action == "back":
            pass  # The browser owns navigation; background work keeps running.
        elif action == "restart_camera":
            if not self._camera_available:
                self._camera_start_attempts = 0
                self._camera_restart_at = 0.0
        elif action in {"focus", "focus_auto"}:
            if not self._camera_available:
                raise ValueError("Wait for the camera before focusing")
            point = (float(values["x"]), float(values["y"])) if action == "focus" else None
            self._camera.focus_at(point)
            self._refresh_focus()
        elif action in {"previous", "next", "select"}:
            with self._state_changed:
                if action == "select":
                    self._preset_index = next(
                        i for i, p in enumerate(self._presets) if p.id == values["presetId"]
                    )
                else:
                    self._preset_index = (
                        self._preset_index + (-1 if action == "previous" else 1)
                    ) % len(self._presets)
                self._store.set_setting("presetId", self._presets[self._preset_index].id)
                self._publish_locked()
        elif action == "capture":
            self._capture()
        elif action in {"retry", "remix"}:
            self._remix(values, retry=action == "retry")
        elif action == "share":
            self._share(str(values.get("captureId", self._last_result_id)))

    def _can_save(self) -> None:
        counts = self._store.counts()
        if counts.get("queued", 0) + counts.get("uploading", 0) >= MAX_PENDING:
            raise ValueError("30 photos are waiting. Let a few finish before taking more.")
        if self._system.storage()["free"] < MIN_FREE_BYTES:
            raise ValueError("Storage is nearly full. Free space before taking more photos.")

    def _new_source(self) -> tuple[str, Path]:
        capture_id = f"pi_{int(time.time())}_{uuid.uuid4().hex[:12]}"
        return capture_id, self._captures_dir / f"{capture_id}.jpg"

    def _capture(self) -> None:
        if not self._camera_available:
            raise ValueError(CAMERA_UNAVAILABLE_MESSAGE)
        self._can_save()
        preset = self._presets[self._preset_index]
        capture_id, source_path = self._new_source()
        with self._state_changed:
            self._status, self._message = ScreenState.CAPTURING, "Hold steady"
            self._publish_locked()
        self._sound.play("shutter")
        try:
            try:
                self._camera.capture(source_path)
                self._refresh_focus()
            except Exception:
                self._camera_failed()
                raise
            prepare_capture(source_path)
            self._store.enqueue(capture_id, preset.id, source_path)
        except Exception:
            source_path.unlink(missing_ok=True)
            raise
        with self._state_changed:
            self._last_capture_id = capture_id
            self._gallery_revision += 1
            self._status, self._message = ScreenState.LIVE, ""
            self._publish_locked()
        self._notify("queued", "Photo saved", f"{preset.name} · keep shooting", capture_id)

    def _remix(self, values: dict, *, retry: bool) -> None:
        self._can_save()
        original = self._store.get(values["captureId"])
        if original is None or not original.source_path.is_file():
            raise ValueError("The original photo is unavailable")
        if retry and original.status != "failed":
            raise ValueError("This photo is already complete or waiting to process")
        preset_id = original.preset_id if retry else values.get("presetId")
        if preset_id not in {p.id for p in self._presets} and not (
            retry and preset_id in RETIRED_PRESETS
        ):
            raise ValueError("Choose an available style")
        capture_id, source_path = self._new_source()
        # Each treatment owns its original, so future cleanup cannot break siblings.
        shutil.copyfile(original.source_path, source_path)
        try:
            self._store.enqueue(capture_id, preset_id, source_path)
        except Exception:
            source_path.unlink(missing_ok=True)
            raise
        with self._state_changed:
            self._gallery_revision += 1
            self._publish_locked()
        self._notify("queued", "New treatment queued", "Your original photo is kept", capture_id)

    def _start_pending(self) -> None:
        if self._future is not None or self._maintenance:
            return
        now = time.monotonic()
        pending = next(
            (
                job
                for job in self._store.pending(MAX_PENDING)
                if self._retry_after.get(job.capture_id, 0) <= now
            ),
            None,
        )
        if pending is None:
            return
        self._store.mark_uploading(pending.capture_id)
        with self._state_changed:
            self._processing_id = pending.capture_id
            self._future = self._executor.submit(self._process_job, pending)
            self._gallery_revision += 1
            self._last_processing_sound = now - 5  # First quiet chirp after two seconds.
            self._publish_locked()

    def _process_job(self, job: CaptureJob) -> CaptureOutcome:
        result_path = self._results_dir / f"{job.capture_id}.jpg"
        try:
            if self._client is None:
                # Simulated processing is intentionally visible for UX verification.
                self._stop.wait(1.2)
                with Image.open(job.source_path) as original:
                    from PIL import ImageEnhance, ImageOps

                    image = ImageEnhance.Color(original.convert("RGB")).enhance(0.5)
                    ImageOps.posterize(image, 4).save(result_path, "JPEG", quality=88)
                generation = Generation(
                    f"offline-{job.capture_id}",
                    job.capture_id,
                    "complete",
                    job.preset_id,
                    None,
                    None,
                    None,
                )
            else:
                generation = self._client.generate(job.source_path, job.capture_id, job.preset_id)
                if generation.status != "complete" or not generation.image_url:
                    self._store.mark_failed(
                        job.capture_id,
                        gallery_error(friendly_generation_error(generation.error_code)),
                    )
                    return CaptureOutcome(self._store.get(job.capture_id) or job, generation)
                temporary = result_path.with_suffix(".download")
                self._client.download_result(generation.image_url, temporary)
                with Image.open(temporary) as image:
                    image.verify()
                temporary.replace(result_path)
            self._store.mark_complete(
                job.capture_id, generation.id, result_path, generation.share_url
            )
            return CaptureOutcome(self._store.get(job.capture_id) or job, generation)
        except httpx.TransportError:
            self._store.mark_queued(
                job.capture_id, "Connection interrupted. Saved for automatic retry."
            )
            return CaptureOutcome(self._store.get(job.capture_id) or job, None, queued=True)
        except httpx.HTTPStatusError as error:
            if error.response.status_code in {408, 429, 502, 503, 504}:
                self._store.mark_queued(job.capture_id, "Service busy. Saved for automatic retry.")
                return CaptureOutcome(self._store.get(job.capture_id) or job, None, queued=True)
            self._store.mark_failed(
                job.capture_id,
                gallery_error(friendly_generation_error(api_error_code(error))),
            )
        except (OSError, ValueError):
            self._store.mark_failed(
                job.capture_id, "Couldn’t finish this photo. Your original is saved."
            )
        return CaptureOutcome(self._store.get(job.capture_id) or job, None)

    def _poll_future(self) -> None:
        if self._future is None or not self._future.done():
            return
        future, capture_id = self._future, self._processing_id
        self._future, self._processing_id = None, None
        try:
            result = future.result()
        except Exception:
            LOGGER.exception("Generation worker failed")
            if capture_id:
                self._store.mark_failed(capture_id, "Processing stopped. Your original is saved.")
            self._notify("error", "Photo needs attention", "Open Gallery to try again", capture_id)
            self._sound.play("error")
        else:
            job = result.job
            if job.status == "complete":
                self._last_result_id = job.capture_id
                self._network_online = not self._offline
                self._retry_after.pop(job.capture_id, None)
                self._sound.play("success")
                self._notify(
                    "success",
                    "Your photo is ready",
                    self._preset_name(job.preset_id),
                    job.capture_id,
                )
            elif result.queued:
                self._network_online = False
                self._retry_after[job.capture_id] = time.monotonic() + min(
                    120, 15 * 2 ** min(job.attempts, 3)
                )
                if job.attempts <= 1:
                    self._notify(
                        "waiting",
                        "Saved for later",
                        job.error or "Waiting for connection",
                        job.capture_id,
                    )
            else:
                self._sound.play("error")
                self._notify(
                    "error",
                    "Photo needs attention",
                    job.error or "Try another style in Gallery",
                    job.capture_id,
                )
        with self._state_changed:
            self._gallery_revision += 1
            self._publish_locked()

    def _share(self, capture_id: str) -> None:
        job = self._store.get(capture_id)
        if job is None or job.status != "complete" or not job.generation_id:
            raise ValueError("This photo isn’t ready to share")
        if job.share_url:
            return
        if self._client is None or job.generation_id.startswith("offline-"):
            raise ValueError("Sharing is unavailable in the simulator")
        if self._share_future is not None:
            raise ValueError("Another photo is being shared")
        with self._state_changed:
            self._sharing_id = job.capture_id
            self._share_future = self._share_executor.submit(self._client.share, job.generation_id)
            self._publish_locked()

    def _poll_share(self) -> None:
        if self._share_future is None or not self._share_future.done():
            return
        future, capture_id = self._share_future, self._sharing_id
        self._share_future, self._sharing_id = None, None
        try:
            generation = future.result()
            if not generation.share_url or not capture_id:
                raise ValueError("No share link returned")
            self._store.mark_shared(capture_id, generation.share_url)
            self._notify(
                "success", "Shared to the public roll", "Your creation is now public", capture_id
            )
        except Exception:
            self._notify(
                "error", "Couldn’t share", "Your photo is safe. Try again later.", capture_id
            )
        with self._state_changed:
            self._gallery_revision += 1
            self._publish_locked()

    def _refresh_preview(self) -> None:
        try:
            # The camera already has a JPEG encoder for its YUV stream. Keep
            # those bytes instead of decoding and encoding the entire frame again.
            jpeg = self._camera.preview_jpeg()
            self._refresh_focus()
            with self._frame_changed:
                self._preview_jpeg = jpeg
                self._frame_revision += 1
                self._frame_changed.notify_all()
        except Exception:
            LOGGER.warning("Preview frame unavailable", exc_info=True)
            self._camera_failed()

    def _refresh_focus(self) -> None:
        with self._state_changed:
            if self._focus != self._camera.focus:
                self._focus = self._camera.focus
                self._publish_locked()

    def _refresh_battery(self) -> None:
        now = time.monotonic()
        if now - self._last_battery_read < 5:
            return
        self._last_battery_read = now
        self._temperature = self._system.temperature()
        if self._temperature is not None:
            if self._temperature >= 75:
                self._preview_throttled = True
            elif self._temperature <= 68:
                self._preview_throttled = False
        percentage = self._battery.percentage()
        if percentage != self._battery_percentage:
            with self._state_changed:
                self._battery_percentage = percentage
                self._publish_locked()

    def _power_off(self) -> None:
        if self._store.counts().get("uploading", 0) or self._future or self._share_future:
            raise ValueError("Wait for processing to finish before shutting down")
        with self._state_changed:
            self._status = ScreenState.SHUTTING_DOWN
            self._message = "Safe to unplug when the screen turns off"
            self._publish_locked()
        if not self._simulate:
            subprocess.run(["sudo", "-n", "/usr/bin/systemctl", "poweroff"], check=True, timeout=10)

    def _notify(self, kind: str, title: str, message: str, capture_id: str | None = None) -> None:
        with self._state_changed:
            self._notification_id += 1
            self._notifications.append(
                {
                    "id": self._notification_id,
                    "kind": kind,
                    "title": title,
                    "message": message,
                    "captureId": capture_id,
                }
            )
            self._publish_locked()

    def _preset_name(self, preset_id: str) -> str:
        retired = RETIRED_PRESETS.get(preset_id)
        return next(
            (p.name for p in self._presets if p.id == preset_id),
            retired.name if retired else preset_id,
        )

    def _publish_locked(self) -> None:
        self._revision += 1
        self._state_changed.notify_all()

    def state(self) -> dict[str, Any]:
        with self._state_changed:
            preset = self._presets[self._preset_index]
            counts = self._store.counts()
            return {
                "status": self._status.value.replace("-", "_"),
                "preset": self._preset_json(preset),
                "presets": [self._preset_json(p) for p in self._presets],
                "presetIndex": self._preset_index,
                "presetCount": len(self._presets),
                "message": self._message,
                "networkOnline": self._network_online,
                "queued": counts.get("queued", 0),
                "processingId": self._processing_id,
                "sharingId": self._sharing_id,
                "battery": self._battery_percentage,
                "focus": self._focus.to_dict(),
                "previewSize": {
                    "width": self._profile.display_width,
                    "height": self._profile.display_height,
                },
                "galleryRevision": self._gallery_revision,
                "galleryCount": sum(counts.values()),
                "notifications": list(self._notifications),
                "lastCaptureId": self._last_capture_id,
                "volume": self._sound.volume,
                "processingSound": self._sound.processing_enabled,
                "maintenance": self._maintenance,
                "simulate": self._simulate,
                "revision": self._revision,
                "sessionId": self._session_id,
            }

    @staticmethod
    def _preset_json(preset: Preset) -> dict:
        return {
            "id": preset.id,
            "name": preset.name,
            "description": preset.description,
            "accent": preset.accent,
        }

    def gallery_item(self, job: CaptureJob) -> dict:
        thumbnail_kind = "result" if job.result_path else "source"
        return {
            "id": job.capture_id,
            "presetId": job.preset_id,
            "presetName": self._preset_name(job.preset_id),
            "status": job.status,
            "error": gallery_error(job.error),
            "shareUrl": job.share_url,
            "createdAt": job.created_at.replace(" ", "T") + "Z",
            "attempts": job.attempts,
            "sourceUrl": f"/api/gallery/{job.capture_id}/source",
            "resultUrl": f"/api/gallery/{job.capture_id}/result" if job.result_path else None,
            "thumbnailUrl": f"/api/gallery/{job.capture_id}/thumbnail?kind={thumbnail_kind}",
        }

    def gallery(self, offset: int = 0, status: str = "all") -> dict:
        jobs = self._store.gallery(limit=40, offset=offset, status=status)
        return {
            "items": [self.gallery_item(job) for job in jobs],
            "counts": self._store.counts(),
            "nextOffset": offset + 40 if len(jobs) == 40 else None,
        }

    def delete_photo(self, capture_id: str) -> None:
        with self._photo_operations, self._state_changed:
            if self._maintenance or self._stop.is_set():
                raise ValueError("Camera is restarting or updating. Try again shortly.")
            job = self._store.get(capture_id)
            if job is None:
                raise ValueError("Photo was not found")
            if job.status == "uploading" or capture_id in {
                self._processing_id,
                self._sharing_id,
            }:
                raise ValueError(
                    "Wait for this photo to finish processing or sharing before deleting."
                )
            # Validate every path before removing anything. Each restyle owns its
            # own original, so removing one entry cannot break its other versions.
            paths = [(job.source_path, self._captures_dir)]
            if job.result_path is not None:
                paths.append((job.result_path, self._results_dir))
            else:
                paths.append((self._results_dir / f"{capture_id}.jpg", self._results_dir))
            paths.append((self._results_dir / f"{capture_id}.download", self._results_dir))
            for path, directory in paths:
                if path.is_symlink() or path.resolve().parent != directory.resolve():
                    raise ValueError("Photo files are outside the camera gallery")
            try:
                for path, _ in paths:
                    if not self._store.referenced_elsewhere(path, capture_id):
                        path.unlink(missing_ok=True)
            except OSError as error:
                raise ValueError("Could not remove the photo files. Please try again.") from error
            self._store.delete(capture_id)
            self._retry_after.pop(capture_id, None)
            self._notifications = deque(
                (notice for notice in self._notifications if notice["captureId"] != capture_id),
                maxlen=12,
            )
            if self._last_capture_id == capture_id:
                self._last_capture_id = None
            if self._last_result_id == capture_id:
                self._last_result_id = None
            self._gallery_revision += 1
            self._notify("deleted", "Photo deleted", "Removed from this camera")

    def media_path(self, capture_id: str, kind: str) -> Path:
        job = self._store.get(capture_id)
        if job is None or kind not in {"source", "result"}:
            raise ValueError("Photo unavailable")
        path = job.source_path if kind == "source" else job.result_path
        if (
            path is None
            or not path.is_file()
            or not path.resolve().is_relative_to(self._config.data_dir.resolve())
        ):
            raise ValueError("Photo unavailable")
        return path

    def settings(self) -> dict:
        try:
            device = self._system.request("status")
        except ValueError as error:
            device = {
                "error": str(error),
                "addresses": [],
                "ssid": "Unavailable",
                "job": {"phase": "idle"},
            }
        with self._state_changed:
            job = device.get("job", {})
            if (
                self._maintenance_job
                and job.get("id") == self._maintenance_job
                and job.get("phase") in {"complete", "failed"}
            ):
                self._maintenance = False
                self._maintenance_job = None
                self._publish_locked()
        return {
            "volume": self._sound.volume,
            "processingSound": self._sound.processing_enabled,
            "audioAvailable": self._sound.available,
            "audioError": self._sound.error,
            "storage": self._system.storage(),
            "counts": self._store.counts(),
            "device": device,
            "temperature": self._temperature,
            "previewThrottled": self._preview_throttled,
            "battery": {
                "percentage": self._battery_percentage,
                "supported": self._profile.battery_telemetry,
                "message": "Battery sensor unavailable"
                if self._profile.battery_telemetry
                else "PiSugar S Plus does not report battery level. Check the power board LEDs.",
            },
        }

    def save_settings(self, values: dict) -> dict:
        volume = values.get("volume", self._sound.volume)
        processing = values.get("processingSound", self._sound.processing_enabled)
        if type(volume) is not int or not 0 <= volume <= 100 or type(processing) is not bool:
            raise ValueError("Invalid sound settings")
        self._store.set_setting("volume", volume)
        self._store.set_setting("processingSound", processing)
        self._sound.configure(volume, processing)
        with self._state_changed:
            self._publish_locked()
        return {"volume": volume, "processingSound": processing}

    def update(self) -> dict:
        with self._state_changed:
            counts = self._store.counts()
            if (
                self._maintenance
                or self._future
                or self._share_future
                or not self._actions.empty()
                or counts.get("queued", 0)
                or counts.get("uploading", 0)
                or self._status == ScreenState.CAPTURING
            ):
                raise ValueError("Let all queued photos finish before updating")
            self._maintenance = True
            self._publish_locked()
        try:
            result = self._system.request("update-apply")
            with self._state_changed:
                self._maintenance_job = result.get("id")
                if result.get("phase") in {"complete", "failed"}:
                    self._maintenance = False
                    self._maintenance_job = None
                    self._publish_locked()
            return result
        except Exception:
            with self._state_changed:
                self._maintenance = False
                self._publish_locked()
            raise

    def wait_for_state(self, revision: int, timeout: float = 15) -> dict:
        with self._state_changed:
            self._state_changed.wait_for(
                lambda: self._revision > revision or self._stop.is_set(), timeout
            )
        return self.state()

    def wait_for_frame(self, revision: int, timeout: float = 2) -> tuple[int, bytes | None]:
        with self._frame_changed:
            self._frame_changed.wait_for(
                lambda: self._frame_revision > revision or self._stop.is_set(), timeout
            )
            return self._frame_revision, self._preview_jpeg

    def close(self) -> None:
        self._stop.set()
        if self._buttons is not None:
            self._buttons.close()
        if self._thread is not None:
            self._thread.join(timeout=10)
        self._executor.shutdown(wait=True, cancel_futures=True)
        self._share_executor.shutdown(wait=True, cancel_futures=True)
        self._sound.close()
        if self._client is not None:
            self._client.close()
        self._store.close()


@web.middleware
async def local_requests(request: web.Request, handler: Any) -> web.StreamResponse:
    # Privileged settings and private photos stay local, including against DNS rebinding.
    if urlsplit(f"http://{request.host}").hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise web.HTTPForbidden(text="Local camera access only")
    if request.method not in {"GET", "HEAD"}:
        origin = request.headers.get("Origin")
        if origin and origin != f"{request.scheme}://{request.host}":
            raise web.HTTPForbidden(text="Local camera access only")
        if request.headers.get("X-MuseCam-Request") != "1":
            raise web.HTTPForbidden(text="Camera request header required")
    try:
        return await handler(request)
    except ValueError as error:
        return web.json_response({"error": str(error)}, status=400)


async def _state(request: web.Request) -> web.Response:
    return web.json_response(
        request.app["controller"].state(), headers={"Cache-Control": "no-store"}
    )


async def _events(request: web.Request) -> web.StreamResponse:
    controller = request.app["controller"]
    response = web.StreamResponse(
        headers={"Content-Type": "text/event-stream", "Cache-Control": "no-store"}
    )
    await response.prepare(request)
    revision = -1
    try:
        while not controller._stop.is_set():
            state = await asyncio.to_thread(controller.wait_for_state, revision)
            revision = state["revision"]
            await response.write(f"data: {json.dumps(state, separators=(',', ':'))}\n\n".encode())
    except (ConnectionResetError, asyncio.CancelledError):
        pass
    return response


async def _action(request: web.Request) -> web.Response:
    values = await request.json()
    if not isinstance(values, dict):
        raise ValueError("Invalid action")
    request.app["controller"].dispatch(request.match_info["action"], values)
    return web.json_response({"accepted": True}, status=202)


async def _preview(request: web.Request) -> web.StreamResponse:
    controller = request.app["controller"]
    response = web.StreamResponse(
        headers={
            "Content-Type": "multipart/x-mixed-replace; boundary=frame",
            "Cache-Control": "no-store",
        }
    )
    await response.prepare(request)
    controller._preview_consumers += 1
    revision = -1
    try:
        while not controller._stop.is_set():
            revision, frame = await asyncio.to_thread(controller.wait_for_frame, revision)
            if frame is not None:
                await response.write(
                    b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                    + str(len(frame)).encode()
                    + b"\r\n\r\n"
                    + frame
                    + b"\r\n"
                )
    except (ConnectionResetError, asyncio.CancelledError):
        pass
    finally:
        controller._preview_consumers -= 1
    return response


async def _gallery(request: web.Request) -> web.Response:
    offset = max(0, int(request.query.get("offset", "0")))
    return web.json_response(
        request.app["controller"].gallery(offset, request.query.get("filter", "all")),
        headers={"Cache-Control": "no-store"},
    )


async def _gallery_detail(request: web.Request) -> web.Response:
    controller = request.app["controller"]
    job = controller._store.get(request.match_info["capture_id"])
    if job is None:
        raise web.HTTPNotFound()
    return web.json_response(controller.gallery_item(job), headers={"Cache-Control": "no-store"})


async def _gallery_delete(request: web.Request) -> web.Response:
    await asyncio.to_thread(
        request.app["controller"].delete_photo, request.match_info["capture_id"]
    )
    return web.json_response({"deleted": True})


async def _media(request: web.Request) -> web.StreamResponse:
    controller = request.app["controller"]
    capture_id, kind = request.match_info["capture_id"], request.match_info["kind"]
    if kind == "thumbnail":
        path = controller.media_path(capture_id, request.query.get("kind", "source"))

        def thumbnail() -> bytes:
            with Image.open(path) as original:
                image = original.convert("RGB")
                image.thumbnail((240, 180))
                output = BytesIO()
                image.save(output, "JPEG", quality=72)
                return output.getvalue()

        return web.Response(
            body=await asyncio.to_thread(thumbnail),
            content_type="image/jpeg",
            headers={"Cache-Control": "private, max-age=86400"},
        )
    return web.FileResponse(
        controller.media_path(capture_id, kind), headers={"Cache-Control": "private, max-age=86400"}
    )


async def _settings(request: web.Request) -> web.Response:
    controller = request.app["controller"]
    if request.method == "POST":
        values = await request.json()
        if not isinstance(values, dict) or values.keys() - {"volume", "processingSound"}:
            raise ValueError("Invalid sound settings")
        result = controller.save_settings(values)
    else:
        result = await asyncio.to_thread(controller.settings)
    return web.json_response(result, headers={"Cache-Control": "no-store"})


async def _sound(request: web.Request) -> web.Response:
    controller = request.app["controller"]
    values = await request.json()
    if not isinstance(values, dict) or values.keys() - {"cue"}:
        raise ValueError("Invalid sound request")
    cue = values.get("cue", "shutter")
    if not isinstance(cue, str):
        raise ValueError("Invalid sound request")
    if not controller._sound.available and not controller._simulate:
        raise ValueError("Speaker unavailable. Check the audio setup.")
    controller._sound.play(cue)
    return web.json_response({"accepted": True})


async def _system(request: web.Request) -> web.Response:
    controller = request.app["controller"]
    action = request.match_info["action"]
    if action not in {"wifi-scan", "wifi-connect", "update-check", "update-apply"}:
        raise web.HTTPNotFound()
    values = await request.json()
    allowed = {"ssid", "password", "hidden"} if action == "wifi-connect" else set()
    if not isinstance(values, dict) or values.keys() - allowed:
        raise ValueError("Invalid settings request")
    if action == "update-apply":
        result = await asyncio.to_thread(controller.update)
    else:
        result = await asyncio.to_thread(controller._system.request, action, **values)
    return web.json_response(result, headers={"Cache-Control": "no-store"})


async def _index(_: web.Request) -> web.StreamResponse:
    if not (STATIC_DIR / "index.html").is_file():
        raise web.HTTPServiceUnavailable(text="Camera UI has not been built")
    return web.FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})


def create_web_app(controller: CameraWebController) -> web.Application:
    app = web.Application(middlewares=[local_requests], client_max_size=8192)
    app["controller"] = controller

    async def stop_streams(_: web.Application) -> None:
        # End persistent SSE/MJPEG responses before aiohttp waits for connections.
        # Otherwise systemd's stop timeout can kill a healthy camera during updates.
        controller._stop.set()
        with controller._state_changed:
            controller._state_changed.notify_all()
        with controller._frame_changed:
            controller._frame_changed.notify_all()

    app.on_shutdown.append(stop_streams)
    app.router.add_get("/", _index)
    app.router.add_get("/api/state", _state)
    app.router.add_get("/api/events", _events)
    app.router.add_post("/api/actions/{action}", _action)
    app.router.add_get("/preview.mjpg", _preview)
    app.router.add_get("/api/gallery", _gallery)
    app.router.add_get("/api/gallery/{capture_id}", _gallery_detail)
    app.router.add_post("/api/gallery/{capture_id}/delete", _gallery_delete)
    app.router.add_get("/api/gallery/{capture_id}/{kind}", _media)
    app.router.add_get("/api/settings", _settings)
    app.router.add_post("/api/settings", _settings)
    app.router.add_post("/api/sound", _sound)
    app.router.add_post("/api/system/{action}", _system)
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
    controller = CameraWebController(config, profile, simulate=simulate, offline=offline)
    controller.start()
    try:
        web.run_app(create_web_app(controller), host=host, port=port, print=None)
    finally:
        controller.close()
