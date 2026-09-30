from __future__ import annotations

import sqlite3
from pathlib import Path

from musecam.models import Preset
from musecam.store import CaptureStore


def test_capture_lifecycle_and_preset_cache(tmp_path: Path) -> None:
    store = CaptureStore(tmp_path / "musecam.sqlite3")
    source = tmp_path / "capture.jpg"
    result = tmp_path / "result.jpg"
    preset = Preset("storybook", 1, "Bedtime Legend", "Painted storybook", "#6657de")
    try:
        store.save_presets([preset])
        assert store.load_presets() == [preset]

        store.enqueue("capture_0001", preset.id, source)
        assert [job.capture_id for job in store.pending()] == ["capture_0001"]

        store.mark_uploading("capture_0001")
        uploading = store.get("capture_0001")
        assert uploading is not None
        assert uploading.status == "uploading"
        assert uploading.attempts == 1

        store.mark_queued("capture_0001", "network unavailable")
        assert store.pending()[0].error == "network unavailable"

        store.mark_complete("capture_0001", "generation_1", result)
        complete = store.get("capture_0001")
        assert complete is not None
        assert complete.status == "complete"
        assert complete.result_path == result

        store.mark_shared("capture_0001", "https://camera.example/p/share")
        assert store.get("capture_0001").share_url == "https://camera.example/p/share"  # type: ignore[union-attr]
        assert store.pending() == []

        second_source = tmp_path / "capture-2.jpg"
        second_result = tmp_path / "result-2.jpg"
        store.enqueue("capture_0002", preset.id, second_source)
        store.mark_complete("capture_0002", "generation_2", second_result)
        pruned = store.prune_finished(keep=1)
        assert pruned == [source, result]
        assert store.get("capture_0001") is None
        assert store.get("capture_0002") is not None
    finally:
        store.close()


def test_interrupted_upload_is_recovered_on_startup(tmp_path: Path) -> None:
    database = tmp_path / "musecam.sqlite3"
    first = CaptureStore(database)
    first.enqueue("capture_0001", "storybook", tmp_path / "capture.jpg")
    first.mark_uploading("capture_0001")
    first.close()

    recovered = CaptureStore(database)
    try:
        pending = recovered.pending()
        assert len(pending) == 1
        assert pending[0].status == "queued"
        assert pending[0].attempts == 1
        assert pending[0].error == "Interrupted while uploading; queued for retry"
    finally:
        recovered.close()


def test_share_retraction_survives_deletion_retry_and_restart(tmp_path, monkeypatch):
    database = tmp_path / "musecam.sqlite3"
    store = CaptureStore(database)
    store.enqueue("capture-delete", "storybook", tmp_path / "source.jpg")
    store.delete("capture-delete", retract_share=True)
    assert store.get("capture-delete") is None
    assert store.pending_retraction() == "capture-delete"
    store.defer_retraction("capture-delete")
    assert store.pending_retraction() is None
    store.close()

    recovered = CaptureStore(database)
    try:
        assert recovered.retraction_count() == 1
        monkeypatch.setattr("musecam.store.time.time", lambda: 99999999999)
        assert recovered.pending_retraction() == "capture-delete"
        recovered.complete_retraction("capture-delete")
        assert recovered.retraction_count() == 0
    finally:
        recovered.close()


def test_surprise_photos_keep_the_style_the_server_used(tmp_path: Path) -> None:
    database = tmp_path / "musecam.sqlite3"
    # A database from before the style-name column existed.
    connection = sqlite3.connect(database)
    connection.execute(
        "CREATE TABLE captures (capture_id TEXT PRIMARY KEY, preset_id TEXT NOT NULL, "
        "source_path TEXT NOT NULL, result_path TEXT, generation_id TEXT, status TEXT NOT NULL, "
        "attempts INTEGER NOT NULL DEFAULT 0, error TEXT, share_url TEXT, "
        "created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "
        "updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    )
    connection.execute(
        "INSERT INTO captures (capture_id, preset_id, source_path, status) "
        "VALUES ('old', 'storybook', 'old.jpg', 'complete')"
    )
    connection.commit()
    connection.close()

    store = CaptureStore(database)
    try:
        assert store.get("old").preset_name is None  # type: ignore[union-attr]
        store.enqueue("surprise", "surprise", tmp_path / "capture.jpg")
        store.mark_complete(
            "surprise", "generation_1", tmp_path / "result.jpg",
            preset_id="muse-mode", preset_name="Muse Mode",
        )
        job = store.get("surprise")
        assert (job.preset_id, job.preset_name) == ("muse-mode", "Muse Mode")  # type: ignore[union-attr]
        store.enqueue("plain", "storybook", tmp_path / "plain.jpg")
        store.mark_complete("plain", "generation_2", tmp_path / "plain-result.jpg")
        assert store.get("plain").preset_id == "storybook"  # type: ignore[union-attr]
    finally:
        store.close()

