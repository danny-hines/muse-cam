from __future__ import annotations

from musecam.display import changed_row_bounds


def test_first_frame_marks_the_full_display_dirty() -> None:
    assert changed_row_bounds(bytes(24), None, row_bytes=6, height=4) == (0, 3)


def test_unchanged_frame_skips_the_framebuffer_write() -> None:
    frame = bytes(range(24))

    assert changed_row_bounds(frame, frame, row_bytes=6, height=4) is None


def test_changed_frame_only_marks_affected_scanlines() -> None:
    previous = bytes(24)
    current = bytearray(previous)
    current[7] = 1
    current[20] = 1

    assert changed_row_bounds(bytes(current), previous, row_bytes=6, height=4) == (1, 3)
