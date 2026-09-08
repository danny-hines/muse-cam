from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Iterable
from pathlib import Path

from .models import CaptureJob, Preset

SCHEMA = """
CREATE TABLE IF NOT EXISTS captures (
    capture_id TEXT PRIMARY KEY,
    preset_id TEXT NOT NULL,
    source_path TEXT NOT NULL,
    result_path TEXT,
    generation_id TEXT,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    share_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS captures_status_created_idx ON captures(status, created_at);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class CaptureStore:
    def __init__(self, database_path: Path) -> None:
        database_path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(database_path, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._connection:
            self._connection.executescript(SCHEMA)
            # A power loss can interrupt an upload after it is marked in-flight.
            # No request survives a reboot, so make those jobs retryable again.
            self._connection.execute(
                "UPDATE captures SET status = 'queued', "
                "error = 'Interrupted while uploading; queued for retry' "
                "WHERE status = 'uploading'"
            )

    def close(self) -> None:
        self._connection.close()

    def enqueue(self, capture_id: str, preset_id: str, source_path: Path) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                """
                INSERT INTO captures (capture_id, preset_id, source_path, status)
                VALUES (?, ?, ?, 'queued')
                ON CONFLICT(capture_id) DO NOTHING
                """,
                (capture_id, preset_id, str(source_path)),
            )

    def mark_uploading(self, capture_id: str) -> None:
        self._update(capture_id, "status = 'uploading', attempts = attempts + 1, error = NULL")

    def mark_queued(self, capture_id: str, error: str) -> None:
        self._update(capture_id, "status = 'queued', error = ?", (error,))

    def mark_failed(self, capture_id: str, error: str) -> None:
        self._update(capture_id, "status = 'failed', error = ?", (error,))

    def mark_complete(
        self,
        capture_id: str,
        generation_id: str,
        result_path: Path,
        share_url: str | None = None,
    ) -> None:
        self._update(
            capture_id,
            "status = 'complete', generation_id = ?, result_path = ?, share_url = ?, error = NULL",
            (generation_id, str(result_path), share_url),
        )

    def mark_shared(self, capture_id: str, share_url: str) -> None:
        self._update(capture_id, "share_url = ?", (share_url,))

    def _update(self, capture_id: str, assignment: str, params: tuple[object, ...] = ()) -> None:
        with self._lock, self._connection:
            query = (
                f"UPDATE captures SET {assignment}, updated_at = CURRENT_TIMESTAMP "
                "WHERE capture_id = ?"
            )
            self._connection.execute(
                query,
                (*params, capture_id),
            )

    def get(self, capture_id: str) -> CaptureJob | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM captures WHERE capture_id = ?", (capture_id,)
            ).fetchone()
        return self._to_job(row) if row else None

    def pending(self, limit: int = 10) -> list[CaptureJob]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM captures WHERE status = 'queued' "
                "ORDER BY attempts, created_at, rowid LIMIT ?",
                (limit,),
            ).fetchall()
        return [self._to_job(row) for row in rows]

    def gallery(self, limit: int = 40, offset: int = 0, status: str = "all") -> list[CaptureJob]:
        filters = {
            "all": "",
            "complete": "WHERE status = 'complete'",
            "failed": "WHERE status = 'failed'",
            "waiting": "WHERE status IN ('queued', 'uploading')",
        }
        if status not in filters:
            raise ValueError("Unknown gallery filter")
        with self._lock:
            rows = self._connection.execute(
                f"SELECT * FROM captures {filters[status]} "
                "ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?",
                (max(1, min(limit, 100)), max(0, offset)),
            ).fetchall()
        return [self._to_job(row) for row in rows]

    def counts(self) -> dict[str, int]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT status, COUNT(*) AS count FROM captures GROUP BY status"
            ).fetchall()
        return {row["status"]: row["count"] for row in rows}

    def setting(self, key: str, default: object = None) -> object:
        with self._lock:
            row = self._connection.execute(
                "SELECT value FROM settings WHERE key = ?", (key,)
            ).fetchone()
        return json.loads(row["value"]) if row else default

    def set_setting(self, key: str, value: object) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, json.dumps(value)),
            )

    def save_presets(self, presets: Iterable[Preset]) -> None:
        value = json.dumps([preset.__dict__ for preset in presets], separators=(",", ":"))
        with self._lock, self._connection:
            self._connection.execute(
                "INSERT INTO settings (key, value) VALUES ('presets', ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (value,),
            )

    def load_presets(self) -> list[Preset]:
        with self._lock:
            row = self._connection.execute(
                "SELECT value FROM settings WHERE key = 'presets'"
            ).fetchone()
        if not row:
            return []
        return [Preset(**value) for value in json.loads(row["value"])]

    def prune_finished(self, keep: int = 100) -> list[Path]:
        with self._lock, self._connection:
            rows = self._connection.execute(
                """
                SELECT capture_id, source_path, result_path
                FROM captures
                WHERE status IN ('complete', 'failed')
                ORDER BY updated_at DESC, capture_id DESC
                LIMIT -1 OFFSET ?
                """,
                (max(0, keep),),
            ).fetchall()
            if rows:
                self._connection.executemany(
                    "DELETE FROM captures WHERE capture_id = ?",
                    ((row["capture_id"],) for row in rows),
                )
        paths: list[Path] = []
        for row in rows:
            paths.append(Path(row["source_path"]))
            if row["result_path"]:
                paths.append(Path(row["result_path"]))
        return paths

    @staticmethod
    def _to_job(row: sqlite3.Row) -> CaptureJob:
        return CaptureJob(
            capture_id=row["capture_id"],
            preset_id=row["preset_id"],
            source_path=Path(row["source_path"]),
            result_path=Path(row["result_path"]) if row["result_path"] else None,
            generation_id=row["generation_id"],
            status=row["status"],
            attempts=row["attempts"],
            error=row["error"],
            share_url=row["share_url"],
            created_at=row["created_at"],
        )
