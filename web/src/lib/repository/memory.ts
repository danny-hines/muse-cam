import type { PhotoRecord } from "@/lib/types";
import type { CompletePhotoInput, CreatePhotoInput, PhotoNeighbors, PhotoRepository } from "./types";

type MemoryState = {
  photos: Map<string, PhotoRecord>;
  retractions: Set<string>;
};

const globalMemory = globalThis as typeof globalThis & {
  __museCamMemoryState?: MemoryState;
};

function getState(): MemoryState {
  if (!globalMemory.__museCamMemoryState) {
    globalMemory.__museCamMemoryState = { photos: new Map(), retractions: new Set() };
  }

  return globalMemory.__museCamMemoryState;
}

function requirePhoto(id: string): PhotoRecord {
  const photo = getState().photos.get(id);

  if (!photo) {
    throw new Error(`Photo ${id} was not found`);
  }

  return photo;
}

function save(photo: PhotoRecord): PhotoRecord {
  getState().photos.set(photo.id, photo);
  return photo;
}

export class MemoryPhotoRepository implements PhotoRepository {
  async create(input: CreatePhotoInput): Promise<PhotoRecord> {
    const existing = await this.findByCaptureId(input.captureId);
    if (existing) {
      return existing;
    }

    const now = new Date();
    return save({
      ...input,
      autoSharePending: input.autoSharePending ?? false,
      status: "processing",
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      sharedAt: null,
      publicSlug: null,
      originalPrivateRef: null,
      resultPrivateRef: null,
      resultPublicUrl: null,
      originalPublicUrl: null,
      resultMimeType: null,
      width: null,
      height: null,
      errorCode: null,
    });
  }

  async findById(id: string): Promise<PhotoRecord | null> {
    return getState().photos.get(id) ?? null;
  }

  async findByCaptureId(captureId: string): Promise<PhotoRecord | null> {
    return [...getState().photos.values()].find((photo) => photo.captureId === captureId) ?? null;
  }

  async findByPublicSlug(slug: string): Promise<PhotoRecord | null> {
    return [...getState().photos.values()].find((photo) => photo.publicSlug === slug) ?? null;
  }

  async listShared(limit = 60, eventId?: string | null): Promise<PhotoRecord[]> {
    return [...getState().photos.values()]
      .filter((photo) => photo.status === "complete" && photo.sharedAt && photo.resultPublicUrl && photo.publicSlug
        && (eventId === undefined || photo.eventId === eventId))
      .sort((a, b) => b.sharedAt!.getTime() - a.sharedAt!.getTime() || b.id.localeCompare(a.id))
      .slice(0, limit);
  }

  async findSharedNeighbors(slug: string, withinEvent = true): Promise<PhotoNeighbors> {
    const current = await this.findByPublicSlug(slug);
    if (!current) return { previousSlug: null, nextSlug: null };
    const shared = await this.listShared(Infinity, withinEvent ? current.eventId ?? undefined : undefined);
    const index = shared.findIndex((photo) => photo.id === current.id);
    if (index < 0) return { previousSlug: null, nextSlug: null };
    return { previousSlug: shared[index - 1]?.publicSlug ?? null, nextSlug: shared[index + 1]?.publicSlug ?? null };
  }

  async listAll(limit = 100): Promise<PhotoRecord[]> {
    return [...getState().photos.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async markComplete(id: string, input: CompletePhotoInput): Promise<PhotoRecord> {
    const now = new Date();
    return save({
      ...requirePhoto(id),
      ...input,
      status: "complete",
      completedAt: now,
      updatedAt: now,
      errorCode: null,
    });
  }

  async markFailed(id: string, errorCode: string): Promise<PhotoRecord> {
    return save({
      ...requirePhoto(id),
      status: "failed",
      errorCode,
      updatedAt: new Date(),
    });
  }

  async markShared(
    id: string,
    publicSlug: string,
    publicUrl: string,
    originalPublicUrl: string | null = null,
  ): Promise<PhotoRecord> {
    const now = new Date();
    return save({
      ...requirePhoto(id),
      publicSlug,
      resultPublicUrl: publicUrl,
      originalPublicUrl,
      sharedAt: now,
      autoSharePending: false,
      updatedAt: now,
    });
  }

  async markUnshared(id: string): Promise<PhotoRecord> {
    return save({
      ...requirePhoto(id),
      publicSlug: null,
      resultPublicUrl: null,
      originalPublicUrl: null,
      sharedAt: null,
      autoSharePending: false,
      updatedAt: new Date(),
    });
  }

  async markOriginalPublished(id: string, originalPublicUrl: string): Promise<PhotoRecord> {
    return save({ ...requirePhoto(id), originalPublicUrl, updatedAt: new Date() });
  }

  async delete(id: string): Promise<void> {
    getState().photos.delete(id);
  }

  async retractCapture(deviceId: string, captureId: string): Promise<void> {
    getState().retractions.add(JSON.stringify([deviceId, captureId]));
  }

  async isCaptureRetracted(deviceId: string, captureId: string): Promise<boolean> {
    return getState().retractions.has(JSON.stringify([deviceId, captureId]));
  }
}
