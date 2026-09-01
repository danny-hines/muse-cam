import type { PhotoRecord } from "@/lib/types";

export type CreatePhotoInput = Pick<
  PhotoRecord,
  "id" | "captureId" | "deviceId" | "presetId" | "presetVersion" | "capturedAtDevice"
>;

export type CompletePhotoInput = {
  originalPrivateRef: string;
  resultPrivateRef: string;
  resultMimeType: string;
  width: number;
  height: number;
};

export interface PhotoRepository {
  create(input: CreatePhotoInput): Promise<PhotoRecord>;
  findById(id: string): Promise<PhotoRecord | null>;
  findByCaptureId(captureId: string): Promise<PhotoRecord | null>;
  findByPublicSlug(slug: string): Promise<PhotoRecord | null>;
  listShared(limit?: number): Promise<PhotoRecord[]>;
  markComplete(id: string, input: CompletePhotoInput): Promise<PhotoRecord>;
  markFailed(id: string, errorCode: string): Promise<PhotoRecord>;
  markShared(id: string, publicSlug: string, publicUrl: string): Promise<PhotoRecord>;
  markUnshared(id: string): Promise<PhotoRecord>;
}
