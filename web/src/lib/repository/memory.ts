import type { PhotoRecord } from "@/lib/types";
import type { CompletePhotoInput, CreatePhotoInput, PhotoRepository } from "./types";

type MemoryState = {
  photos: Map<string, PhotoRecord>;
};

const globalMemory = globalThis as typeof globalThis & {
  __museCamMemoryState?: MemoryState;
};

function getState(): MemoryState {
  if (!globalMemory.__museCamMemoryState) {
    globalMemory.__museCamMemoryState = { photos: new Map() };
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

  async listShared(limit = 60): Promise<PhotoRecord[]> {
    return [...getState().photos.values()]
      .filter((photo) => photo.sharedAt && photo.resultPublicUrl)
      .sort((a, b) => b.sharedAt!.getTime() - a.sharedAt!.getTime())
      .slice(0, limit);
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
      updatedAt: new Date(),
    });
  }

  async markOriginalPublished(id: string, originalPublicUrl: string): Promise<PhotoRecord> {
    return save({ ...requirePhoto(id), originalPublicUrl, updatedAt: new Date() });
  }

  async delete(id: string): Promise<void> {
    getState().photos.delete(id);
  }
}
