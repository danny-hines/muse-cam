import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite, types } from "@electric-sql/pglite";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { NeonPhotoRepository } from "./neon";

vi.mock("@/db/client", () => ({ getDb: vi.fn() }));

const migrationsDir = new URL("../../../drizzle/", import.meta.url);
let migrationFiles: string[] = [];
const databases: PGlite[] = [];

beforeAll(async () => {
  migrationFiles = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
});

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

async function migrate(postgres: PGlite, files: string[]) {
  for (const file of files) await postgres.exec(await readFile(new URL(file, migrationsDir), "utf8"));
}

async function database(files = migrationFiles) {
  const postgres = await PGlite.create();
  databases.push(postgres);
  await migrate(postgres, files);
  return postgres;
}

describe("event backfill migration", () => {
  const backfill = "0003_require_photo_event.sql";

  async function beforeBackfill() {
    expect(migrationFiles).toContain(backfill);
    return database(migrationFiles.slice(0, migrationFiles.indexOf(backfill)));
  }

  async function seed(postgres: PGlite) {
    await postgres.exec(`
      INSERT INTO events (id, slug, name, publish_originals, auto_share, created_at, updated_at)
        VALUES ('nyc', 'sei-nyc', 'SEI NYC Offsite', true, true, now(), now());
      INSERT INTO devices (id, name, token_hash, event_id, created_at, updated_at) VALUES
        ('muse-cam-01', 'muse-cam-01', 'hash-1', 'nyc', now(), now()),
        ('muse-cam-02', 'muse-cam-02', 'hash-2', NULL, now(), now());
      INSERT INTO photos (id, capture_id, device_id, event_id, preset_id, preset_version, status, created_at, updated_at, shared_at, public_slug) VALUES
        ('event-photo', 'c1', 'muse-cam-01', 'nyc', 'kid-drawing', 1, 'complete', now(), now(), now(), 'event-slug'),
        ('shared-loose', 'c2', 'muse-cam-02', NULL, 'kid-drawing', 1, 'complete', now(), now(), now(), 'loose-slug'),
        ('private-loose', 'c3', 'muse-cam-02', NULL, 'kid-drawing', 1, 'complete', now(), now(), NULL, NULL);
    `);
  }

  async function eventOf(postgres: PGlite, table: "photos" | "devices", id: string) {
    const { rows } = await postgres.query<{ slug: string }>(
      `SELECT e.slug FROM ${table} t JOIN events e ON e.id = t.event_id WHERE t.id = $1`, [id],
    );
    return rows[0]?.slug ?? null;
  }

  it("moves unassigned photos and cameras into danny-personal with their previous sharing behavior", async () => {
    const postgres = await beforeBackfill();
    await seed(postgres);

    await migrate(postgres, [backfill]);

    const { rows } = await postgres.query("SELECT slug, name, auto_share, publish_originals FROM events ORDER BY slug");
    expect(rows).toEqual([
      { slug: "danny-personal", name: "Danny Personal", auto_share: false, publish_originals: false },
      { slug: "sei-nyc", name: "SEI NYC Offsite", auto_share: true, publish_originals: true },
    ]);
    expect(await eventOf(postgres, "photos", "shared-loose")).toBe("danny-personal");
    expect(await eventOf(postgres, "photos", "private-loose")).toBe("danny-personal");
    expect(await eventOf(postgres, "photos", "event-photo")).toBe("sei-nyc");
    expect(await eventOf(postgres, "devices", "muse-cam-02")).toBe("danny-personal");
    expect(await eventOf(postgres, "devices", "muse-cam-01")).toBe("sei-nyc");
    const shared = await postgres.query("SELECT public_slug, shared_at IS NOT NULL AS shared FROM photos WHERE id = 'shared-loose'");
    expect(shared.rows).toEqual([{ public_slug: "loose-slug", shared: true }]);
  });

  it("requires an event on every new photo and keeps events with photos from being deleted", async () => {
    const postgres = await beforeBackfill();
    await seed(postgres);
    await migrate(postgres, [backfill]);

    await expect(postgres.exec(`
      INSERT INTO photos (id, capture_id, device_id, event_id, preset_id, preset_version, created_at, updated_at)
      VALUES ('no-event', 'c4', 'muse-cam-01', NULL, 'kid-drawing', 1, now(), now())
    `)).rejects.toThrow(/null value in column "event_id"/);
    await expect(postgres.exec("DELETE FROM events WHERE slug = 'sei-nyc'")).rejects.toThrow(/foreign key/);
  });

  it("reuses an existing danny-personal event", async () => {
    const postgres = await beforeBackfill();
    await seed(postgres);
    await postgres.exec(`
      INSERT INTO events (id, slug, name, publish_originals, auto_share, created_at, updated_at)
      VALUES ('existing', 'danny-personal', 'Already here', false, true, now(), now())
    `);

    await migrate(postgres, [backfill]);

    const { rows } = await postgres.query("SELECT id, name FROM events WHERE slug = 'danny-personal'");
    expect(rows).toEqual([{ id: "existing", name: "Already here" }]);
    expect(await eventOf(postgres, "photos", "private-loose")).toBe("danny-personal");
  });

  it("does not create a personal event on a new database", async () => {
    const postgres = await database();
    const { rows } = await postgres.query("SELECT slug FROM events");
    expect(rows).toEqual([]);
  });
});

describe("Neon event galleries", () => {
  const repository = new NeonPhotoRepository();

  async function connect() {
    const postgres = await database();
    // Keep the production Drizzle HTTP driver, but execute its SQL against isolated Postgres.
    const client = {
      query: (query: string, params: unknown[], options: { arrayMode: boolean }) =>
        postgres.query(query, params, {
          rowMode: options.arrayMode ? "array" : "object",
          parsers: { [types.TIMESTAMPTZ]: (value) => value },
        }),
    } as unknown as NeonQueryFunction<false, false>;
    vi.mocked(getDb).mockReturnValue(drizzle(client, { schema }));
    await postgres.exec(`
      INSERT INTO events (id, slug, name, created_at, updated_at) VALUES
        ('seattle', 'seattle', 'Seattle', now(), now()),
        ('menlo', 'menlo-park', 'Menlo Park', now(), now());
    `);
    return postgres;
  }

  // Share times are pinned so ordering does not depend on test speed.
  async function shared(postgres: PGlite, eventId: string, sharedAt: string, id = randomUUID()) {
    await repository.create({
      id, captureId: id, deviceId: "camera", eventId, presetId: "kid-drawing", presetVersion: 1,
      capturedAtDevice: null,
    });
    await repository.markComplete(id, {
      originalPrivateRef: "original", resultPrivateRef: "result", resultMimeType: "image/jpeg", width: 1, height: 1,
    });
    const photo = await repository.markShared(id, id, `https://example.test/${id}.jpg`);
    await postgres.query("UPDATE photos SET shared_at = $2 WHERE id = $1", [id, sharedAt]);
    return photo;
  }

  it("lists and navigates only within a photo's event", async () => {
    const postgres = await connect();
    const first = await shared(postgres, "seattle", "2026-10-01T10:00:00Z");
    const other = await shared(postgres, "menlo", "2026-10-01T10:01:00Z");
    const second = await shared(postgres, "seattle", "2026-10-01T10:02:00Z");

    expect((await repository.listShared("seattle")).map(({ id }) => id)).toEqual([second.id, first.id]);
    expect((await repository.listShared("menlo")).map(({ id }) => id)).toEqual([other.id]);
    expect(await repository.findSharedNeighbors(second.publicSlug!)).toEqual({
      previousSlug: null, nextSlug: first.publicSlug,
    });
    expect(await repository.findSharedNeighbors(first.publicSlug!)).toEqual({
      previousSlug: second.publicSlug, nextSlug: null,
    });
    expect(await repository.findSharedNeighbors(other.publicSlug!)).toEqual({ previousSlug: null, nextSlug: null });
  });
});
