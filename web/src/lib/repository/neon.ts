import { desc, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { photos } from "@/db/schema";
import type { PhotoRecord } from "@/lib/types";
import type { CompletePhotoInput, CreatePhotoInput, PhotoRepository } from "./types";

function firstOrThrow(rows: PhotoRecord[], id: string): PhotoRecord {
  const photo = rows[0];
  if (!photo) {
    throw new Error(`Photo ${id} was not found`);
  }
  return photo;
}

export class NeonPhotoRepository implements PhotoRepository {
  async create(input: CreatePhotoInput): Promise<PhotoRecord> {
    const existing = await this.findByCaptureId(input.captureId);
    if (existing) {
      return existing;
    }

    const now = new Date();
    const rows = await getDb()
      .insert(photos)
      .values({ ...input, createdAt: now, updatedAt: now })
      .onConflictDoNothing({ target: photos.captureId })
      .returning();

    return rows[0] ?? (await this.findByCaptureId(input.captureId))!;
  }

  async findById(id: string): Promise<PhotoRecord | null> {
    const rows = await getDb().select().from(photos).where(eq(photos.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async findByCaptureId(captureId: string): Promise<PhotoRecord | null> {
    const rows = await getDb().select().from(photos).where(eq(photos.captureId, captureId)).limit(1);
    return rows[0] ?? null;
  }

  async findByPublicSlug(slug: string): Promise<PhotoRecord | null> {
    const rows = await getDb().select().from(photos).where(eq(photos.publicSlug, slug)).limit(1);
    return rows[0] ?? null;
  }

  async listShared(limit = 60): Promise<PhotoRecord[]> {
    return getDb()
      .select()
      .from(photos)
      .where(eq(photos.status, "complete"))
      .orderBy(desc(photos.sharedAt))
      .limit(limit)
      .then((rows) => rows.filter((row) => row.sharedAt && row.resultPublicUrl));
  }

  async markComplete(id: string, input: CompletePhotoInput): Promise<PhotoRecord> {
    const now = new Date();
    const rows = await getDb()
      .update(photos)
      .set({ ...input, status: "complete", completedAt: now, updatedAt: now, errorCode: null })
      .where(eq(photos.id, id))
      .returning();
    return firstOrThrow(rows, id);
  }

  async markFailed(id: string, errorCode: string): Promise<PhotoRecord> {
    const rows = await getDb()
      .update(photos)
      .set({ status: "failed", errorCode, updatedAt: new Date() })
      .where(eq(photos.id, id))
      .returning();
    return firstOrThrow(rows, id);
  }

  async markShared(id: string, publicSlug: string, publicUrl: string): Promise<PhotoRecord> {
    const now = new Date();
    const rows = await getDb()
      .update(photos)
      .set({ publicSlug, resultPublicUrl: publicUrl, sharedAt: now, updatedAt: now })
      .where(eq(photos.id, id))
      .returning();
    return firstOrThrow(rows, id);
  }

  async markUnshared(id: string): Promise<PhotoRecord> {
    const rows = await getDb()
      .update(photos)
      .set({ publicSlug: null, resultPublicUrl: null, sharedAt: null, updatedAt: new Date() })
      .where(eq(photos.id, id))
      .returning();
    return firstOrThrow(rows, id);
  }
}
