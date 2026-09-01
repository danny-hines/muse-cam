import { cache } from "react";

import { getPreset } from "@/config/presets";
import { demoPhotos } from "@/lib/demo-photos";
import { getPhotoRepository, hasPersistentDatabase } from "@/lib/repository";
import type { PhotoRecord } from "@/lib/types";
import type { PublishedPhoto } from "@/lib/types";

function toPublishedPhoto(photo: PhotoRecord): PublishedPhoto | null {
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
    width: photo.width ?? 1200,
    height: photo.height ?? 900,
    capturedAt: photo.capturedAtDevice ?? photo.createdAt,
    sharedAt: photo.sharedAt,
  };
}

async function readPublishedPhotos(): Promise<PublishedPhoto[]> {
  const records = await getPhotoRepository().listShared();
  const published = records.flatMap((record) => {
    const photo = toPublishedPhoto(record);
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
    return toPublishedPhoto(record);
  }

  return process.env.DEMO_MODE === "false"
    ? null
    : demoPhotos.find((photo) => photo.publicSlug === slug) ?? null;
});
