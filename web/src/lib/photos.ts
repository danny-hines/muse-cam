import { cache } from "react";

import { getPreset } from "@/config/presets";
import { demoPhotos } from "@/lib/demo-photos";
import { getFleetRepository } from "@/lib/fleet";
import { getPhotoRepository, hasPersistentDatabase } from "@/lib/repository";
import type { PhotoRecord, PublishedPhoto } from "@/lib/types";

function toPublishedPhoto(
  photo: PhotoRecord,
  deviceName = "Muse Cam 01",
  eventName: string | null = null,
): PublishedPhoto | null {
  const preset = getPreset(photo.presetId);
  if (!preset || !photo.publicSlug || !photo.resultPublicUrl || !photo.sharedAt) {
    return null;
  }

  return {
    id: photo.id,
    publicSlug: photo.publicSlug,
    presetId: preset.id,
    presetName: preset.name,
    presetDescription: preset.description,
    imageUrl: photo.resultPublicUrl,
    originalImageUrl: photo.originalPublicUrl,
    deviceName,
    eventName,
    width: photo.width ?? 1200,
    height: photo.height ?? 900,
    capturedAt: photo.capturedAtDevice ?? photo.createdAt,
    sharedAt: photo.sharedAt,
  };
}

async function readPublishedPhotos(): Promise<PublishedPhoto[]> {
  const [records, devices, events] = await Promise.all([
    getPhotoRepository().listShared(),
    getFleetRepository().listDevices(),
    getFleetRepository().listEvents(),
  ]);
  const deviceNames = new Map(devices.map((device) => [device.id, device.name]));
  const eventNames = new Map(events.map((event) => [event.id, event.name]));
  const published = records.flatMap((record) => {
    const photo = toPublishedPhoto(
      record,
      deviceNames.get(record.deviceId) ?? "Muse Cam 01",
      record.eventId ? (eventNames.get(record.eventId) ?? null) : null,
    );
    return photo ? [photo] : [];
  });

  if (!hasPersistentDatabase() && process.env.DEMO_MODE !== "false") {
    return [...published, ...demoPhotos];
  }

  return published;
}

export async function listPublishedPhotos(): Promise<PublishedPhoto[]> {
  return readPublishedPhotos();
}

export const getPublishedPhotoBySlug = cache(async (slug: string) => {
  const record = await getPhotoRepository().findByPublicSlug(slug);
  if (record) {
    const [device, event] = await Promise.all([
      getFleetRepository().findDeviceById(record.deviceId),
      record.eventId ? getFleetRepository().findEventById(record.eventId) : null,
    ]);
    return toPublishedPhoto(record, device?.name ?? "Muse Cam 01", event?.name ?? null);
  }

  return process.env.DEMO_MODE === "false"
    ? null
    : demoPhotos.find((photo) => photo.publicSlug === slug) ?? null;
});
