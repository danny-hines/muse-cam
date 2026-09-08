from __future__ import annotations

import io
import struct
import wave

import pytest

from musecam.audio import CUES, SoundPlayer, sound_wave


def test_muting_and_pcm_level_limits() -> None:
    for cue in CUES:
        with wave.open(io.BytesIO(sound_wave(cue, 100))) as wav:
            assert wav.getnchannels() == 2
            assert wav.getframerate() == 48000
            data = wav.readframes(wav.getnframes())
            samples = struct.unpack(f"<{len(data) // 2}h", data)
            assert 0 < max(abs(x) for x in samples) < 32767
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
