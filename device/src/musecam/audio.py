from __future__ import annotations

import io
import json
import logging
import math
import os
import random
import select
import shutil
import struct
import subprocess
import sys
import threading
import wave
from collections import deque
from functools import lru_cache
from pathlib import Path

LOGGER = logging.getLogger(__name__)
CUES = {"shutter", "processing", "success", "error"}
SAMPLE_RATE = 48000
CHUNK_FRAMES = 1024
SILENCE = bytes(CHUNK_FRAMES * 4)


def sound_wave(cue: str, volume: int) -> bytes:
    """Original, deterministic earcons; no downloaded audio or runtime dependencies."""
    if cue not in CUES:
        raise ValueError("Unknown sound")
    rate = SAMPLE_RATE
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
                        * min(1, x / 0.0015)
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
                    envelope = min(1, x / 0.012, (0.24 - x) / 0.012) * math.exp(-x * 16)
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


@lru_cache(maxsize=4)
def _samples(cue: str) -> tuple[int, ...]:
    with wave.open(io.BytesIO(sound_wave(cue, 100)), "rb") as wav:
        payload = wav.readframes(wav.getnframes())
    return struct.unpack(f"<{len(payload) // 2}h", payload)


class PcmMixer:
    """Fixed-size stereo PCM blocks, including silence while idle or muted."""

    def __init__(self) -> None:
        # Synthesize before opening ALSA: Python synthesis must not starve its buffer.
        self._clips = {cue: _samples(cue) for cue in CUES}
        self.cue: str | None = None
        self._position = 0
        self._gain = 0.0

    def start(self, cue: str) -> None:
        self.cue = cue
        self._position = 0
        self._gain = 0.0

    def render(self, volume: int, processing_enabled: bool) -> bytes:
        if self.cue is None:
            return SILENCE
        clip = self._clips[self.cue]
        cancelling = volume == 0 or (self.cue == "processing" and not processing_enabled)
        target = 0.0 if cancelling else (volume / 100) ** 2
        samples = clip[self._position : self._position + CHUNK_FRAMES * 2]
        count = len(samples)
        # Ramp changes over 5 ms; mute never cuts a nonzero sample abruptly.
        ramp_frames = SAMPLE_RATE // 200
        start_gain = self._gain
        output = [
            round(value * (start_gain + (target - start_gain) * min(1, (i // 2 + 1) / ramp_frames)))
            for i, value in enumerate(samples)
        ]
        self._gain = target
        self._position += count
        if cancelling or self._position >= len(clip):
            self.cue = None
            self._gain = 0.0
        return struct.pack(f"<{count}h", *output) + bytes(len(SILENCE) - count * 2)


def _device_available() -> bool:
    return bool(
        shutil.which("aplay")
        and Path("/proc/asound/cards").exists()
        and "MAX98357A" in Path("/proc/asound/cards").read_text()
    )


class _PcmStream:
    def __init__(self, *, simulate: bool, volume: int = 35) -> None:
        self.volume = volume
        self.processing_enabled = True
        self.available = not simulate and _device_available()
        self.error: str | None = None
        self._condition = threading.Condition()
        self._queue: deque[str] = deque(maxlen=4)
        self._closed = False
        self._process: subprocess.Popen | None = None
        self._mixer: PcmMixer | None = None
        self._thread = threading.Thread(target=self._run, name="musecam-audio", daemon=True)
        self._thread.start()

    def configure(self, volume: int, processing_enabled: bool) -> None:
        with self._condition:
            self.volume = volume
            self.processing_enabled = processing_enabled
            if volume == 0:
                self._queue.clear()
            # Keep the PCM stream alive even when muted: stopping I2S clocks pops.
            self._condition.notify()

    def play(self, cue: str) -> None:
        if cue not in CUES:
            raise ValueError("Unknown sound")
        with self._condition:
            if not self.available or not self.volume or self._closed:
                return
            if cue == "processing":
                if (
                    not self.processing_enabled
                    or self._queue
                    or (self._mixer is not None and self._mixer.cue is not None)
                ):
                    return
            else:
                self._queue = deque(
                    (item for item in self._queue if item != "processing"), maxlen=4
                )
            self._queue.append(cue)
            self._condition.notify()

    def _run(self) -> None:
        if not self.available:
            return
        process = None
        try:
            mixer = PcmMixer()
            with self._condition:
                if self._closed:
                    return
                self._mixer = mixer
                # One fixed-rate raw stream for the application's lifetime. A small
                # pipe bounds queued silence so the shutter remains responsive.
                process = subprocess.Popen(
                    [
                        "aplay",
                        "-q",
                        "-D",
                        "plughw:CARD=MAX98357A,DEV=0",
                        "-t",
                        "raw",
                        "-f",
                        "S16_LE",
                        "-r",
                        str(SAMPLE_RATE),
                        "-c",
                        "2",
                        "--period-size=1024",
                        "--buffer-size=4096",
                        "--fatal-errors",
                    ],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    bufsize=0,
                    pipesize=4096,
                )
                self._process = process
            # Establish clocks with silence before any queued cue.
            warmup_blocks = 12
            while True:
                with self._condition:
                    if self._closed:
                        break
                    if warmup_blocks:
                        payload = SILENCE
                        warmup_blocks -= 1
                    else:
                        if mixer.cue is None and self._queue and self.volume:
                            mixer.start(self._queue.popleft())
                        payload = mixer.render(self.volume, self.processing_enabled)
                if process.poll() is not None:
                    raise OSError("Audio stream exited")
                # ALSA / pipe backpressure provides pacing; never spin or sleep a
                # Python timer that can drift and interrupt the hardware clocks.
                remaining = memoryview(payload)
                while remaining:
                    written = process.stdin.write(remaining)
                    if not written:
                        raise OSError("Audio stream disconnected")
                    remaining = remaining[written:]
        except (OSError, subprocess.SubprocessError):
            if not self._closed:
                self.error = "Speaker stream stopped. Restart the camera to restore sounds."
                self.available = False
                # Do not reopen in a loop: that would produce repeated loud pops.
                LOGGER.warning("Speaker stream failed", exc_info=True)
        finally:
            if process is not None:
                if process.poll() is None:
                    process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                if process.stdin is not None:
                    process.stdin.close()
                if process.stderr is not None:
                    if not self._closed:
                        detail = process.stderr.read(2000).decode(errors="replace").strip()
                        if detail:
                            LOGGER.warning("Speaker stream: %s", detail)
                    process.stderr.close()
            with self._condition:
                self._process = None

    def close(self) -> None:
        with self._condition:
            self._closed = True
            if self._process is not None and self._process.poll() is None:
                self._process.terminate()
        self._thread.join(timeout=4)


class SoundPlayer(_PcmStream):
    """Control audio in a separate interpreter, isolated from camera GIL stalls."""

    def _run(self) -> None:
        if not self.available:
            return
        process = None
        try:
            with self._condition:
                if self._closed:
                    return
                process = subprocess.Popen(
                    [sys.executable, "-m", "musecam.audio", "--worker"],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=1,
                )
                self._process = process
            configured = None
            while True:
                with self._condition:
                    if self._closed:
                        break
                    if process.poll() is not None:
                        raise OSError("Audio worker exited")
                    settings = (self.volume, self.processing_enabled)
                    commands = []
                    if settings != configured:
                        commands.append({"volume": settings[0], "processing": settings[1]})
                        configured = settings
                    while self._queue:
                        commands.append({"cue": self._queue.popleft()})
                    if not commands:
                        self._condition.wait(timeout=0.25)
                        continue
                for command in commands:
                    process.stdin.write(json.dumps(command) + "\n")
                process.stdin.flush()
        except (OSError, subprocess.SubprocessError):
            if not self._closed:
                self.error = "Speaker stream stopped. Restart the camera to restore sounds."
                self.available = False
                LOGGER.warning("Speaker worker failed", exc_info=True)
        finally:
            if process is not None:
                # EOF lets the worker close ALSA and reap aplay before exiting.
                try:
                    process.stdin.close()
                except OSError:
                    pass
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.terminate()
                    try:
                        process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                if process.stderr is not None:
                    detail = process.stderr.read(2000).strip()
                    if detail and not self._closed:
                        LOGGER.warning("Speaker worker: %s", detail)
                    process.stderr.close()
            with self._condition:
                self._process = None

    def close(self) -> None:
        with self._condition:
            self._closed = True
            self._condition.notify()
        self._thread.join(timeout=5)


def _worker() -> int:
    """Tiny line-based command channel; PCM never shares the camera interpreter."""
    player = _PcmStream(simulate=False, volume=0)
    pending = b""
    try:
        while player.available:
            readable, _, _ = select.select([sys.stdin], [], [], 0.1)
            if not readable:
                continue
            data = os.read(sys.stdin.fileno(), 4096)
            if not data:
                return 0
            pending += data
            while b"\n" in pending:
                line, pending = pending.split(b"\n", 1)
                command = json.loads(line)
                if "cue" in command:
                    player.play(command["cue"])
                else:
                    player.configure(command["volume"], command["processing"])
        return 1
    finally:
        player.close()


if __name__ == "__main__" and sys.argv[1:] == ["--worker"]:
    raise SystemExit(_worker())
