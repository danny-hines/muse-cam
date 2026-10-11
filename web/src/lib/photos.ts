import { cache } from "react";

import type { StyleCatalog } from "@/config/presets";
import { demoEvent, demoPhotos } from "@/lib/demo-photos";
import { getFleetRepository } from "@/lib/fleet";
import { getPhotoRepository, hasPersistentDatabase } from "@/lib/repository";
import type { PhotoNeighbors } from "@/lib/repository/types";
import { getStyleCatalog } from "@/lib/styles";
import type { EventRecord, PhotoRecord, PublishedPhoto } from "@/lib/types";

function isDemoMode(): boolean {
  return !hasPersistentDatabase() && process.env.DEMO_MODE !== "false";
}

function toPublishedPhoto(
  photo: PhotoRecord,
  deviceName: string,
  event: Pick<EventRecord, "name" | "slug"> | null,
  catalog: StyleCatalog,
): PublishedPhoto | null {
  if (
    !event || photo.status !== "complete" || !photo.publicSlug || !photo.resultPublicUrl
    || !photo.sharedAt
  ) {
    return null;
  }

  // A shared photo stays up even if its event-only style has since been removed.
  const preset = catalog.get(photo.presetId);
  return {
    id: photo.id,
    publicSlug: photo.publicSlug,
    presetId: photo.presetId,
    presetName: preset?.name ?? "Muse Cam",
    presetDescription: preset?.description ?? "",
    caption: photo.caption,
    imageUrl: photo.resultPublicUrl,
    originalImageUrl: photo.originalPublicUrl,
    deviceName,
    eventName: event.name,
    eventSlug: event.slug,
    width: photo.width ?? 1200,
    height: photo.height ?? 900,
    capturedAt: photo.capturedAtDevice ?? photo.createdAt,
    sharedAt: photo.sharedAt,
  };
}

export async function listPublishedPhotos(event: EventRecord): Promise<PublishedPhoto[]> {
  const [records, devices, catalog] = await Promise.all([
    getPhotoRepository().listShared(event.id, 60),
    getFleetRepository().listDevices(),
    getStyleCatalog(),
  ]);
  const deviceNames = new Map(devices.map((device) => [device.id, device.name]));
  const published = records.flatMap((record) => {
    const photo = toPublishedPhoto(record, deviceNames.get(record.deviceId) ?? "Muse Cam", event, catalog);
    return photo ? [photo] : [];
  });

  return event.id === demoEvent.id && isDemoMode() ? [...published, ...demoPhotos] : published;
}

export const getEventBySlug = cache(async (slug: string) => {
  const event = await getFleetRepository().findEventBySlug(slug);
  return event ?? (slug === demoEvent.slug && isDemoMode() ? demoEvent : null);
});

export async function getPublishedPhotoNeighbors(slug: string): Promise<PhotoNeighbors> {
  if (isDemoMode()) {
    const demoIndex = demoPhotos.findIndex((photo) => photo.publicSlug === slug);
    if (demoIndex >= 0) {
      return {
        previousSlug: demoPhotos[demoIndex - 1]?.publicSlug ?? null,
        nextSlug: demoPhotos[demoIndex + 1]?.publicSlug ?? null,
      };
    }
  }
  return getPhotoRepository().findSharedNeighbors(slug);
}

export const getPublishedPhotoBySlug = cache(async (slug: string) => {
  const record = await getPhotoRepository().findByPublicSlug(slug);
  if (record) {
    const [device, event, catalog] = await Promise.all([
      getFleetRepository().findDeviceById(record.deviceId),
      getFleetRepository().findEventById(record.eventId),
      getStyleCatalog(),
    ]);
    return toPublishedPhoto(record, device?.name ?? "Muse Cam", event, catalog);
  }

  return isDemoMode() ? demoPhotos.find((photo) => photo.publicSlug === slug) ?? null : null;
});
