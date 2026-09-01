import { MemoryMediaStore } from "./memory";
import type { MediaStore } from "./types";
import { VercelBlobMediaStore } from "./vercel-blob";

let mediaStore: MediaStore | null = null;

export function hasPersistentMediaStore(): boolean {
  return Boolean(
    process.env.PRIVATE_BLOB_READ_WRITE_TOKEN && process.env.PUBLISHED_BLOB_READ_WRITE_TOKEN,
  );
}

export function getMediaStore(): MediaStore {
  if (!mediaStore) {
    mediaStore = hasPersistentMediaStore()
      ? new VercelBlobMediaStore()
      : new MemoryMediaStore();
  }
  return mediaStore;
}

export type { MediaStore } from "./types";
