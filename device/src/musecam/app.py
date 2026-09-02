from __future__ import annotations

import logging
import shutil
import subprocess
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import httpx
from PIL import Image

from .battery import create_battery
from .camera import Camera, create_camera, prepare_capture
from .client import MuseCamClient
from .config import DeviceConfig, HardwareProfile
from .display import Display, create_display
from .input import InputManager
from .models import Action, CaptureJob, Generation, Preset, ScreenState
from .store import CaptureStore
from .ui import AppView, Renderer

LOGGER = logging.getLogger(__name__)
CAMERA_UNAVAILABLE_MESSAGE = "Camera unavailable — check ribbon cable"

FALLBACK_PRESETS = [
    Preset("post-apocalypse", 2, "After the End", "Cinematic ruins and survival gear.", "#ff6c51"),
    Preset("kid-drawing", 1, "Fridge Masterpiece", "Wobbly crayons and joyful color.", "#ffd84a"),
    Preset("alien-visitor", 1, "First Contact", "An uncanny close encounter.", "#d7ff42"),
    Preset("claymation", 1, "Tiny Clay World", "Hand-shaped stop-motion charm.", "#f39b69"),
    Preset("disposable-90s", 1, "Found in 1997", "Flash, grain, and candid energy.", "#5ac6c8"),
    Preset("storybook", 1, "Bedtime Legend", "A warm painted storybook page.", "#6657de"),
]


def api_error_code(error: httpx.HTTPStatusError) -> str | None:
    try:
        payload = error.response.json()
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None
    details = payload.get("details")
    if not isinstance(details, dict):
        return None
    code = details.get("code")
    return code if isinstance(code, str) else None


def friendly_generation_error(code: str | None) -> str:
    if code == "content_filtered":
        return "Try another style or framing. Tap BACK."
    if code in {"model_timeout", "model_rate_limited", "model_unavailable"}:
        return "Muse Image is unavailable. Tap BACK and try again."
    return "Remix failed. Tap BACK and try again."


@dataclass(frozen=True)
class CaptureOutcome:
    job: CaptureJob
    generation: Generation | None
    queued: bool = False


class MuseCamApp:
    def __init__(
        self,
        config: DeviceConfig,
        profile: HardwareProfile,
        *,
        simulate: bool = False,
        windowed: bool = False,
        offline: bool = False,
    ) -> None:
        self._config = config
        self._profile = profile
        self._simulate = simulate
        self._offline = offline
        self._data_dir = config.data_dir
        self._captures_dir = self._data_dir / "captures"
        self._results_dir = self._data_dir / "results"
        self._captures_dir.mkdir(parents=True, exist_ok=True)
        self._results_dir.mkdir(parents=True, exist_ok=True)

        self._store = CaptureStore(self._data_dir / "musecam.sqlite3")
        self._client = None if offline else MuseCamClient(config)
        self._camera: Camera = create_camera(profile, simulate=simulate)
        self._camera_available = False
        self._display: Display = create_display(
            profile, config, simulate=simulate, windowed=windowed
        )
        self._inputs = InputManager(profile, simulate=simulate)
        self._battery = create_battery(profile.battery_telemetry and not simulate)
        self._renderer = Renderer(self._display.surface, self._display.width, self._display.height)
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="musecam-network")

        self._presets: list[Preset] = []
        self._preset_index = 0
        self._state = ScreenState.STARTING
        self._message = "Starting camera"
        self._preview: Image.Image | None = None
        self._result: Image.Image | None = None
        self._active_job: CaptureJob | None = None
        self._future: Future[CaptureOutcome | Generation] | None = None
        self._future_kind: str | None = None
        self._network_online = not offline
        self._battery_percentage: int | None = None
        self._last_battery_read = 0.0
        self._last_retry = 0.0
        self._running = False

    def run(
        self,
        *,
        max_frames: int | None = None,
        screenshot: Path | None = None,
        capture_on_start: bool = False,
    ) -> None:
        import pygame

        self._load_presets()
        try:
            self._camera.start()
            self._camera_available = True
            self._state = ScreenState.LIVE
            self._message = ""
        except Exception:
            LOGGER.exception("Camera startup failed")
            self._state = ScreenState.ERROR
            self._message = CAMERA_UNAVAILABLE_MESSAGE
        self._running = True
        clock = pygame.time.Clock()
        frames = 0
        demo_capture_pending = capture_on_start

        try:
            while self._running:
                self._poll_future()
                for action in self._inputs.poll():
                    self._handle_action(action)

                if self._state == ScreenState.LIVE:
                    try:
                        self._preview = self._camera.preview()
                    except Exception as error:
                        LOGGER.exception("Camera preview failed")
                        self._state = ScreenState.ERROR
                        self._message = str(error)

                if demo_capture_pending and frames >= 1 and self._state == ScreenState.LIVE:
                    demo_capture_pending = False
                    self._capture()

                self._refresh_battery()
                self._retry_pending()
                self._render()
                frames += 1
                if max_frames is not None and frames >= max_frames:
                    if screenshot:
                        self._display.save_screenshot(screenshot)
                    break
                clock.tick(self._profile.preview_fps)
        finally:
            self.close()

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

    def _render(self) -> None:
        preset = self._presets[self._preset_index]
        queued = len(self._store.pending())
        view = AppView(
            state=self._state,
            preset=preset,
            message=self._message,
            battery=self._battery_percentage,
            queued=queued,
            shared=bool(self._active_job and self._active_job.share_url),
            network_online=self._network_online,
        )
        image = (
            self._result
            if self._state in {ScreenState.RESULT, ScreenState.SHARING}
            else self._preview
        )
        self._renderer.draw(view, image)
        self._display.present()

    def _handle_action(self, action: Action) -> None:
        if action == Action.QUIT:
            self._running = False
        elif action == Action.POWER:
            self._power_off()
        elif self._state == ScreenState.ERROR and action in {
            Action.BACK,
            Action.SHUTTER,
            Action.SHARE,
        }:
            self._return_to_live()
        elif action == Action.BACK:
            self._return_to_live()
        elif action in {Action.PREVIOUS, Action.NEXT} and self._state in {
            ScreenState.LIVE,
            ScreenState.RESULT,
            ScreenState.ERROR,
        }:
            delta = -1 if action == Action.PREVIOUS else 1
            self._preset_index = (self._preset_index + delta) % len(self._presets)
            self._state = ScreenState.LIVE if self._camera_available else ScreenState.ERROR
            self._result = None
            self._message = "" if self._camera_available else CAMERA_UNAVAILABLE_MESSAGE
        elif action == Action.SHUTTER and self._state in {ScreenState.LIVE, ScreenState.RESULT}:
            self._capture()
        elif action == Action.SHARE and self._state == ScreenState.RESULT:
            self._share()

    def _capture(self) -> None:
        if self._future is not None:
            return
        preset = self._presets[self._preset_index]
        capture_id = f"pi_{int(time.time())}_{uuid.uuid4().hex[:8]}"
        source_path = self._captures_dir / f"{capture_id}.jpg"
        self._state = ScreenState.CAPTURING
        self._message = "Hold still"
        self._render()
        try:
            self._camera.capture(source_path)
            prepare_capture(source_path)
        except Exception as error:
            LOGGER.exception("Capture failed")
            self._state = ScreenState.ERROR
            self._message = f"Camera error: {error}"
            return

        self._store.enqueue(capture_id, preset.id, source_path)
        job = self._store.get(capture_id)
        if job is None:
            self._state = ScreenState.ERROR
            self._message = "Could not save capture"
            return
        self._active_job = job
        self._state = ScreenState.PROCESSING
        self._message = "Sending to Muse Image"
        self._future_kind = "generate"
        self._future = self._executor.submit(self._process_job, job)

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
                error = friendly_generation_error(generation.error_code)
                self._store.mark_failed(job.capture_id, error)
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
        except Exception as error:
            LOGGER.exception("Background operation failed")
            if kind == "share":
                self._state = ScreenState.RESULT
                self._message = "Could not share. Try again when the connection returns."
                self._network_online = False
            else:
                self._state = ScreenState.ERROR
                self._message = str(error)
            return

        if kind == "share" and isinstance(result, Generation):
            if self._active_job and result.share_url:
                self._store.mark_shared(self._active_job.capture_id, result.share_url)
                self._active_job = self._store.get(self._active_job.capture_id)
            self._state = ScreenState.RESULT
            self._message = "Shared to the public roll"
            return

        if not isinstance(result, CaptureOutcome):
            return
        self._active_job = result.job
        if result.job.status == "complete" and result.job.result_path:
            self._result = Image.open(result.job.result_path).convert("RGB")
            self._state = ScreenState.RESULT
            self._message = ""
            self._network_online = not self._offline
        elif result.queued:
            self._state = ScreenState.ERROR
            self._message = "No connection. Your photo is safe and will retry."
            self._network_online = False
        else:
            self._state = ScreenState.ERROR
            self._message = result.job.error or "Muse Image could not finish this photo."

    def _share(self) -> None:
        if (
            self._client is None
            or self._future is not None
            or self._active_job is None
            or self._active_job.generation_id is None
            or self._active_job.generation_id.startswith("offline-")
        ):
            self._message = "Sharing needs a network connection"
            return
        if self._active_job.share_url:
            self._message = "Already shared"
            return
        self._state = ScreenState.SHARING
        self._future_kind = "share"
        self._future = self._executor.submit(self._client.share, self._active_job.generation_id)

    def _retry_pending(self) -> None:
        now = time.monotonic()
        if (
            self._offline
            or self._future is not None
            or self._state not in {ScreenState.LIVE, ScreenState.ERROR}
            or now - self._last_retry < 15
        ):
            return
        self._last_retry = now
        pending = self._store.pending(limit=1)
        if not pending:
            return
        self._active_job = pending[0]
        self._state = ScreenState.PROCESSING
        self._message = "Retrying saved photo"
        self._future_kind = "generate"
        self._future = self._executor.submit(self._process_job, pending[0])

    def _refresh_battery(self) -> None:
        now = time.monotonic()
        if now - self._last_battery_read >= 5:
            self._last_battery_read = now
            self._battery_percentage = self._battery.percentage()

    def _return_to_live(self) -> None:
        self._state = ScreenState.LIVE if self._camera_available else ScreenState.ERROR
        self._message = "" if self._camera_available else CAMERA_UNAVAILABLE_MESSAGE
        self._result = None

    def _prune_local_history(self) -> None:
        for path in self._store.prune_finished(keep=100):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                LOGGER.warning("Could not remove old capture %s", path, exc_info=True)

    def _power_off(self) -> None:
        self._state = ScreenState.SHUTTING_DOWN
        self._render()
        if self._simulate:
            self._running = False
            return
        try:
            subprocess.run(
                ["sudo", "-n", "/usr/bin/systemctl", "poweroff"],
                check=True,
                timeout=10,
            )
        except (OSError, subprocess.SubprocessError):
            LOGGER.exception("Safe shutdown command failed")
            self._state = ScreenState.ERROR
            self._message = "Could not shut down safely"

    def close(self) -> None:
        self._running = False
        if self._future is not None:
            self._future.cancel()
        self._executor.shutdown(wait=False, cancel_futures=True)
        self._inputs.close()
        self._camera.close()
        if self._client is not None:
            self._client.close()
        self._store.close()
        self._display.close()
