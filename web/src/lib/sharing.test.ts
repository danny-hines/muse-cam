import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as generate } from "@/app/api/device/generations/route";
import { POST as share, DELETE as unshare } from "@/app/api/device/generations/[id]/share/route";
import { DELETE as retract } from "@/app/api/device/captures/[captureId]/share/route";
import { getFleetRepository } from "@/lib/fleet";
import { getMediaStore } from "@/lib/media";
import { getPhotoRepository } from "@/lib/repository";

const auth = vi.hoisted(() => ({ deviceId: "", eventId: null as string | null }));
const transform = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
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

beforeEach(() => {
  auth.deviceId = randomUUID();
  auth.eventId = null;
  transform.mockReset().mockResolvedValue({
    bytes: Buffer.from("transformed test image"), contentType: "image/jpeg", width: 320, height: 240,
  });
  vi.spyOn(getMediaStore(), "publish").mockImplementation(async (_ref, id) => `https://public.test/${id}.jpg`);
  vi.spyOn(getMediaStore(), "removePublic").mockResolvedValue();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function event(autoShare: boolean, publishOriginals = false) {
  const created = await getFleetRepository().createEvent({
    id: randomUUID(), slug: randomUUID(), name: "Event", autoShare, publishOriginals,
  });
  auth.eventId = created.id;
  return created;
}

function upload(captureId = randomUUID()) {
  const form = new FormData();
  form.set("capture_id", captureId);
  form.set("preset_id", "kid-drawing");
  form.set("image", new File(["test-image"], "image.jpg", { type: "image/jpeg" }));
  return generate(new Request("https://camera.test/api/device/generations", { method: "POST", body: form }));
}

function remove(captureId: string) {
  return retract(new Request("https://camera.test/api/device/captures/share", { method: "DELETE" }), {
    params: Promise.resolve({ captureId }),
  });
}

function manualShare(id: string) {
  return share(new Request("https://camera.test/api/device/generations/share", { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

describe("event auto-sharing and camera retractions", () => {
  it("keeps unassigned cameras and events with auto-sharing off private", async () => {
    expect((await (await upload()).json()).shareUrl).toBeNull();
    await event(false);
    expect((await (await upload()).json()).shareUrl).toBeNull();
    expect(getMediaStore().publish).not.toHaveBeenCalled();
  });

  it("applies policy changes to new uploads without publishing old photos on retry", async () => {
    const current = await event(false);
    const oldCapture = randomUUID();
    await upload(oldCapture);
    await getFleetRepository().updateEventSettings(current.id, { autoShare: true, publishOriginals: false });
    expect((await (await upload(oldCapture)).json()).shareUrl).toBeNull();
    const shared = await (await upload()).json();
    expect(shared.shareUrl).toMatch(/^https:\/\/camera.test\/p\//);
    expect(getMediaStore().publish).toHaveBeenCalledTimes(1);
    await getFleetRepository().updateEventSettings(current.id, { autoShare: false, publishOriginals: false });
    expect((await (await upload()).json()).shareUrl).toBeNull();
    expect((await getPhotoRepository().findById(shared.id))?.publicSlug).toBeTruthy();
  });

  it("retracts transformed and original shares, keeps private copies, and is idempotent", async () => {
    await event(true, true);
    const captureId = randomUUID();
    const generated = await (await upload(captureId)).json();
    const before = (await getPhotoRepository().findById(generated.id))!;
    expect(before.originalPublicUrl).toBeTruthy();
    expect((await remove(captureId)).status).toBe(200);
    expect((await remove(captureId)).status).toBe(200);
    const after = (await getPhotoRepository().findById(generated.id))!;
    expect(after).toMatchObject({ publicSlug: null, resultPublicUrl: null, originalPublicUrl: null, autoSharePending: false });
    expect(getMediaStore().removePublic).toHaveBeenCalledWith(before.resultPublicUrl);
    expect(getMediaStore().removePublic).toHaveBeenCalledWith(before.originalPublicUrl);
    expect(await getMediaStore().readPrivate(after.resultPrivateRef!)).toBeTruthy();
    expect(await getMediaStore().readPrivate(after.originalPrivateRef!)).toBeTruthy();
    expect((await upload(captureId)).status).toBe(410);
    expect((await manualShare(generated.id)).status).toBe(410);
    expect(transform).toHaveBeenCalledTimes(1);
  });

  it("also retracts a manually shared photo", async () => {
    await event(false);
    const captureId = randomUUID();
    const generated = await (await upload(captureId)).json();
    expect((await manualShare(generated.id)).status).toBe(200);
    expect((await remove(captureId)).status).toBe(200);
    expect((await getPhotoRepository().findById(generated.id))?.publicSlug).toBeNull();
  });

  it("remembers deletion before the upload arrives", async () => {
    await event(true);
    const captureId = randomUUID();
    expect((await remove(captureId)).status).toBe(200);
    expect((await upload(captureId)).status).toBe(410);
    expect(transform).not.toHaveBeenCalled();
  });

  it("does not let a different camera retract another camera's photo", async () => {
    await event(true);
    const captureId = randomUUID();
    const generated = await (await upload(captureId)).json();
    auth.deviceId = randomUUID();
    expect((await remove(captureId)).status).toBe(404);
    expect((await getPhotoRepository().findById(generated.id))?.publicSlug).toBeTruthy();
    expect(getMediaStore().removePublic).not.toHaveBeenCalled();
  });

  it("cleans up publication when deletion arrives during the upload to public storage", async () => {
    await event(true);
    const captureId = randomUUID();
    vi.mocked(getMediaStore().publish).mockImplementationOnce(async () => {
      await remove(captureId);
      return "https://public.test/late.jpg";
    });
    expect((await upload(captureId)).status).toBe(410);
    expect(getMediaStore().removePublic).toHaveBeenCalledWith("https://public.test/late.jpg");
    expect((await getPhotoRepository().findByCaptureId(captureId))?.publicSlug).toBeNull();
  });

  it("cleans up publication when deletion races with saving the public link", async () => {
    await event(true);
    const captureId = randomUUID();
    const repository = getPhotoRepository();
    const original = repository.markShared.bind(repository);
    vi.spyOn(repository, "markShared").mockImplementationOnce(async (...args) => {
      await remove(captureId);
      return original(...args);
    });
    expect((await upload(captureId)).status).toBe(410);
    expect((await repository.findByCaptureId(captureId))?.publicSlug).toBeNull();
  });

  it("retries failed auto-sharing without regenerating or exposing partial originals", async () => {
    await event(true, true);
    const captureId = randomUUID();
    vi.mocked(getMediaStore().publish)
      .mockResolvedValueOnce("https://public.test/partial.jpg")
      .mockRejectedValueOnce(new Error("Storage temporarily unavailable"));
    expect((await upload(captureId)).status).toBe(503);
    expect(await getPhotoRepository().findByCaptureId(captureId)).toMatchObject({ status: "complete", autoSharePending: true, publicSlug: null });
    expect(getMediaStore().removePublic).toHaveBeenCalledWith("https://public.test/partial.jpg");
    const retried = await upload(captureId);
    expect(retried.status).toBe(200);
    expect((await retried.json()).shareUrl).toBeTruthy();
    expect(transform).toHaveBeenCalledTimes(1);
  });

  it("does not auto-share again after an operator hides the photo", async () => {
    await event(true);
    const captureId = randomUUID();
    const generated = await (await upload(captureId)).json();
    await unshare(new Request("https://camera.test/share", { method: "DELETE" }), { params: Promise.resolve({ id: generated.id }) });
    expect((await (await upload(captureId)).json()).shareUrl).toBeNull();
    expect(getMediaStore().publish).toHaveBeenCalledTimes(1);
  });

  it("keeps a retraction retryable after public storage fails", async () => {
    await event(true);
    const captureId = randomUUID();
    const generated = await (await upload(captureId)).json();
    vi.mocked(getMediaStore().removePublic).mockRejectedValueOnce(new Error("Storage unavailable"));
    expect((await remove(captureId)).status).toBe(503);
    expect((await manualShare(generated.id)).status).toBe(410);
    expect((await remove(captureId)).status).toBe(200);
    expect((await getPhotoRepository().findById(generated.id))?.publicSlug).toBeNull();
  });
});
