import { afterEach, expect, it, vi } from "vitest";

import { retiredPresets } from "@/config/presets";
import type { EventRecord, PhotoRecord } from "@/lib/types";

const repository = vi.hoisted(() => ({
  findByPublicSlug: vi.fn(),
  listShared: vi.fn(),
  findSharedNeighbors: vi.fn(),
}));

const event = vi.hoisted((): EventRecord => ({
  id: "event-id", slug: "sei-nyc", name: "NYC Offsite", publishOriginals: false, autoShare: false,
  createdAt: new Date(), updatedAt: new Date(),
}));

const fleet = vi.hoisted(() => ({
  findEventById: vi.fn(async (): Promise<EventRecord | null> => event),
  findEventBySlug: vi.fn(),
}));

vi.mock("@/lib/repository", () => ({
  getPhotoRepository: () => repository,
  hasPersistentDatabase: () => true,
}));
vi.mock("@/lib/fleet", () => ({
  getFleetRepository: () => ({
    ...fleet,
    findDeviceById: async () => ({ id: "camera", name: "Test Camera" }),
    listDevices: async () => [{ id: "camera", name: "Test Camera" }],
  }),
}));

import { getEventBySlug, getPublishedPhotoBySlug, getPublishedPhotoNeighbors, listPublishedPhotos } from "./photos";

afterEach(() => vi.clearAllMocks());

it.each(retiredPresets)("preserves shared links and gallery entries for $name", async (preset) => {
  const date = new Date("2026-09-08T12:00:00Z");
  const photo: PhotoRecord = {
    id: "photo",
    captureId: "capture",
    deviceId: "camera",
    eventId: event.id,
    presetId: preset.id,
    presetVersion: preset.version,
    status: "complete",
    autoSharePending: false,
    capturedAtDevice: date,
    createdAt: date,
    updatedAt: date,
    completedAt: date,
    sharedAt: date,
    publicSlug: `shared-${preset.id}`,
    originalPrivateRef: null,
    resultPrivateRef: null,
    resultPublicUrl: "https://example.test/result.jpg",
    originalPublicUrl: "https://example.test/original.jpg",
    resultMimeType: "image/jpeg",
    width: 1920,
    height: 1280,
    errorCode: null,
  };
  repository.findByPublicSlug.mockResolvedValue(photo);
  repository.listShared.mockResolvedValue([photo]);

  const shared = await getPublishedPhotoBySlug(photo.publicSlug!);
  expect(shared).toMatchObject({
    publicSlug: photo.publicSlug,
    presetName: preset.name,
    imageUrl: photo.resultPublicUrl,
    originalImageUrl: photo.originalPublicUrl,
    deviceName: "Test Camera",
    eventName: event.name,
    eventSlug: event.slug,
  });
  expect(await listPublishedPhotos(event)).toEqual([shared]);
});

it("resolves gallery URLs and passes the event filter to the repository", async () => {
  fleet.findEventBySlug.mockResolvedValueOnce(event).mockResolvedValueOnce(null);
  repository.listShared.mockResolvedValue([]);
  expect(await getEventBySlug("sei-nyc")).toEqual(event);
  expect(await getEventBySlug("missing-event")).toBeNull();
  expect(await listPublishedPhotos(event)).toEqual([]);
  expect(repository.listShared).toHaveBeenCalledWith(event.id, 60);
});

it("does not serve demo frames or the demo event when a database is connected", async () => {
  fleet.findEventBySlug.mockResolvedValue(null);
  repository.findByPublicSlug.mockResolvedValue(null);
  expect(await getEventBySlug("demo")).toBeNull();
  expect(await getPublishedPhotoBySlug("after-the-end")).toBeNull();
});

it("does not render a photo whose event cannot be found", async () => {
  const date = new Date();
  repository.findByPublicSlug.mockResolvedValue({
    id: "orphan", deviceId: "camera", eventId: "missing", status: "complete",
    presetId: "kid-drawing", publicSlug: "orphan", resultPublicUrl: "https://example.test/orphan.jpg",
    sharedAt: date, createdAt: date,
  });
  fleet.findEventById.mockResolvedValueOnce(null);
  expect(await getPublishedPhotoBySlug("orphan")).toBeNull();
});

it("includes the saved event's gallery link on a photo", async () => {
  const date = new Date();
  repository.findByPublicSlug.mockResolvedValue({
    id: "event-photo", deviceId: "camera", eventId: event.id, status: "complete",
    presetId: "kid-drawing", publicSlug: "event-photo", resultPublicUrl: "https://example.test/event.jpg",
    sharedAt: date, createdAt: date,
  });
  expect(await getPublishedPhotoBySlug("event-photo")).toMatchObject({
    eventName: event.name, eventSlug: event.slug,
  });
});

it("only exposes an original that has been published", async () => {
  repository.findByPublicSlug.mockResolvedValue({
    id: "private-original", deviceId: "camera", eventId: event.id, status: "complete", presetId: "kid-drawing",
    publicSlug: "private-original", resultPublicUrl: "https://example.test/result.jpg",
    originalPrivateRef: "private/original.jpg", originalPublicUrl: null,
    sharedAt: new Date(), createdAt: new Date(),
  });
  const photo = await getPublishedPhotoBySlug("private-original");
  expect(photo?.originalImageUrl).toBeNull();
  expect(photo).not.toHaveProperty("originalPrivateRef");
});

it("does not render a failed photo even if it has an old public slug", async () => {
  repository.findByPublicSlug.mockResolvedValue({
    id: "failed", deviceId: "camera", status: "failed", presetId: "kid-drawing",
    publicSlug: "failed", resultPublicUrl: "https://example.test/result.jpg", sharedAt: new Date(),
  });
  expect(await getPublishedPhotoBySlug("failed")).toBeNull();
});

it("finds neighboring photos within the photo's event", async () => {
  const neighbors = { previousSlug: "newer", nextSlug: "older" };
  repository.findSharedNeighbors.mockResolvedValue(neighbors);
  expect(await getPublishedPhotoNeighbors("middle")).toEqual(neighbors);
  expect(repository.findSharedNeighbors).toHaveBeenLastCalledWith("middle");
});
