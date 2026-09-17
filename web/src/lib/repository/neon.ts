import { and, desc, eq, isNotNull } from "drizzle-orm";

import { getDb } from "@/db/client";
import { captureRetractions, photos } from "@/db/schema";
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
      .where(
        and(
          eq(photos.status, "complete"),
          isNotNull(photos.sharedAt),
          isNotNull(photos.resultPublicUrl),
        ),
      )
      .orderBy(desc(photos.sharedAt))
      .limit(limit);
  }

  async listAll(limit = 100): Promise<PhotoRecord[]> {
    return getDb().select().from(photos).orderBy(desc(photos.createdAt)).limit(limit);
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

  async markShared(
    id: string,
    publicSlug: string,
    publicUrl: string,
    originalPublicUrl: string | null = null,
  ): Promise<PhotoRecord> {
    const now = new Date();
    const rows = await getDb()
      .update(photos)
      .set({
        publicSlug,
        resultPublicUrl: publicUrl,
        originalPublicUrl,
        sharedAt: now,
        autoSharePending: false,
        updatedAt: now,
      })
      .where(eq(photos.id, id))
      .returning();
    return firstOrThrow(rows, id);
  }

  async markUnshared(id: string): Promise<PhotoRecord> {
    const rows = await getDb()
      .update(photos)
      .set({
        publicSlug: null,
        resultPublicUrl: null,
        originalPublicUrl: null,
        sharedAt: null,
        autoSharePending: false,
        updatedAt: new Date(),
      })
      .where(eq(photos.id, id))
      .returning();
    return firstOrThrow(rows, id);
  }

  async markOriginalPublished(id: string, originalPublicUrl: string): Promise<PhotoRecord> {
    const rows = await getDb()
      .update(photos)
      .set({ originalPublicUrl, updatedAt: new Date() })
      .where(eq(photos.id, id))
      .returning();
    return firstOrThrow(rows, id);
  }

  async delete(id: string): Promise<void> {
    await getDb().delete(photos).where(eq(photos.id, id));
  }

  async retractCapture(deviceId: string, captureId: string): Promise<void> {
    await getDb().insert(captureRetractions)
      .values({ deviceId, captureId, createdAt: new Date() }).onConflictDoNothing();
  }

  async isCaptureRetracted(deviceId: string, captureId: string): Promise<boolean> {
    const rows = await getDb().select({ captureId: captureRetractions.captureId })
      .from(captureRetractions)
      .where(and(eq(captureRetractions.deviceId, deviceId), eq(captureRetractions.captureId, captureId)))
      .limit(1);
    return rows.length > 0;
  }
}
