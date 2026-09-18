import { cache } from "react";

import { getPreset } from "@/config/presets";
import { demoPhotos } from "@/lib/demo-photos";
import { getFleetRepository } from "@/lib/fleet";
import { getPhotoRepository, hasPersistentDatabase } from "@/lib/repository";
import type { PhotoNeighbors } from "@/lib/repository/types";
import type { EventRecord, PhotoRecord, PublishedPhoto } from "@/lib/types";

function toPublishedPhoto(
  photo: PhotoRecord,
  deviceName = "Muse Cam 01",
  event: Pick<EventRecord, "name" | "slug"> | null = null,
): PublishedPhoto | null {
  const preset = getPreset(photo.presetId);
  if (!preset || photo.status !== "complete" || !photo.publicSlug || !photo.resultPublicUrl || !photo.sharedAt) {
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
    eventName: event?.name ?? null,
    eventSlug: event?.slug ?? null,
    width: photo.width ?? 1200,
    height: photo.height ?? 900,
    capturedAt: photo.capturedAtDevice ?? photo.createdAt,
    sharedAt: photo.sharedAt,
  };
}

async function readPublishedPhotos(eventId?: string | null): Promise<PublishedPhoto[]> {
  const [records, devices, events] = await Promise.all([
    getPhotoRepository().listShared(60, eventId),
    getFleetRepository().listDevices(),
    getFleetRepository().listEvents(),
  ]);
  const deviceNames = new Map(devices.map((device) => [device.id, device.name]));
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const published = records.flatMap((record) => {
    const photo = toPublishedPhoto(
      record,
      deviceNames.get(record.deviceId) ?? "Muse Cam 01",
      record.eventId ? (eventsById.get(record.eventId) ?? null) : null,
    );
    return photo ? [photo] : [];
  });

  if (!eventId && !hasPersistentDatabase() && process.env.DEMO_MODE !== "false") {
    return [...published, ...demoPhotos];
  }

  return published;
}

export async function listPublishedPhotos(eventId?: string | null): Promise<PublishedPhoto[]> {
  return readPublishedPhotos(eventId);
}

export const getEventBySlug = cache((slug: string) => getFleetRepository().findEventBySlug(slug));

export async function getPublishedPhotoNeighbors(slug: string, withinEvent = true): Promise<PhotoNeighbors> {
  if (!hasPersistentDatabase() && process.env.DEMO_MODE !== "false") {
    const demoIndex = demoPhotos.findIndex((photo) => photo.publicSlug === slug);
    if (demoIndex >= 0) {
      return {
        previousSlug: demoPhotos[demoIndex - 1]?.publicSlug ?? null,
        nextSlug: demoPhotos[demoIndex + 1]?.publicSlug ?? null,
      };
    }
  }
  return getPhotoRepository().findSharedNeighbors(slug, withinEvent);
}

export const getPublishedPhotoBySlug = cache(async (slug: string) => {
  const record = await getPhotoRepository().findByPublicSlug(slug);
  if (record) {
    const [device, event] = await Promise.all([
      getFleetRepository().findDeviceById(record.deviceId),
      record.eventId ? getFleetRepository().findEventById(record.eventId) : null,
    ]);
    return toPublishedPhoto(record, device?.name ?? "Muse Cam 01", event);
  }

  return process.env.DEMO_MODE === "false"
    ? null
    : demoPhotos.find((photo) => photo.publicSlug === slug) ?? null;
});
