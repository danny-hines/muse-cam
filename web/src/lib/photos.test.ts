import { afterEach, expect, it, vi } from "vitest";

import { retiredPresets } from "@/config/presets";
import type { PhotoRecord } from "@/lib/types";

const repository = vi.hoisted(() => ({
  findByPublicSlug: vi.fn(),
  listShared: vi.fn(),
}));

const fleet = vi.hoisted(() => ({
  findEventById: vi.fn(),
  findEventBySlug: vi.fn(),
  listEvents: vi.fn(async () => [] as Array<{ id: string; name: string; slug: string }>),
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

import { getEventBySlug, getPublishedPhotoBySlug, listPublishedPhotos } from "./photos";

afterEach(() => vi.clearAllMocks());

it.each(retiredPresets)("preserves shared links and gallery entries for $name", async (preset) => {
  const date = new Date("2026-09-08T12:00:00Z");
  const photo: PhotoRecord = {
    id: "photo",
    captureId: "capture",
    deviceId: "camera",
    eventId: null,
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
  });
  expect(await listPublishedPhotos()).toEqual([shared]);
});

it("resolves gallery URLs and passes the event filter to the repository", async () => {
  const event = { id: "event-id", name: "NYC Offsite", slug: "sei-nyc" };
  fleet.findEventBySlug.mockResolvedValueOnce(event).mockResolvedValueOnce(null);
  repository.listShared.mockResolvedValue([]);
  expect(await getEventBySlug("sei-nyc")).toEqual(event);
  expect(await getEventBySlug("missing-event")).toBeNull();
  expect(await listPublishedPhotos(event.id)).toEqual([]);
  expect(repository.listShared).toHaveBeenCalledWith(60, event.id);
});

it("includes the saved event's gallery link on a photo", async () => {
  const event = { id: "event-id", name: "NYC Offsite", slug: "sei-nyc" };
  const date = new Date();
  repository.findByPublicSlug.mockResolvedValue({
    id: "event-photo", deviceId: "camera", eventId: event.id,
    presetId: "kid-drawing", publicSlug: "event-photo", resultPublicUrl: "https://example.test/event.jpg",
    sharedAt: date, createdAt: date,
  });
  fleet.findEventById.mockResolvedValue(event);
  expect(await getPublishedPhotoBySlug("event-photo")).toMatchObject({
    eventName: event.name, eventSlug: event.slug,
  });
});
