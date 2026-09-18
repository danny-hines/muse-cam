import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryPhotoRepository } from "./memory";

afterEach(() => vi.useRealTimers());

async function sharedPhoto(repository: MemoryPhotoRepository, eventId: string | null, id: string = randomUUID()) {
  await repository.create({
    id, captureId: id, deviceId: "camera", eventId,
    presetId: "kid-drawing", presetVersion: 1, capturedAtDevice: null,
  });
  await repository.markComplete(id, {
    originalPrivateRef: "private-original", resultPrivateRef: "private-result",
    resultMimeType: "image/jpeg", width: 1200, height: 900,
  });
  return repository.markShared(id, id, `https://example.test/${id}.jpg`);
}

describe("event galleries", () => {
  it("filters by saved event before limiting and omits private, failed, and retracted photos", async () => {
    const repository = new MemoryPhotoRepository();
    const eventId = randomUUID();
    const otherEventId = randomUUID();
    async function photo(event: string | null, shared = true) {
      const id = randomUUID();
      await repository.create({
        id, captureId: id, deviceId: "camera", eventId: event,
        presetId: "kid-drawing", presetVersion: 1, capturedAtDevice: null,
      });
      await repository.markComplete(id, {
        originalPrivateRef: "private-original", resultPrivateRef: "private-result",
        resultMimeType: "image/jpeg", width: 1200, height: 900,
      });
      if (shared) await repository.markShared(id, id, `https://example.test/${id}.jpg`);
      return id;
    }
    const first = await photo(eventId);
    const second = await photo(eventId);
    await photo(eventId, false);
    const failed = await photo(eventId);
    await repository.markFailed(failed, "test-error");
    const retracted = await photo(eventId);
    await repository.markUnshared(retracted);
    const unassigned = await photo(null);
    for (let index = 0; index < 65; index++) await photo(otherEventId);

    const eventPhotos = await repository.listShared(60, eventId);
    expect(eventPhotos.map(({ id }) => id).sort()).toEqual([first, second].sort());
    expect(await repository.listShared(60, randomUUID())).toEqual([]);
    expect((await repository.listShared(100, null)).map(({ id }) => id)).toContain(unassigned);
    expect((await repository.listShared(100, null)).every((record) => record.eventId === null)).toBe(true);
    expect(await repository.listShared(60, otherEventId)).toHaveLength(60);
  });
});

describe("photo navigation", () => {
  it("navigates beyond the first 60 photos with stable order and stops at both ends", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T12:00:00Z"));
    const repository = new MemoryPhotoRepository();
    const eventId = randomUUID();
    const ids = [];
    for (let i = 0; i < 65; i++) {
      const id = `${eventId}-${String(i).padStart(3, "0")}`;
      await sharedPhoto(repository, eventId, id);
      ids.push(id);
    }
    expect((await repository.listShared(3, eventId)).map((photo) => photo.id)).toEqual(ids.slice(-3).reverse());
    expect(await repository.findSharedNeighbors(ids[64])).toEqual({ previousSlug: null, nextSlug: ids[63] });
    expect(await repository.findSharedNeighbors(ids[2])).toEqual({ previousSlug: ids[3], nextSlug: ids[1] });
    expect(await repository.findSharedNeighbors(ids[0])).toEqual({ previousSlug: ids[1], nextSlug: null });
  });

  it("skips other events, private, failed, and deleted photos while allowing public roll navigation", async () => {
    vi.useFakeTimers();
    const repository = new MemoryPhotoRepository();
    const eventId = randomUUID();
    let time = new Date("2099-09-18T12:00:00Z").getTime();
    async function add(event: string | null = eventId) {
      vi.setSystemTime(time += 1000);
      return sharedPhoto(repository, event);
    }
    const oldest = await add();
    const hidden = await add();
    await repository.markUnshared(hidden.id);
    const failed = await add();
    await repository.markFailed(failed.id, "test");
    const deleted = await add();
    await repository.delete(deleted.id);
    const otherEvent = await add(randomUUID());
    const unassigned = await add(null);
    const newest = await add();

    expect(await repository.findSharedNeighbors(newest.publicSlug!)).toEqual({ previousSlug: null, nextSlug: oldest.publicSlug });
    expect(await repository.findSharedNeighbors(oldest.publicSlug!)).toEqual({ previousSlug: newest.publicSlug, nextSlug: null });
    expect(await repository.findSharedNeighbors(newest.publicSlug!, false)).toEqual({ previousSlug: null, nextSlug: unassigned.publicSlug });
    expect(await repository.findSharedNeighbors(unassigned.publicSlug!)).toEqual({ previousSlug: newest.publicSlug, nextSlug: otherEvent.publicSlug });
    for (const photo of [hidden, failed, deleted]) {
      expect(await repository.findSharedNeighbors(photo.publicSlug!)).toEqual({ previousSlug: null, nextSlug: null });
    }
    expect(await repository.findSharedNeighbors("missing")).toEqual({ previousSlug: null, nextSlug: null });
    expect(await repository.findSharedNeighbors(otherEvent.publicSlug!)).toEqual({ previousSlug: null, nextSlug: null });
  });
});
