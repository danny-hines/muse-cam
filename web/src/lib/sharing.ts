import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";

import { getFleetRepository } from "@/lib/fleet";
import { getMediaStore } from "@/lib/media";
import { getPhotoRepository } from "@/lib/repository";
import type { PhotoRecord } from "@/lib/types";

export class CaptureRetractedError extends Error {}

export async function unpublishPhoto(photo: PhotoRecord): Promise<PhotoRecord> {
  const media = getMediaStore();
  await Promise.all([
    photo.resultPublicUrl ? media.removePublic(photo.resultPublicUrl) : Promise.resolve(),
    photo.originalPublicUrl ? media.removePublic(photo.originalPublicUrl) : Promise.resolve(),
  ]);
  const updated = await getPhotoRepository().markUnshared(photo.id);
  revalidatePath("/");
  revalidatePath("/admin");
  if (photo.eventId) revalidatePath("/[eventSlug]", "page");
  if (photo.publicSlug) revalidatePath(`/p/${photo.publicSlug}`);
  return updated;
}

export async function publishPhoto(photo: PhotoRecord): Promise<PhotoRecord> {
  const repository = getPhotoRepository();
  const retracted = () => repository.isCaptureRetracted(photo.deviceId, photo.captureId);
  if (await retracted()) throw new CaptureRetractedError("Photo was deleted on the camera");
  if (photo.publicSlug && photo.resultPublicUrl) return photo;
  if (photo.status !== "complete" || !photo.resultPrivateRef || !photo.resultMimeType) {
    throw new Error("Generation is not ready to share");
  }

  const media = getMediaStore();
  const event = photo.eventId ? await getFleetRepository().findEventById(photo.eventId) : null;
  const published: string[] = [];
  let shared: PhotoRecord;
  try {
    const publicUrl = await media.publish(photo.resultPrivateRef, photo.id, photo.resultMimeType);
    published.push(publicUrl);
    let originalUrl: string | null = null;
    if (event?.publishOriginals && photo.originalPrivateRef) {
      originalUrl = await media.publish(photo.originalPrivateRef, `${photo.id}-original`, "image/jpeg");
      published.push(originalUrl);
    }
    if (await retracted()) throw new CaptureRetractedError("Photo was deleted on the camera");
    shared = await repository.markShared(photo.id, randomBytes(9).toString("base64url"), publicUrl, originalUrl);
  } catch (error) {
    await Promise.allSettled(published.map((url) => media.removePublic(url)));
    throw error;
  }

  // A deletion may have arrived between the previous check and markShared.
  // If it arrives after this check, its handler sees and removes the saved share.
  if (await retracted()) {
    await unpublishPhoto(shared);
    throw new CaptureRetractedError("Photo was deleted on the camera");
  }
  revalidatePath("/");
  revalidatePath("/admin");
  if (shared.eventId) revalidatePath("/[eventSlug]", "page");
  revalidatePath(`/p/${shared.publicSlug}`);
  return shared;
}
