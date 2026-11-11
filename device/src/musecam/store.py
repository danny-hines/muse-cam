from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
from collections import Counter
from collections.abc import Iterable
from pathlib import Path

from .models import CaptureJob, Photo, Preset

# A photo is one original shot. Each row in captures is a version of a photo: a
# style job with its own result. Versions share their photo's original file. An
# Edited version also has an edit recipe, and its source is the image it was
# edited from: the original or another version's result.
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
CREATE TABLE IF NOT EXISTS photos (
    photo_id TEXT PRIMARY KEY,
    source_path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS photos_created_idx ON photos(created_at);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS share_retractions (
    capture_id TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    retry_at REAL NOT NULL DEFAULT 0
);
"""

CAPTURE_FILTERS = {
    "all": "1 = 1",
    "complete": "status = 'complete'",
    "failed": "status = 'failed'",
    "waiting": "status IN ('queued', 'uploading')",
}
# A photo matches a filter when any of its versions does.
PHOTO_FILTERS = {
    key: "1 = 1"
    if key == "all"
    else (
        "EXISTS (SELECT 1 FROM captures WHERE captures.photo_id = photos.photo_id "
        f"AND captures.{condition})"
    )
    for key, condition in CAPTURE_FILTERS.items()
}


def _file_size(path: str) -> int | None:
    try:
        return Path(path).stat().st_size
    except OSError:
        return None


def _file_digest(path: str) -> str | None:
    digest = hashlib.sha256()
    try:
        with open(path, "rb") as file:
            for chunk in iter(lambda: file.read(1 << 20), b""):
                digest.update(chunk)
    except OSError:
        return None
    return digest.hexdigest()


class CaptureStore:
    def __init__(self, database_path: Path) -> None:
        database_path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(database_path, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._connection:
            self._connection.executescript(SCHEMA)
            columns = {
                row["name"] for row in self._connection.execute("PRAGMA table_info(captures)")
            }
            if "preset_name" not in columns:
                self._connection.execute("ALTER TABLE captures ADD COLUMN preset_name TEXT")
            if "photo_id" not in columns:
                self._connection.execute("ALTER TABLE captures ADD COLUMN photo_id TEXT")
            if "edit" not in columns:
                self._connection.execute("ALTER TABLE captures ADD COLUMN edit TEXT")
            self._connection.execute(
                "CREATE INDEX IF NOT EXISTS captures_photo_idx ON captures(photo_id, created_at)"
            )
            # A power loss can interrupt an upload after it is marked in-flight.
            # No request survives a reboot, so make those jobs retryable again.
            self._connection.execute(
                "UPDATE captures SET status = 'queued', "
                "error = 'Interrupted while uploading; queued for retry' "
                "WHERE status = 'uploading'"
            )
        self._link_photos()

    def _link_photos(self) -> None:
        """Give every capture from before photos existed (or from an older release) a photo.

        Restyle and Retry used to copy the original byte for byte into each new entry,
        so captures whose originals are identical files are versions of one photo.
        Only files that share a size with another candidate are hashed.
        """
        rows = self._connection.execute(
            "SELECT capture_id, source_path, created_at FROM captures "
            "WHERE photo_id IS NULL ORDER BY created_at, rowid"
        ).fetchall()
        if not rows:
            return
        existing = self._connection.execute(
            "SELECT photo_id, source_path FROM photos ORDER BY created_at, rowid"
        ).fetchall()
        sizes = {row["source_path"]: _file_size(row["source_path"]) for row in rows}
        wanted = {size for size in sizes.values() if size is not None}
        for photo in existing:
            if photo["source_path"] not in sizes:
                size = _file_size(photo["source_path"])
                sizes[photo["source_path"]] = size if size in wanted else None
        # Count entries, not paths: two captures may name the very same file.
        entries_by_size = Counter(
            sizes[path]
            for path in [
                *(row["source_path"] for row in rows),
                *(photo["source_path"] for photo in existing),
            ]
            if sizes[path] is not None
        )
        digests: dict[str, str | None] = {}

        def file_key(path: str) -> tuple[int, str] | None:
            size = sizes.get(path)
            if size is None or entries_by_size[size] < 2:
                return None
            if path not in digests:
                digests[path] = _file_digest(path)
            return (size, digests[path]) if digests[path] else None

        photo_for_file: dict[tuple[int, str], str] = {}
        for photo in existing:
            if key := file_key(photo["source_path"]):
                photo_for_file.setdefault(key, photo["photo_id"])
        with self._connection:
            for row in rows:
                key = file_key(row["source_path"])
                photo_id = photo_for_file.get(key) if key else None
                if photo_id is None:
                    photo_id = row["capture_id"]
                    self._connection.execute(
                        "INSERT OR IGNORE INTO photos (photo_id, source_path, created_at) "
                        "VALUES (?, ?, ?)",
                        (photo_id, row["source_path"], row["created_at"]),
                    )
                    if key:
                        photo_for_file[key] = photo_id
                self._connection.execute(
                    "UPDATE captures SET photo_id = ? WHERE capture_id = ?",
                    (photo_id, row["capture_id"]),
                )

    def close(self) -> None:
        self._connection.close()

    def add_photo(self, photo_id: str, source_path: Path) -> None:
        """Save an original with no versions, such as a photo taken without a style."""
        with self._lock, self._connection:
            self._connection.execute(
                "INSERT INTO photos (photo_id, source_path) VALUES (?, ?) "
                "ON CONFLICT(photo_id) DO NOTHING",
                (photo_id, str(source_path)),
            )

    def enqueue(
        self,
        capture_id: str,
        preset_id: str,
        source_path: Path,
        photo_id: str | None = None,
    ) -> None:
        """Queue a style job. Without ``photo_id`` it is a new shot and its own photo."""
        with self._lock, self._connection:
            if photo_id is None:
                photo_id = capture_id
                self._connection.execute(
                    "INSERT INTO photos (photo_id, source_path) VALUES (?, ?) "
                    "ON CONFLICT(photo_id) DO NOTHING",
                    (photo_id, str(source_path)),
                )
            self._connection.execute(
                """
                INSERT INTO captures (capture_id, photo_id, preset_id, source_path, status)
                VALUES (?, ?, ?, ?, 'queued')
                ON CONFLICT(capture_id) DO NOTHING
                """,
                (capture_id, photo_id, preset_id, str(source_path)),
            )

    def add_edit(
        self,
        capture_id: str,
        photo_id: str,
        source_path: Path,
        result_path: Path,
        recipe: dict,
    ) -> None:
        """Save a finished Edited version of a photo."""
        with self._lock, self._connection:
            self._connection.execute(
                "INSERT INTO captures (capture_id, photo_id, preset_id, preset_name, "
                "source_path, result_path, status, edit) "
                "VALUES (?, ?, 'edit', 'Edited', ?, ?, 'complete', ?)",
                (capture_id, photo_id, str(source_path), str(result_path), json.dumps(recipe)),
            )

    def update_edit(self, capture_id: str, recipe: dict) -> None:
        self._update(capture_id, "edit = ?", (json.dumps(recipe),))

    def mark_uploading(self, capture_id: str) -> None:
        self._update(capture_id, "status = 'uploading', attempts = attempts + 1, error = NULL")

    def mark_queued(self, capture_id: str, error: str) -> None:
        self._update(capture_id, "status = 'queued', error = ?", (error,))

    def requeue(self, capture_id: str, new_id: str) -> None:
        """Queue a failed version again, in its place among the photo's versions.

        It takes a new ID because the server remembers how the old one ended.
        """
        self._update(
            capture_id,
            "capture_id = ?, status = 'queued', attempts = 0, error = NULL",
            (new_id,),
        )

    def mark_failed(self, capture_id: str, error: str) -> None:
        self._update(capture_id, "status = 'failed', error = ?", (error,))

    def mark_complete(
        self,
        capture_id: str,
        generation_id: str,
        result_path: Path,
        share_url: str | None = None,
        preset_id: str | None = None,
        preset_name: str | None = None,
    ) -> None:
        self._update(
            capture_id,
            "status = 'complete', generation_id = ?, result_path = ?, share_url = ?, error = NULL, "
            "preset_id = COALESCE(?, preset_id), preset_name = COALESCE(?, preset_name)",
            (generation_id, str(result_path), share_url, preset_id, preset_name),
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

    def get_photo(self, photo_id: str) -> Photo | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM photos WHERE photo_id = ?", (photo_id,)
            ).fetchone()
        return self._to_photo(row) if row else None

    def versions(self, photo_ids: Iterable[str]) -> dict[str, list[CaptureJob]]:
        """Each photo's versions, oldest first."""
        ids = list(dict.fromkeys(photo_ids))
        if not ids:
            return {}
        with self._lock:
            rows = self._connection.execute(
                f"SELECT * FROM captures WHERE photo_id IN ({','.join('?' * len(ids))}) "
                "ORDER BY created_at, rowid",
                ids,
            ).fetchall()
        versions: dict[str, list[CaptureJob]] = {photo_id: [] for photo_id in ids}
        for row in rows:
            versions[row["photo_id"]].append(self._to_job(row))
        return versions

    def delete(self, capture_id: str, *, retract_share: bool = False) -> None:
        """Remove one version. Its photo and original stay."""
        with self._lock, self._connection:
            if retract_share:
                self._connection.execute(
                    "INSERT OR IGNORE INTO share_retractions (capture_id) VALUES (?)",
                    (capture_id,),
                )
            self._connection.execute("DELETE FROM captures WHERE capture_id = ?", (capture_id,))

    def delete_photo(self, photo_id: str, *, retract: Iterable[str] = ()) -> None:
        """Remove a photo and all of its versions, queuing share removals for ``retract``."""
        with self._lock, self._connection:
            self._connection.executemany(
                "INSERT OR IGNORE INTO share_retractions (capture_id) VALUES (?)",
                ((capture_id,) for capture_id in retract),
            )
            self._connection.execute("DELETE FROM captures WHERE photo_id = ?", (photo_id,))
            self._connection.execute("DELETE FROM photos WHERE photo_id = ?", (photo_id,))

    def pending_retraction(self) -> str | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT capture_id FROM share_retractions WHERE retry_at <= ? "
                "ORDER BY retry_at, rowid LIMIT 1",
                (time.time(),),
            ).fetchone()
        return row["capture_id"] if row else None

    def retraction_count(self) -> int:
        with self._lock:
            return self._connection.execute("SELECT COUNT(*) FROM share_retractions").fetchone()[0]

    def complete_retraction(self, capture_id: str) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                "DELETE FROM share_retractions WHERE capture_id = ?", (capture_id,)
            )

    def defer_retraction(self, capture_id: str) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                "UPDATE share_retractions SET attempts = attempts + 1, "
                "retry_at = ? + MIN(300, 5 * (1 << MIN(attempts, 6))) WHERE capture_id = ?",
                (time.time(), capture_id),
            )

    def referenced_elsewhere(
        self,
        path: Path,
        *,
        capture_ids: Iterable[str] = (),
        photo_id: str | None = None,
    ) -> bool:
        """Whether any photo or version other than the ones being removed uses ``path``."""
        excluded = list(capture_ids)
        placeholders = ",".join("?" * len(excluded)) or "''"
        with self._lock:
            return (
                self._connection.execute(
                    "SELECT 1 FROM captures WHERE capture_id NOT IN "
                    f"({placeholders}) AND (source_path = ? OR result_path = ?) "
                    "UNION ALL SELECT 1 FROM photos WHERE photo_id IS NOT ? "
                    "AND source_path = ? LIMIT 1",
                    (*excluded, str(path), str(path), photo_id, str(path)),
                ).fetchone()
                is not None
            )

    def pending(self, limit: int = 10) -> list[CaptureJob]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM captures WHERE status = 'queued' "
                "ORDER BY attempts, created_at, rowid LIMIT ?",
                (limit,),
            ).fetchall()
        return [self._to_job(row) for row in rows]

    def photos(self, limit: int = 40, offset: int = 0, status: str = "all") -> list[Photo]:
        if status not in PHOTO_FILTERS:
            raise ValueError("Unknown gallery filter")
        with self._lock:
            rows = self._connection.execute(
                f"SELECT * FROM photos WHERE {PHOTO_FILTERS[status]} "
                "ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?",
                (max(1, min(limit, 100)), max(0, offset)),
            ).fetchall()
        return [self._to_photo(row) for row in rows]

    def counts(self) -> dict[str, int]:
        """Versions by status, which is what the processing queue works through."""
        with self._lock:
            rows = self._connection.execute(
                "SELECT status, COUNT(*) AS count FROM captures GROUP BY status"
            ).fetchall()
        return {row["status"]: row["count"] for row in rows}

    def photo_counts(self) -> dict[str, int]:
        """Photos matching each gallery filter."""
        with self._lock:
            row = self._connection.execute(
                "SELECT "
                + ", ".join(
                    f'COALESCE(SUM({condition}), 0) AS "{key}"'
                    for key, condition in PHOTO_FILTERS.items()
                )
                + " FROM photos"
            ).fetchone()
        return {key: row[key] for key in PHOTO_FILTERS}

    def photo_neighbors(self, photo_id: str, status: str = "all") -> dict[str, str | None]:
        if status not in PHOTO_FILTERS:
            raise ValueError("Unknown gallery filter")
        with self._lock:
            current = self._connection.execute(
                "SELECT created_at, rowid FROM photos WHERE photo_id = ?", (photo_id,)
            ).fetchone()
            if current is None:
                return {"previousId": None, "nextId": None}
            result = {}
            for key, comparison, order in (("previousId", ">", "ASC"), ("nextId", "<", "DESC")):
                row = self._connection.execute(
                    f"SELECT photo_id FROM photos WHERE {PHOTO_FILTERS[status]} "
                    f"AND (created_at, rowid) {comparison} (?, ?) "
                    f"ORDER BY created_at {order}, rowid {order} LIMIT 1",
                    (current["created_at"], current["rowid"]),
                ).fetchone()
                result[key] = row["photo_id"] if row else None
            return result

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
        """Drop old finished versions (and photos left without one) for the native app.

        Returns the files nothing else uses any more.
        """
        with self._lock, self._connection:
            rows = self._connection.execute(
                """
                SELECT capture_id, photo_id, source_path, result_path
                FROM captures
                WHERE status IN ('complete', 'failed')
                ORDER BY updated_at DESC, capture_id DESC
                LIMIT -1 OFFSET ?
                """,
                (max(0, keep),),
            ).fetchall()
            if not rows:
                return []
            self._connection.executemany(
                "DELETE FROM captures WHERE capture_id = ?",
                ((row["capture_id"],) for row in rows),
            )
            photo_ids = list(dict.fromkeys(row["photo_id"] for row in rows if row["photo_id"]))
            emptied = (
                self._connection.execute(
                    "SELECT photo_id, source_path FROM photos WHERE photo_id IN "
                    f"({','.join('?' * len(photo_ids))}) AND NOT EXISTS "
                    "(SELECT 1 FROM captures WHERE captures.photo_id = photos.photo_id)",
                    photo_ids,
                ).fetchall()
                if photo_ids
                else []
            )
            self._connection.executemany(
                "DELETE FROM photos WHERE photo_id = ?",
                ((row["photo_id"],) for row in emptied),
            )
            candidates: list[str] = []
            for row in rows:
                candidates.append(row["source_path"])
                if row["result_path"]:
                    candidates.append(row["result_path"])
            candidates.extend(row["source_path"] for row in emptied)
            unused = []
            for path in dict.fromkeys(candidates):
                in_use = self._connection.execute(
                    "SELECT 1 FROM captures WHERE source_path = ? OR result_path = ? "
                    "UNION ALL SELECT 1 FROM photos WHERE source_path = ? LIMIT 1",
                    (path, path, path),
                ).fetchone()
                if in_use is None:
                    unused.append(Path(path))
        return unused

    @staticmethod
    def _to_photo(row: sqlite3.Row) -> Photo:
        return Photo(
            photo_id=row["photo_id"],
            source_path=Path(row["source_path"]),
            created_at=row["created_at"],
        )

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
            preset_name=row["preset_name"],
            photo_id=row["photo_id"],
            edit=json.loads(row["edit"]) if row["edit"] else None,
        )
