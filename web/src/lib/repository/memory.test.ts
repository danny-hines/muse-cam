import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { MemoryPhotoRepository } from "./memory";

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
