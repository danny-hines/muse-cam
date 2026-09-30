import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { eventPresets, getPreset, type Preset } from "@/config/presets";
import { ImageModelError } from "@/lib/model/errors";
import { getFleetRepository } from "@/lib/fleet";
import { getPhotoRepository } from "@/lib/repository";
import { POST } from "./route";

const auth = vi.hoisted(() => ({ deviceId: "", eventId: null as string | null }));
const transform = vi.hoisted(() => vi.fn());
vi.mock("@/lib/device-auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/device-auth")>(),
  authenticateDevice: vi.fn(async () => ({ ...auth })),
}));
vi.mock("@/lib/runtime-config", () => ({ deviceApiIsAvailable: () => true }));
vi.mock("@/lib/model/image", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/model/image")>(),
  normalizeInputImage: vi.fn(async () => Buffer.from("normalized test image")),
}));
vi.mock("@/lib/model", () => ({ getImageModelProvider: () => ({ transform }) }));
vi.mock("@/lib/fleet", async () => {
  const { MemoryFleetRepository } = await import("@/lib/fleet/memory");
  const repository = new MemoryFleetRepository();
  return { getFleetRepository: () => repository };
});
vi.mock("@/lib/repository", async () => {
  const { MemoryPhotoRepository } = await import("@/lib/repository/memory");
  const repository = new MemoryPhotoRepository();
  return { getPhotoRepository: () => repository, hasPersistentDatabase: () => false };
});
vi.mock("@/lib/media", async () => {
  const { MemoryMediaStore } = await import("@/lib/media/memory");
  const media = new MemoryMediaStore();
  return { getMediaStore: () => media };
});

const special = eventPresets[0];

beforeEach(() => {
  auth.deviceId = randomUUID();
  transform.mockReset().mockResolvedValue({
    bytes: Buffer.from("transformed test image"), contentType: "image/jpeg", width: 320, height: 240,
  });
});

const filtered = () => new ImageModelError("content_filtered", "filtered", 400);
const triedIds = () => transform.mock.calls.map(([input]) => (input.preset as Preset).id);

async function assign(presetIds: string[] | null) {
  const event = await getFleetRepository().createEvent({
    id: randomUUID(), slug: randomUUID(), name: "Event", publishOriginals: false, presetIds,
  });
  auth.eventId = event.id;
}

function upload(presetId: string, captureId = randomUUID()) {
  const form = new FormData();
  form.set("capture_id", captureId);
  form.set("preset_id", presetId);
  form.set("image", new File(["test-image"], "image.jpg", { type: "image/jpeg" }));
  return POST(new Request("https://camera.test/api/device/generations", { method: "POST", body: form }));
}

describe("event styles at upload", () => {
  it("generates an event-only style for an event that enables it", async () => {
    await assign([special.id]);
    const response = await upload(special.id);
    expect(response.status).toBe(201);
    expect(transform).toHaveBeenCalledWith(expect.objectContaining({ preset: special }));
  });

  it("refuses an event-only style elsewhere without creating a photo", async () => {
    for (const presetIds of [null, ["kid-drawing"]]) {
      await assign(presetIds);
      const captureId = randomUUID();
      const response = await upload(special.id, captureId);
      // A non-retryable failure: the camera keeps the original for a restyle.
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ details: { code: "preset_unavailable" } });
      expect(await getPhotoRepository().findByCaptureId(captureId)).toBeNull();
    }
    expect(transform).not.toHaveBeenCalled();
  });

  it("still accepts default styles an event has hidden, for cameras with an old list", async () => {
    await assign([special.id]);
    expect((await upload("kid-drawing")).status).toBe(201);
  });

  it("returns an existing photo on retry even after its style is turned off", async () => {
    await assign([special.id]);
    const captureId = randomUUID();
    expect((await upload(special.id, captureId)).status).toBe(201);
    await getFleetRepository().updateEventSettings(auth.eventId!, {
      autoShare: false, publishOriginals: false, presetIds: null,
    });
    expect((await upload(special.id, captureId)).status).toBe(200);
  });
});

describe("surprise styles", () => {
  const pool = ["kid-drawing", "claymation", special.id, "storybook"];

  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));

  it("picks one of the event's styles and records it on the photo", async () => {
    await assign(pool);
    const response = await upload("surprise");
    expect(response.status).toBe(201);
    const { presetId } = await response.json();
    expect(pool).toContain(presetId);
    expect(triedIds()).toEqual([presetId]);
  });

  it("works through every style on a camera before repeating one", async () => {
    await assign(pool);
    const picks = [];
    for (let photo = 0; photo < pool.length * 2; photo += 1) {
      picks.push((await (await upload("surprise")).json()).presetId);
    }
    expect([...picks.slice(0, pool.length)].sort()).toEqual([...pool].sort());
    // The second round repeats the first in the same order: least recently used first.
    expect(picks.slice(pool.length)).toEqual(picks.slice(0, pool.length));
  });

  it("tries another style when the model filters one", async () => {
    await assign(pool);
    transform.mockRejectedValueOnce(filtered());
    const captureId = randomUUID();
    const response = await upload("surprise", captureId);

    expect(response.status).toBe(201);
    const [first, second] = triedIds();
    expect(first).not.toBe(second);
    expect(await getPhotoRepository().findByCaptureId(captureId))
      .toMatchObject({ presetId: second, presetVersion: getPreset(second)?.version, status: "complete" });
  });

  it("gives up after three filtered styles", async () => {
    await assign(pool);
    vi.spyOn(console, "error").mockImplementation(() => {});
    transform.mockRejectedValue(filtered());
    const response = await upload("surprise");
    expect(response.status).toBe(422);
    expect(new Set(triedIds()).size).toBe(3);
  });

  it("doesn't retry failures other than filtering", async () => {
    await assign(pool);
    vi.spyOn(console, "error").mockImplementation(() => {});
    transform.mockRejectedValue(new ImageModelError("model_unavailable", "down", 500));
    expect((await upload("surprise")).status).toBe(502);
    expect(transform).toHaveBeenCalledOnce();
  });

  it("keeps a guest's own choice without falling back", async () => {
    await assign(pool);
    vi.spyOn(console, "error").mockImplementation(() => {});
    transform.mockRejectedValue(filtered());
    expect((await upload("kid-drawing")).status).toBe(422);
    expect(triedIds()).toEqual(["kid-drawing"]);
  });
});

