import { expect, it, vi } from "vitest";

import { retiredPresets } from "@/config/presets";
import type { PhotoRecord } from "@/lib/types";

const repository = vi.hoisted(() => ({
  findByPublicSlug: vi.fn(),
  listShared: vi.fn(),
}));

vi.mock("@/lib/repository", () => ({
  getPhotoRepository: () => repository,
  hasPersistentDatabase: () => true,
}));
vi.mock("@/lib/fleet", () => ({
  getFleetRepository: () => ({
    findDeviceById: async () => ({ id: "camera", name: "Test Camera" }),
    listDevices: async () => [{ id: "camera", name: "Test Camera" }],
    listEvents: async () => [],
  }),
}));

import { getPublishedPhotoBySlug, listPublishedPhotos } from "./photos";

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
