import type { PhotoRecord } from "@/lib/types";

export type CreatePhotoInput = Pick<
  PhotoRecord,
  | "id"
  | "captureId"
  | "deviceId"
  | "eventId"
  | "presetId"
  | "presetVersion"
  | "capturedAtDevice"
> & { autoSharePending?: boolean };

export type CompletePhotoInput = {
  originalPrivateRef: string;
  resultPrivateRef: string;
  resultMimeType: string;
  width: number;
  height: number;
};

export type PhotoNeighbors = { previousSlug: string | null; nextSlug: string | null };

export interface PhotoRepository {
  create(input: CreatePhotoInput): Promise<PhotoRecord>;
  findById(id: string): Promise<PhotoRecord | null>;
  findByCaptureId(captureId: string): Promise<PhotoRecord | null>;
  findByPublicSlug(slug: string): Promise<PhotoRecord | null>;
  listShared(eventId: string, limit?: number): Promise<PhotoRecord[]>;
  findSharedNeighbors(slug: string): Promise<PhotoNeighbors>;
  listAll(limit?: number): Promise<PhotoRecord[]>;
  markComplete(id: string, input: CompletePhotoInput): Promise<PhotoRecord>;
  markFailed(id: string, errorCode: string): Promise<PhotoRecord>;
  markShared(
    id: string,
    publicSlug: string,
    publicUrl: string,
    originalPublicUrl?: string | null,
  ): Promise<PhotoRecord>;
  markUnshared(id: string): Promise<PhotoRecord>;
  markOriginalPublished(id: string, originalPublicUrl: string): Promise<PhotoRecord>;
  delete(id: string): Promise<void>;
  retractCapture(deviceId: string, captureId: string): Promise<void>;
  isCaptureRetracted(deviceId: string, captureId: string): Promise<boolean>;
}
