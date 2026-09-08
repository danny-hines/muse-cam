from __future__ import annotations

import io
import json
import struct
import time
import wave

import pytest

from musecam import audio
from musecam.audio import CUES, SILENCE, PcmMixer, SoundPlayer, _PcmStream, sound_wave


def test_muting_and_pcm_level_limits() -> None:
    for cue in CUES:
        with wave.open(io.BytesIO(sound_wave(cue, 100))) as wav:
            assert wav.getnchannels() == 2
            assert wav.getframerate() == 48000
            data = wav.readframes(wav.getnframes())
            samples = struct.unpack(f"<{len(data) // 2}h", data)
            assert 0 < max(abs(x) for x in samples) < 32767
            assert samples[:2] == samples[-2:] == (0, 0)
        with wave.open(io.BytesIO(sound_wave(cue, 0))) as wav:
            assert set(wav.readframes(wav.getnframes())) == {0}
    with pytest.raises(ValueError):
        sound_wave("unknown", 30)


def test_simulator_never_plays_system_audio() -> None:
    sound = SoundPlayer(simulate=True)
    try:
        sound.play("shutter")
        sound.configure(0, False)
        sound.play("processing")
        assert not sound.available
        assert not sound._queue
        assert sound._process is None
    finally:
        sound.close()


def test_mixer_silence_and_soft_mute() -> None:
    mixer = PcmMixer()
    assert mixer.render(35, True) == SILENCE
    mixer.start("success")
    assert mixer.render(100, True) != SILENCE
    muted = mixer.render(0, True)
    assert len(muted) == len(SILENCE)
    assert any(muted[: 240 * 4])  # Fade an active cue instead of cutting it off.
    assert not any(muted[240 * 4 :])
    assert mixer.cue is None
    assert mixer.render(100, True) == SILENCE  # Unmute does not replay it.


def test_processing_toggle_and_complete_cues() -> None:
    mixer = PcmMixer()
    mixer.start("processing")
    assert mixer.render(100, False) == SILENCE
    assert mixer.cue is None
    for cue in CUES - {"processing"}:
        mixer.start(cue)
        blocks = []
        while mixer.cue:
            blocks.append(mixer.render(100, False))
        assert all(len(block) == len(SILENCE) for block in blocks)
        assert any(any(block) for block in blocks)
        assert mixer.render(100, True) == SILENCE


def wait_until(predicate) -> None:
    deadline = time.monotonic() + 3
    while not predicate():
        assert time.monotonic() < deadline, "Audio worker did not reach expected state"
        time.sleep(0.005)


class FakeStream:
    def __init__(self, process) -> None:
        self.process = process
        self.blocks = []
        self.fail = False

    def write(self, payload):
        time.sleep(0.002)  # Model hardware backpressure without a real sound device.
        if self.fail or self.process.stopped:
            raise BrokenPipeError("stream disconnected")
        self.blocks.append(bytes(payload))
        return len(payload)

    def close(self):
        pass


class FakeProcess:
    def __init__(self):
        self.stopped = False
        self.terminations = 0
        self.stdin = FakeStream(self)
        self.stderr = io.BytesIO()

    def poll(self):
        return 0 if self.stopped else None

    def terminate(self):
        self.terminations += 1
        self.stopped = True

    def wait(self, timeout=None):
        assert self.stopped
        return 0


def test_one_pcm_stream_survives_cues_idle_and_mute(monkeypatch) -> None:
    processes = []

    def spawn(command, **kwargs):
        assert command[command.index("-t") + 1] == "raw"
        assert command[command.index("-r") + 1] == "48000"
        process = FakeProcess()
        processes.append(process)
        return process

    monkeypatch.setattr(audio, "_device_available", lambda: True)
    monkeypatch.setattr(audio.subprocess, "Popen", spawn)
    sound = _PcmStream(simulate=False)
    try:
        wait_until(lambda: processes and len(processes[0].stdin.blocks) >= 15)
        stream = processes[0].stdin
        assert all(block == SILENCE for block in stream.blocks)
        for cue in ("success", "shutter", "error"):
            before = len(stream.blocks)
            sound.play(cue)
            wait_until(lambda before=before: any(any(block) for block in stream.blocks[before:]))
            wait_until(lambda: sound._mixer.cue is None)
        sound.configure(0, False)
        before = len(stream.blocks)
        sound.play("shutter")
        wait_until(lambda: len(stream.blocks) > before + 5)
        assert all(block == SILENCE for block in stream.blocks[before + 1 :])
        sound.configure(35, True)
        before = len(stream.blocks)
        sound.play("success")
        wait_until(lambda: any(any(block) for block in stream.blocks[before:]))
        assert len(processes) == 1
        assert processes[0].terminations == 0
        assert all(len(block) == len(SILENCE) for block in stream.blocks)
        assert sound.error is None
    finally:
        sound.close()
    assert processes[0].stopped
    assert not sound._thread.is_alive()


def test_failed_stream_stays_closed_instead_of_repeatedly_popping(monkeypatch) -> None:
    processes = []

    def spawn(*args, **kwargs):
        process = FakeProcess()
        process.stdin.fail = True
        processes.append(process)
        return process

    monkeypatch.setattr(audio, "_device_available", lambda: True)
    monkeypatch.setattr(audio.subprocess, "Popen", spawn)
    sound = _PcmStream(simulate=False)
    try:
        wait_until(lambda: not sound._thread.is_alive())
        assert not sound.available
        assert sound.error
        sound.play("shutter")
        sound.configure(100, True)
        assert not sound._queue
        assert len(processes) == 1
        assert processes[0].stopped
    finally:
        sound.close()


@pytest.mark.parametrize("worker_failure", [False, True])
def test_camera_delegates_audio_to_an_independent_interpreter(monkeypatch, worker_failure) -> None:
    commands = []
    processes = []

    class CommandPipe:
        def write(self, line):
            commands.append(json.loads(line))

        def flush(self):
            pass

        def close(self):
            processes[0].stopped = True

    def spawn(command, **kwargs):
        assert command == [audio.sys.executable, "-m", "musecam.audio", "--worker"]
        process = FakeProcess()
        process.stdin = CommandPipe()
        process.stderr = io.StringIO()
        processes.append(process)
        return process

    monkeypatch.setattr(audio, "_device_available", lambda: True)
    monkeypatch.setattr(audio.subprocess, "Popen", spawn)
    sound = SoundPlayer(simulate=False)
    try:
        wait_until(lambda: {"volume": 35, "processing": True} in commands)
        sound.play("shutter")
        wait_until(lambda: {"cue": "shutter"} in commands)
        sound.configure(0, False)
        wait_until(lambda: {"volume": 0, "processing": False} in commands)
        sound.configure(50, True)
        wait_until(lambda: {"volume": 50, "processing": True} in commands)
        assert len(processes) == 1
        assert not processes[0].stopped
        if worker_failure:
            processes[0].stopped = True
            wait_until(lambda: not sound._thread.is_alive())
            assert not sound.available
            assert sound.error
            sound.play("shutter")
            assert not sound._queue
    finally:
        sound.close()
    assert processes[0].stopped
    assert not sound._thread.is_alive()
