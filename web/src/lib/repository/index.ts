import { MemoryPhotoRepository } from "./memory";
import { NeonPhotoRepository } from "./neon";
import type { PhotoRepository } from "./types";

let repository: PhotoRepository | null = null;

export function hasPersistentDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getPhotoRepository(): PhotoRepository {
  if (!repository) {
    repository = hasPersistentDatabase() ? new NeonPhotoRepository() : new MemoryPhotoRepository();
  }

  return repository;
}

export type { PhotoRepository } from "./types";
