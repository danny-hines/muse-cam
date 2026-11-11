from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import random
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
from .edits import Edit
from .edits import preview as edit_preview
from .edits import render as render_edit
from .filters import FILTER_PRESETS
from .image_model import (
    ImageModelError,
    create_image_model,
    style_prompt,
    styles_unavailable,
)
from .models import CaptureJob, Generation, Photo, Preset, ScreenState
from .store import CaptureStore
from .system import DeviceSystem
from .transfer import PhotoTransfer

LOGGER = logging.getLogger(__name__)
STATIC_DIR = Path(__file__).with_name("static")
API_ACTIONS = {
    "previous",
    "next",
    "select",
    "capture",
    "timer",
    "cancel_capture",
    "back",
    "view",
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
TIMER_OPTIONS = (0, 5, 10)
RANDOM_PRESET = Preset(
    id="random",
    version=1,
    name="Random",
    description="A surprise style for every photo",
    accent="#d6b8ff",
)
# Takes the photo with no style. Only standalone cameras offer it; event cameras
# exist to imagine every shot.
ORIGINAL_PRESET = Preset(
    id="original",
    version=1,
    name="Original",
    description="No style, just the photo",
    accent="#e9e4d6",
)
PICKER_ONLY = {RANDOM_PRESET.id, ORIGINAL_PRESET.id}


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
        # Standalone cameras call the image model themselves; there is no server to
        # share to. Offline standalone simulation uses the mock model.
        self._standalone = config.standalone
        self._client = None if offline or self._standalone else MuseCamClient(config)
        self._image_model = (
            create_image_model(config, offline=offline) if self._standalone else None
        )
        # Why no style can run, such as a missing or rejected key. The camera then
        # saves plain photos until it restarts with a working key.
        self._styles_off = styles_unavailable(config, offline=offline)
        self._announce_styles_off = False
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
        # One edit saves at a time. Rendering happens outside _photo_operations so the
        # camera loop keeps running, and _editing_id keeps that version from deletion.
        self._edit_lock = threading.Lock()
        self._editing_id: str | None = None
        self._stop = threading.Event()
        self._state_changed = threading.Condition(threading.RLock())
        self._frame_changed = threading.Condition(threading.RLock())
        self._thread: threading.Thread | None = None
        self._buttons: HardwareButtons | None = None
        self._presets: list[Preset] = [RANDOM_PRESET, *FALLBACK_PRESETS]
        self._preset_index = 0
        timer = self._store.setting("timerSeconds", 0)
        self._timer_seconds = timer if type(timer) is int and timer in TIMER_OPTIONS else 0
        self._countdown_deadline: float | None = None
        self._countdown_remaining = 0
        self._countdown_preset: Preset | None = None
        self._status = ScreenState.STARTING
        self._view: dict[str, str | None] = {
            "screen": "camera",
            "photoId": None,
            "versionId": None,
        }
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
        self._retraction_future: Future[None] | None = None
        self._retracting_id: str | None = None
        self._retraction_check_at = 0.0
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
        if self._styles_off:
            self._fail_queued(self._styles_off)
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
        if self._standalone:
            # Only the bundled styles have prompts on the camera. Ignore any server
            # list cached while the camera was connected.
            loaded = FALLBACK_PRESETS
        else:
            loaded = presets or self._store.load_presets() or FALLBACK_PRESETS
        styles = [p for p in loaded if p.id not in RETIRED_PRESETS and p.id != "random"]
        styles = styles or FALLBACK_PRESETS
        # Each tab's styles sit together, so the buttons step through one tab and
        # then the other.
        styles = sorted(styles, key=lambda p: p.category == "look")
        # A single style, such as an event's server-picked Surprise, needs no Random
        # entry, and the interface hides the picker.
        presets = styles if len(styles) == 1 else [RANDOM_PRESET, *styles]
        if self._standalone:
            # Original needs no model, so it is all that stays when styles are off.
            presets = [ORIGINAL_PRESET] if self._styles_off else [ORIGINAL_PRESET, *presets]
        self._presets = presets
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
        # With nothing saved, start on the first style rather than Original.
        default = next((i for i, p in enumerate(self._presets) if p.id != ORIGINAL_PRESET.id), 0)
        self._preset_index = next(
            (i for i, p in enumerate(self._presets) if p.id == selected), default
        )

    def dispatch(self, action: str, values: dict | None = None) -> None:
        if action not in API_ACTIONS:
            raise ValueError("Unsupported camera action")
        values = values or {}
        if action == "view":
            if values.get("screen") not in ("camera", "gallery", "photo", "settings"):
                raise ValueError("Choose an available screen")
            if values["screen"] == "photo":
                photo_id = str(values.get("photoId"))
                if self._store.get_photo(photo_id) is None:
                    raise ValueError("Photo was not found")
                version_id = values.get("versionId")
                if version_id is not None:
                    version = self._store.get(str(version_id))
                    if version is None or version.photo_id != photo_id:
                        raise ValueError("That version of the photo was not found")
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
        if action == "remix" and self._store.get_photo(str(values.get("photoId"))) is None:
            raise ValueError("Photo was not found")
        if action in {"retry", "share"}:
            if self._store.get(str(values.get("captureId", self._last_result_id))) is None:
                raise ValueError("Photo was not found")
        with self._state_changed:
            if self._maintenance and action not in {"view", "back"}:
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
                    self._poll_countdown()
                    self._poll_future()
                    self._poll_share()
                    self._sync_retractions()
                    self._start_pending()
                self._refresh_battery()
                now = time.monotonic()
                if (
                    self._future is not None
                    and self._countdown_deadline is None
                    and now - self._last_processing_sound > 7
                ):
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
            self._clear_countdown_locked()
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
            self._action_failed(action, error)

    def _action_failed(self, action: str, error: Exception) -> None:
        LOGGER.warning("Camera action failed: %s", action, exc_info=True)
        message = (
            "Camera interrupted. Please try again when it is ready."
            if action == "capture" and not self._camera_available
            else str(error)[:160]
        )
        self._notify("error", "Couldn’t do that", message)
        self._sound.play("error")
        with self._state_changed:
            self._clear_countdown_locked()
            self._status = ScreenState.LIVE if self._camera_available else ScreenState.ERROR
            if self._camera_available:
                self._message = ""
            self._publish_locked()

    def _handle_action(self, action: str, values: dict) -> None:
        if action == "power":
            self._power_off()
        elif action == "back":
            self._set_view("camera")
        elif action == "view":
            if self._countdown_deadline is not None and values["screen"] != "camera":
                return
            self._set_view(values["screen"], values.get("photoId"), values.get("versionId"))
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
                # Keep the saved style while styles are off, so it returns with the key.
                if not self._styles_off:
                    self._store.set_setting("presetId", self._presets[self._preset_index].id)
                self._publish_locked()
        elif action == "capture":
            # GPIO and keyboard shutter presses share this path. Consume the
            # first press as navigation, before starting a timer or capture.
            if self._view["screen"] != "camera":
                self._set_view("camera")
                return
            self._request_capture()
        elif action == "timer":
            if self._countdown_deadline is None:
                with self._state_changed:
                    index = TIMER_OPTIONS.index(self._timer_seconds)
                    self._timer_seconds = TIMER_OPTIONS[(index + 1) % len(TIMER_OPTIONS)]
                    self._store.set_setting("timerSeconds", self._timer_seconds)
                    self._publish_locked()
        elif action == "cancel_capture":
            with self._state_changed:
                if self._countdown_deadline is not None:
                    self._clear_countdown_locked()
                    self._status, self._message = ScreenState.LIVE, ""
                    self._publish_locked()
        elif action in {"retry", "remix"}:
            self._remix(values, retry=action == "retry")
        elif action == "share":
            self._share(str(values.get("captureId", self._last_result_id)))

    def _set_view(
        self, screen: str, photo_id: str | None = None, version_id: str | None = None
    ) -> None:
        with self._state_changed:
            on_photo = screen == "photo"
            self._view = {
                "screen": screen,
                "photoId": photo_id if on_photo else None,
                "versionId": version_id if on_photo else None,
            }
            self._publish_locked()

    def _can_save(self) -> None:
        counts = self._store.counts()
        if counts.get("queued", 0) + counts.get("uploading", 0) >= MAX_PENDING:
            raise ValueError("30 photos are waiting. Let a few finish before taking more.")
        if self._system.storage()["free"] < MIN_FREE_BYTES:
            raise ValueError("Storage is nearly full. Free space before taking more photos.")

    @staticmethod
    def _new_id() -> str:
        return f"pi_{int(time.time())}_{uuid.uuid4().hex[:12]}"

    def _new_source(self) -> tuple[str, Path]:
        capture_id = self._new_id()
        return capture_id, self._captures_dir / f"{capture_id}.jpg"

    def _resolve_preset(self, preset: Preset) -> Preset:
        if preset.id == "random":
            styles = [p for p in self._presets if p.id not in PICKER_ONLY]
            # Random is a fun style; a look is always a deliberate choice.
            return random.choice([p for p in styles if p.category == "fun"] or styles)
        return preset

    def _clear_countdown_locked(self) -> None:
        self._countdown_deadline = None
        self._countdown_remaining = 0
        self._countdown_preset = None

    def _request_capture(self) -> None:
        # Extra shutter presses must not queue another delayed shot.
        if self._countdown_deadline is not None:
            return
        if not self._camera_available or self._status != ScreenState.LIVE:
            raise ValueError("Wait for the camera before taking a photo")
        self._can_save()
        preset = self._resolve_preset(self._presets[self._preset_index])
        if not self._timer_seconds:
            self._capture(preset)
            return
        with self._state_changed:
            self._countdown_preset = preset
            self._countdown_deadline = time.monotonic() + self._timer_seconds
            self._status, self._message = ScreenState.COUNTDOWN, "Get ready"
        self._poll_countdown()

    def _poll_countdown(self) -> None:
        if self._countdown_deadline is None or self._stop.is_set():
            return
        remaining = max(0, math.ceil(self._countdown_deadline - time.monotonic()))
        if remaining:
            if remaining != self._countdown_remaining:
                with self._state_changed:
                    self._countdown_remaining = remaining
                    self._publish_locked()
                self._sound.play("countdown")
            return
        with self._state_changed:
            preset = self._countdown_preset
            self._clear_countdown_locked()
        try:
            self._capture(preset)
        except Exception as error:
            self._action_failed("capture", error)

    def _capture(self, preset: Preset | None = None) -> None:
        if not self._camera_available:
            raise ValueError(CAMERA_UNAVAILABLE_MESSAGE)
        self._can_save()
        preset = preset or self._resolve_preset(self._presets[self._preset_index])
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
            if preset.id == ORIGINAL_PRESET.id:
                self._store.add_photo(capture_id, source_path)
            else:
                # The first version of a new shot shares its photo's id.
                self._store.enqueue(capture_id, preset.id, source_path)
        except Exception:
            source_path.unlink(missing_ok=True)
            raise
        with self._state_changed:
            self._last_capture_id = capture_id
            self._gallery_revision += 1
            self._status, self._message = ScreenState.LIVE, ""
            self._publish_locked()
        self._notify(
            "queued",
            "Photo saved",
            f"{preset.name} · keep shooting",
            None if preset.id == ORIGINAL_PRESET.id else capture_id,
            photo_id=capture_id,
        )

    def _remix(self, values: dict, *, retry: bool) -> None:
        """Restyle adds a version to a photo. Retry queues a failed version again."""
        if self._styles_off:
            raise ValueError(self._styles_off)
        self._can_save()
        if retry:
            failed = self._store.get(str(values.get("captureId")))
            if failed is None:
                raise ValueError("Photo was not found")
            if failed.status != "failed":
                raise ValueError("This photo is already complete or waiting to process")
            photo = self._store.get_photo(failed.photo_id) if failed.photo_id else None
            preset_id = failed.preset_id
        else:
            photo = self._store.get_photo(str(values.get("photoId")))
            preset_id = values.get("presetId")
        if photo is None or not photo.source_path.is_file():
            raise ValueError("The original photo is unavailable")
        if preset_id == ORIGINAL_PRESET.id or (
            preset_id not in {p.id for p in self._presets}
            and not (retry and preset_id in RETIRED_PRESETS)
        ):
            raise ValueError("Choose an available style")
        if preset_id == "random":
            preset_id = self._resolve_preset(RANDOM_PRESET).id
        capture_id = self._new_id()
        if retry:
            # The failed version itself goes back in the queue. Nothing is added.
            self._store.requeue(failed.capture_id, capture_id)
            self._retry_after.pop(failed.capture_id, None)
        else:
            # Versions share their photo's original. Deleting a version never removes it.
            self._store.enqueue(capture_id, preset_id, photo.source_path, photo_id=photo.photo_id)
        with self._state_changed:
            self._gallery_revision += 1
            if self._view["screen"] == "photo" and self._view["photoId"] == photo.photo_id:
                self._view = {**self._view, "versionId": capture_id}
            self._publish_locked()
        if retry:
            self._notify(
                "queued",
                "Trying again",
                self._job_preset_name(failed),
                capture_id,
                photo_id=photo.photo_id,
            )
        else:
            self._notify(
                "queued",
                "New version queued",
                "Your original photo is kept",
                capture_id,
                photo_id=photo.photo_id,
            )

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
            if self._image_model is not None:
                generation = self._transform_locally(job, result_path)
            elif self._client is None:
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
                job.capture_id,
                generation.id,
                result_path,
                generation.share_url,
                preset_id=generation.preset_id,
                preset_name=generation.preset_name,
            )
            return CaptureOutcome(self._store.get(job.capture_id) or job, generation)
        except ImageModelError as error:
            if error.retry:
                self._store.mark_queued(job.capture_id, error.message)
                return CaptureOutcome(self._store.get(job.capture_id) or job, None, queued=True)
            self._store.mark_failed(job.capture_id, error.message)
            if error.account:
                self._turn_styles_off(error.message)
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

    def _turn_styles_off(self, reason: str) -> None:
        """The key or account can't make images: save plain photos until a restart."""
        with self._state_changed:
            if self._styles_off:
                return
            self._styles_off = reason
            self._announce_styles_off = True
            self._load_presets()
            self._publish_locked()
        self._fail_queued(reason)

    def _fail_queued(self, reason: str) -> None:
        """Fail waiting versions now rather than call a model that can't answer."""
        jobs = self._store.pending(MAX_PENDING)
        for job in jobs:
            self._store.mark_failed(job.capture_id, reason)
        if jobs:
            with self._state_changed:
                self._gallery_revision += 1
                self._publish_locked()

    def _transform_locally(self, job: CaptureJob, result_path: Path) -> Generation:
        if self._styles_off:
            raise ImageModelError(self._styles_off, account=True)
        image = self._image_model.transform(
            job.source_path.read_bytes(), style_prompt(job.preset_id)
        )
        temporary = result_path.with_suffix(".download")
        temporary.write_bytes(image)
        with Image.open(temporary) as opened:
            opened.verify()
        temporary.replace(result_path)
        return Generation(
            f"local-{job.capture_id}", job.capture_id, "complete", job.preset_id, None, None, None
        )

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
                    self._job_preset_name(job),
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
            elif self._announce_styles_off:
                self._announce_styles_off = False
                self._sound.play("error")
                self._notify(
                    "error",
                    "Styles are off",
                    "Photos are saved plain, and you can still edit them. See Settings › Device.",
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
        if self._standalone:
            raise ValueError("Sharing needs a Muse Cam server")
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

    def _sync_retractions(self) -> None:
        if self._retraction_future is not None:
            if not self._retraction_future.done():
                return
            future, capture_id = self._retraction_future, self._retracting_id
            self._retraction_future, self._retracting_id = None, None
            if capture_id is not None:
                try:
                    future.result()
                except Exception:
                    LOGGER.warning("Share removal will retry for %s", capture_id, exc_info=True)
                    self._store.defer_retraction(capture_id)
                else:
                    self._store.complete_retraction(capture_id)
                    self._notify(
                        "success", "Shared photo removed", "The public link is no longer available"
                    )
                with self._state_changed:
                    self._publish_locked()
        now = time.monotonic()
        if (
            self._client is None
            or self._share_future is not None
            or now < self._retraction_check_at
        ):
            return
        self._retraction_check_at = now + 1
        capture_id = self._store.pending_retraction()
        if capture_id is not None:
            self._retracting_id = capture_id
            self._retraction_future = self._share_executor.submit(
                self._client.retract_capture, capture_id
            )

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
        if (
            self._store.counts().get("uploading", 0)
            or self._future
            or self._editing_id
            or self._share_future
        ):
            raise ValueError("Wait for processing to finish before shutting down")
        with self._state_changed:
            self._clear_countdown_locked()
            self._status = ScreenState.SHUTTING_DOWN
            self._message = "Safe to unplug when the screen turns off"
            self._publish_locked()
        if not self._simulate:
            subprocess.run(["sudo", "-n", "/usr/bin/systemctl", "poweroff"], check=True, timeout=10)

    def _notify(
        self,
        kind: str,
        title: str,
        message: str,
        capture_id: str | None = None,
        *,
        photo_id: str | None = None,
    ) -> None:
        if capture_id is not None and photo_id is None:
            job = self._store.get(capture_id)
            photo_id = job.photo_id if job else None
        with self._state_changed:
            self._notification_id += 1
            self._notifications.append(
                {
                    "id": self._notification_id,
                    "kind": kind,
                    "title": title,
                    "message": message,
                    "captureId": capture_id,
                    "photoId": photo_id,
                }
            )
            self._publish_locked()

    def _job_preset_name(self, job: CaptureJob) -> str:
        return job.preset_name or self._preset_name(job.preset_id)

    def _preset_name(self, preset_id: str) -> str:
        retired = RETIRED_PRESETS.get(preset_id)
        # Bundled styles keep their names while styles are off and the rail is empty.
        # Filters were once styles too, so older versions may use one.
        return next(
            (
                p.name
                for p in (*self._presets, *FILTER_PRESETS, *FALLBACK_PRESETS)
                if p.id == preset_id
            ),
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
                "view": self._view,
                "preset": self._preset_json(preset),
                "presets": [self._preset_json(p) for p in self._presets],
                "presetIndex": self._preset_index,
                "presetCount": len(self._presets),
                "timerSeconds": self._timer_seconds,
                "countdownRemaining": self._countdown_remaining,
                "message": self._message,
                "networkOnline": self._network_online,
                "queued": counts.get("queued", 0),
                "pendingRetractions": self._store.retraction_count(),
                "processingId": self._processing_id,
                "sharingId": self._sharing_id,
                "battery": self._battery_percentage,
                "focus": self._focus.to_dict(),
                "previewSize": {
                    "width": self._profile.display_width,
                    "height": self._profile.display_height,
                },
                "galleryRevision": self._gallery_revision,
                "galleryCount": self._store.photo_counts()["all"],
                "latestPhoto": self._latest_photo(),
                "notifications": list(self._notifications),
                "lastCaptureId": self._last_capture_id,
                "volume": self._sound.volume,
                "processingSound": self._sound.processing_enabled,
                "maintenance": self._maintenance,
                "canShare": not self._standalone,
                # Edited versions can't be shared, so only standalone cameras edit.
                "canEdit": self._standalone,
                # A standalone camera's photos go to a phone over Wi-Fi. A connected
                # camera shares them through the gallery, and its roll holds guests' photos.
                "canTransfer": self._standalone,
                "filters": [{"id": p.id, "name": p.name} for p in FILTER_PRESETS],
                "stylesOff": self._styles_off,
                "simulate": self._simulate,
                "revision": self._revision,
                "sessionId": self._session_id,
            }

    @staticmethod
    def _preset_json(preset: Preset) -> dict:
        return {
            "id": preset.id,
            "kind": preset.id if preset.id in PICKER_ONLY else "imagined",
            "category": preset.category,
            "name": preset.name,
            "description": preset.description,
            "accent": preset.accent,
        }

    @staticmethod
    def _timestamp(value: str) -> str:
        return value.replace(" ", "T") + "Z"

    def version_json(self, job: CaptureJob) -> dict:
        thumbnail_kind = "result" if job.result_path else "source"
        # Editing again replaces an Edited version's image, so its URLs change with it.
        stamp = ""
        if job.edit is not None:
            recipe = json.dumps(job.edit, sort_keys=True).encode()
            stamp = hashlib.sha1(recipe, usedforsecurity=False).hexdigest()[:10]
        return {
            "id": job.capture_id,
            "photoId": job.photo_id,
            "presetId": job.preset_id,
            "presetName": self._job_preset_name(job),
            "status": job.status,
            "error": gallery_error(job.error),
            "shareUrl": job.share_url,
            "createdAt": self._timestamp(job.created_at),
            "attempts": job.attempts,
            "resultUrl": f"/api/versions/{job.capture_id}/result{f'?v={stamp}' if stamp else ''}"
            if job.result_path
            else None,
            "thumbnailUrl": f"/api/versions/{job.capture_id}/thumbnail?kind={thumbnail_kind}"
            + (f"&v={stamp}" if stamp else ""),
            "edit": job.edit,
        }

    @staticmethod
    def _cover(versions: list[CaptureJob]) -> CaptureJob | None:
        """The version a photo shows in the roll: its newest finished one, else its newest."""
        finished = [job for job in versions if job.status == "complete"]
        return (finished or versions or [None])[-1]

    @staticmethod
    def _photo_status(versions: list[CaptureJob], cover: CaptureJob | None) -> str:
        statuses = {job.status for job in versions}
        for status in ("uploading", "queued"):
            if status in statuses:
                return status
        if cover is None:
            return "original"
        return cover.status

    def photo_json(self, photo: Photo, versions: list[CaptureJob]) -> dict:
        cover = self._cover(versions)
        cover_json = self.version_json(cover) if cover else None
        return {
            "id": photo.photo_id,
            "createdAt": self._timestamp(photo.created_at),
            "status": self._photo_status(versions, cover),
            "versionCount": len(versions),
            "cover": cover_json,
            "sourceUrl": f"/api/gallery/{photo.photo_id}/original",
            "thumbnailUrl": cover_json["thumbnailUrl"]
            if cover_json
            else f"/api/gallery/{photo.photo_id}/thumbnail",
        }

    def _latest_photo(self) -> dict | None:
        """The newest photo, for the camera screen's gallery button."""
        photos = self._store.photos(limit=1)
        if not photos:
            return None
        photo = photos[0]
        item = self.photo_json(photo, self._store.versions([photo.photo_id])[photo.photo_id])
        return {"id": item["id"], "thumbnailUrl": item["thumbnailUrl"]}

    def gallery(self, offset: int = 0, status: str = "all") -> dict:
        photos = self._store.photos(limit=40, offset=offset, status=status)
        versions = self._store.versions(photo.photo_id for photo in photos)
        return {
            "items": [self.photo_json(photo, versions[photo.photo_id]) for photo in photos],
            "counts": self._store.photo_counts(),
            "nextOffset": offset + 40 if len(photos) == 40 else None,
        }

    def photo_detail(self, photo_id: str, status: str = "all") -> dict | None:
        photo = self._store.get_photo(photo_id)
        if photo is None:
            return None
        versions = self._store.versions([photo_id])[photo_id]
        return {
            **self.photo_json(photo, versions),
            "versions": [self.version_json(job) for job in versions],
            **self._store.photo_neighbors(photo_id, status),
        }

    def _check_deletable(self, versions: list[CaptureJob]) -> None:
        if self._maintenance or self._stop.is_set():
            raise ValueError("Camera is restarting or updating. Try again shortly.")
        busy = {self._processing_id, self._editing_id, self._sharing_id}
        if any(job.status == "uploading" or job.capture_id in busy for job in versions):
            raise ValueError("Wait for this photo to finish processing or sharing before deleting.")

    def _version_files(self, job: CaptureJob) -> list[Path]:
        # A version made before photos existed has its own copy of the original. An
        # Edited version's source is the image it was edited from.
        return [
            job.source_path,
            job.result_path or self._results_dir / f"{job.capture_id}.jpg",
            self._results_dir / f"{job.capture_id}.download",
        ]

    def _remove_files(
        self, files: list[Path], *, capture_ids: set[str], photo_id: str | None
    ) -> None:
        # Validate every path before removing anything. A file that another photo
        # or version still uses (such as a shared original) stays.
        gallery = {self._captures_dir.resolve(), self._results_dir.resolve()}
        for path in files:
            if path.is_symlink() or path.resolve().parent not in gallery:
                raise ValueError("Photo files are outside the camera gallery")
        try:
            for path in files:
                if not self._store.referenced_elsewhere(
                    path, capture_ids=capture_ids, photo_id=photo_id
                ):
                    path.unlink(missing_ok=True)
        except OSError as error:
            raise ValueError("Could not remove the photo files. Please try again.") from error

    def _needs_retraction(self, job: CaptureJob) -> bool:
        # A standalone camera never uploads, so it has nothing to unshare.
        return not self._standalone and bool(
            (job.generation_id and not job.generation_id.startswith("offline-"))
            or (job.attempts > 0 and not self._offline)
        )

    def _forget(self, capture_ids: set[str], photo_id: str | None = None) -> None:
        self._retraction_check_at = 0
        for capture_id in capture_ids:
            self._retry_after.pop(capture_id, None)
        self._notifications = deque(
            (
                notice
                for notice in self._notifications
                if notice["captureId"] not in capture_ids
                and (photo_id is None or notice["photoId"] != photo_id)
            ),
            maxlen=12,
        )
        if self._last_capture_id in capture_ids or self._last_capture_id == photo_id:
            self._last_capture_id = None
        if self._last_result_id in capture_ids:
            self._last_result_id = None
        if self._view["versionId"] in capture_ids:
            self._view = {**self._view, "versionId": None}
        self._gallery_revision += 1

    def delete_version(self, capture_id: str) -> None:
        """Remove one version of a photo. The original and other versions stay."""
        with self._photo_operations, self._state_changed:
            job = self._store.get(capture_id)
            if job is None:
                raise ValueError("Photo was not found")
            self._check_deletable([job])
            self._remove_files(self._version_files(job), capture_ids={capture_id}, photo_id=None)
            retract = self._needs_retraction(job)
            self._store.delete(capture_id, retract_share=retract)
            self._forget({capture_id})
            self._notify(
                "deleted",
                "Version deleted",
                "Public share removal is queued until connected"
                if retract
                else "The original photo is kept",
            )

    def delete_photo(self, photo_id: str) -> None:
        """Remove a photo's original and every version of it."""
        with self._photo_operations, self._state_changed:
            photo = self._store.get_photo(photo_id)
            if photo is None:
                raise ValueError("Photo was not found")
            versions = self._store.versions([photo_id])[photo_id]
            self._check_deletable(versions)
            files = [photo.source_path]
            for job in versions:
                files.extend(self._version_files(job))
            capture_ids = {job.capture_id for job in versions}
            self._remove_files(files, capture_ids=capture_ids, photo_id=photo_id)
            retract = [job.capture_id for job in versions if self._needs_retraction(job)]
            self._store.delete_photo(photo_id, retract=retract)
            self._forget(capture_ids, photo_id)
            self._notify(
                "deleted",
                "Photo deleted",
                "Public share removal is queued until connected"
                if retract
                else "Removed from this camera",
            )

    def _edit_source(
        self, photo_id: str, target: str | None
    ) -> tuple[Path, CaptureJob | None, str | None]:
        """What editing ``target`` starts from.

        Returns the starting image, the Edited version to update (None for a new
        one), and the name of the version the image came from (None for the
        original). ``target`` is a version id, or None or "original".
        """
        photo = self._store.get_photo(photo_id)
        if photo is None:
            raise ValueError("Photo was not found")
        if target is None or target == "original":
            return self._media_file(photo.source_path), None, None
        job = self._store.get(str(target))
        if job is None or job.photo_id != photo_id:
            raise ValueError("That version of the photo was not found")
        if job.edit is not None:
            # Editing an edit picks up its recipe from the same starting image.
            return self._media_file(job.source_path), job, job.edit.get("from")
        if job.status != "complete":
            raise ValueError("Wait for this version to finish before editing it")
        return self._media_file(job.result_path), None, self._job_preset_name(job)

    def edit_preview(
        self, photo_id: str, target: str | None, filter_id: str | None, size: str
    ) -> bytes:
        source, _, _ = self._edit_source(photo_id, target)
        try:
            return edit_preview(source, filter_id, size)
        except OSError as error:
            raise ValueError("Photo unavailable") from error

    def save_edit(self, photo_id: str, values: object) -> dict:
        """Save an edit as a new Edited version, or update the Edited version it came from."""
        if not self._standalone:
            raise ValueError("Editing needs a standalone camera")
        if not isinstance(values, dict):
            raise ValueError("Invalid edit")
        target = values.get("target")
        if target is not None and not isinstance(target, str):
            raise ValueError("Invalid edit")
        edit = Edit.parse({key: value for key, value in values.items() if key != "target"})
        if not self._edit_lock.acquire(blocking=False):
            raise ValueError("Another edit is saving")
        try:
            with self._photo_operations, self._state_changed:
                if self._maintenance or self._stop.is_set():
                    raise ValueError("Camera is restarting or updating. Try again shortly.")
                source, editing, base_name = self._edit_source(photo_id, target)
                if self._system.storage()["free"] < MIN_FREE_BYTES:
                    raise ValueError("Storage is nearly full. Free space before saving edits.")
                capture_id = editing.capture_id if editing else self._new_id()
                self._editing_id = capture_id
            temporary = self._results_dir / f"{capture_id}.edit"
            try:
                # About 0.5–2 s on a Pi, so the camera loop keeps running meanwhile.
                render_edit(source, temporary, edit)
                with self._photo_operations, self._state_changed:
                    # The photo, or the version the edit starts from, may have been
                    # deleted while it rendered.
                    if self._edit_source(photo_id, target)[0] != source:
                        raise ValueError("This photo changed while saving. Try again.")
                    result = self._results_dir / f"{capture_id}.jpg"
                    temporary.replace(result)
                    recipe = {**edit.to_json(), "from": base_name}
                    if editing:
                        self._store.update_edit(capture_id, recipe)
                    else:
                        self._store.add_edit(capture_id, photo_id, source, result, recipe)
                    self._gallery_revision += 1
                    if self._view["screen"] == "photo" and self._view["photoId"] == photo_id:
                        self._view = {**self._view, "versionId": capture_id}
                    self._publish_locked()
            except OSError as error:
                LOGGER.warning("Edit failed for %s", photo_id, exc_info=True)
                raise ValueError("Couldn’t save this edit. Your photo is unchanged.") from error
            finally:
                temporary.unlink(missing_ok=True)
                self._editing_id = None
        finally:
            self._edit_lock.release()
        return {"versionId": capture_id}

    def _media_file(self, path: Path | None) -> Path:
        if (
            path is None
            or not path.is_file()
            or not path.resolve().is_relative_to(self._config.data_dir.resolve())
        ):
            raise ValueError("Photo unavailable")
        return path

    def original_path(self, photo_id: str) -> Path:
        photo = self._store.get_photo(photo_id)
        return self._media_file(photo.source_path if photo else None)

    def version_path(self, capture_id: str, kind: str) -> Path:
        job = self._store.get(capture_id)
        if job is None or kind not in {"source", "result"}:
            raise ValueError("Photo unavailable")
        return self._media_file(job.source_path if kind == "source" else job.result_path)

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
                or self._editing_id
                or self._share_future
                or not self._actions.empty()
                or counts.get("queued", 0)
                or counts.get("uploading", 0)
                or self._status in {ScreenState.CAPTURING, ScreenState.COUNTDOWN}
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
        if self._image_model is not None:
            self._image_model.close()
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
    detail = request.app["controller"].photo_detail(
        request.match_info["photo_id"], request.query.get("filter", "all")
    )
    if detail is None:
        raise web.HTTPNotFound()
    return web.json_response(detail, headers={"Cache-Control": "no-store"})


async def _gallery_delete(request: web.Request) -> web.Response:
    await asyncio.to_thread(request.app["controller"].delete_photo, request.match_info["photo_id"])
    return web.json_response({"deleted": True})


async def _version_delete(request: web.Request) -> web.Response:
    await asyncio.to_thread(
        request.app["controller"].delete_version, request.match_info["capture_id"]
    )
    return web.json_response({"deleted": True})


async def _edit_preview(request: web.Request) -> web.Response:
    filter_id = request.query.get("filter", "none")
    body = await asyncio.to_thread(
        request.app["controller"].edit_preview,
        request.match_info["photo_id"],
        request.query.get("target"),
        None if filter_id == "none" else filter_id,
        request.query.get("size", ""),
    )
    return web.Response(
        body=body, content_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"}
    )


async def _edit_save(request: web.Request) -> web.Response:
    values = await request.json()
    result = await asyncio.to_thread(
        request.app["controller"].save_edit, request.match_info["photo_id"], values
    )
    return web.json_response(result)


def _thumbnail(path: Path) -> bytes:
    with Image.open(path) as original:
        image = original.convert("RGB")
        image.thumbnail((240, 180))
        output = BytesIO()
        image.save(output, "JPEG", quality=72)
        return output.getvalue()


async def _media_response(path: Path, thumbnail: bool) -> web.StreamResponse:
    headers = {"Cache-Control": "private, max-age=86400"}
    if thumbnail:
        return web.Response(
            body=await asyncio.to_thread(_thumbnail, path),
            content_type="image/jpeg",
            headers=headers,
        )
    return web.FileResponse(path, headers=headers)


async def _photo_media(request: web.Request) -> web.StreamResponse:
    kind = request.match_info["kind"]
    if kind not in {"original", "thumbnail"}:
        raise ValueError("Photo unavailable")
    path = request.app["controller"].original_path(request.match_info["photo_id"])
    return await _media_response(path, kind == "thumbnail")


async def _version_media(request: web.Request) -> web.StreamResponse:
    controller = request.app["controller"]
    capture_id, kind = request.match_info["capture_id"], request.match_info["kind"]
    if kind == "thumbnail":
        path = controller.version_path(capture_id, request.query.get("kind", "source"))
        return await _media_response(path, True)
    return await _media_response(controller.version_path(capture_id, kind), False)


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


async def _transfer(request: web.Request) -> web.Response:
    transfer: PhotoTransfer = request.app["transfer"]
    if not request.app["controller"]._standalone:
        raise web.HTTPNotFound()
    action = request.match_info.get("action")
    if action is None:
        result = transfer.status()
    elif action == "start":
        result = await transfer.start()
    elif action == "stop":
        result = await transfer.stop()
    else:
        raise web.HTTPNotFound()
    return web.json_response(result, headers={"Cache-Control": "no-store"})


async def _index(_: web.Request) -> web.StreamResponse:
    if not (STATIC_DIR / "index.html").is_file():
        raise web.HTTPServiceUnavailable(text="Camera UI has not been built")
    return web.FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})


def create_web_app(
    controller: CameraWebController, *, transfer_port: int = 8081
) -> web.Application:
    app = web.Application(middlewares=[local_requests], client_max_size=8192)
    app["controller"] = controller
    transfer = app["transfer"] = PhotoTransfer(controller, port=transfer_port)

    async def close_transfer(_: web.Application) -> None:
        await transfer.stop()

    app.on_shutdown.append(close_transfer)

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
    app.router.add_get("/api/gallery/{photo_id}", _gallery_detail)
    app.router.add_post("/api/gallery/{photo_id}/delete", _gallery_delete)
    app.router.add_get("/api/gallery/{photo_id}/{kind}", _photo_media)
    app.router.add_post("/api/versions/{capture_id}/delete", _version_delete)
    app.router.add_get("/api/versions/{capture_id}/{kind}", _version_media)
    app.router.add_get("/api/edit/{photo_id}/preview", _edit_preview)
    app.router.add_post("/api/edit/{photo_id}", _edit_save)
    app.router.add_get("/api/settings", _settings)
    app.router.add_post("/api/settings", _settings)
    app.router.add_post("/api/sound", _sound)
    app.router.add_post("/api/system/{action}", _system)
    app.router.add_get("/api/transfer", _transfer)
    app.router.add_post("/api/transfer/{action}", _transfer)
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
    transfer_port: int = 8081,
) -> None:
    controller = CameraWebController(config, profile, simulate=simulate, offline=offline)
    controller.start()
    try:
        web.run_app(
            create_web_app(controller, transfer_port=transfer_port),
            host=host,
            port=port,
            print=None,
        )
    finally:
        controller.close()
