from __future__ import annotations

import io
import logging
import math
import random
import shutil
import struct
import subprocess
import threading
import wave
from collections import deque
from pathlib import Path

LOGGER = logging.getLogger(__name__)
CUES = {"shutter", "processing", "success", "error"}


def sound_wave(cue: str, volume: int) -> bytes:
    """Original, deterministic earcons; no downloaded audio or runtime dependencies."""
    if cue not in CUES:
        raise ValueError("Unknown sound")
    rate = 48000
    duration = {"shutter": 0.19, "processing": 0.38, "success": 0.55, "error": 0.42}[cue]
    gain = 0.20 * (max(0, min(100, volume)) / 100) ** 2
    rng = random.Random(42)
    frames = bytearray()
    for i in range(round(duration * rate)):
        t = i / rate
        value = 0.0
        if cue == "shutter":
            # Two spring/curtain transients with a soft mechanical tail.
            for onset, weight in ((0.0, 1.0), (0.063, 0.75)):
                x = t - onset
                if x >= 0:
                    value += (
                        weight
                        * math.exp(-x * 95)
                        * (0.65 * rng.uniform(-1, 1) + 0.35 * math.sin(2 * math.pi * 1750 * x))
                    )
        elif cue == "processing":
            step = int(t / 0.062)
            x = t % 0.062
            if x < 0.035:
                frequency = (185, 250, 155, 215, 175, 280, 190)[step]
                value = (
                    0.13
                    * math.sin(math.pi * x / 0.035) ** 2
                    * math.sin(2 * math.pi * (frequency * x + 140 * x * x))
                )
        else:
            notes = (
                ((0.0, 660), (0.15, 880), (0.28, 1108))
                if cue == "success"
                else ((0.0, 330), (0.18, 247))
            )
            for onset, frequency in notes:
                x = t - onset
                if 0 <= x < 0.24:
                    envelope = min(1, x / 0.012) * math.exp(-x * 16)
                    value += 0.42 * envelope * math.sin(2 * math.pi * frequency * x)
        # Fade the final samples, avoiding a sharp cutoff.
        value *= min(1, max(0, (duration - t) / 0.015))
        sample = round(max(-1, min(1, value)) * gain * 32767)
        frames.extend(struct.pack("<hh", sample, sample))
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(frames)
    return output.getvalue()


class SoundPlayer:
    def __init__(self, *, simulate: bool, volume: int = 35) -> None:
        self.volume = volume
        self.processing_enabled = True
        self.available = bool(
            not simulate
            and shutil.which("aplay")
            and Path("/proc/asound/cards").exists()
            and "MAX98357A" in Path("/proc/asound/cards").read_text()
        )
        self.error: str | None = None
        self._condition = threading.Condition()
        self._queue: deque[str] = deque(maxlen=4)
        self._closed = False
        self._process: subprocess.Popen | None = None
        self._thread = threading.Thread(target=self._run, name="musecam-audio", daemon=True)
        self._thread.start()

    def configure(self, volume: int, processing_enabled: bool) -> None:
        with self._condition:
            self.volume = volume
            self.processing_enabled = processing_enabled
            if volume == 0:
                self._queue.clear()
                if self._process is not None and self._process.poll() is None:
                    self._process.terminate()

    def play(self, cue: str) -> None:
        if cue not in CUES:
            raise ValueError("Unknown sound")
        with self._condition:
            if not self.available or not self.volume or self._closed:
                return
            if cue == "processing":
                if not self.processing_enabled or self._queue or self._process is not None:
                    return
            else:
                self._queue = deque(
                    (item for item in self._queue if item != "processing"), maxlen=4
                )
            self._queue.append(cue)
            self._condition.notify()

    def _run(self) -> None:
        while True:
            with self._condition:
                self._condition.wait_for(lambda: self._queue or self._closed)
                if self._closed:
                    return
                cue = self._queue.popleft()
                volume = self.volume
                if volume == 0:
                    continue
            try:
                payload = sound_wave(cue, volume)
                with self._condition:
                    if self._closed or not self.volume:
                        continue
                    self._process = subprocess.Popen(
                        ["aplay", "-q", "-D", "plughw:CARD=MAX98357A,DEV=0"],
                        stdin=subprocess.PIPE,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.PIPE,
                    )
                    process = self._process
                _, stderr = process.communicate(payload, timeout=3)
                if process.returncode and self.volume:
                    raise OSError(stderr.decode(errors="replace")[:180])
                self.error = None
            except (OSError, subprocess.SubprocessError):
                self.error = "Speaker playback unavailable"
                LOGGER.warning("Speaker playback failed", exc_info=True)
                if self._process is not None and self._process.poll() is None:
                    self._process.kill()
                    self._process.wait()
            finally:
                with self._condition:
                    self._process = None

    def close(self) -> None:
        with self._condition:
            self._closed = True
            if self._process is not None and self._process.poll() is None:
                self._process.terminate()
            self._condition.notify_all()
        self._thread.join(timeout=4)
