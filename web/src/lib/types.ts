export const photoStatuses = ["processing", "complete", "failed"] as const;

export type PhotoStatus = (typeof photoStatuses)[number];

export type PhotoRecord = {
  id: string;
  captureId: string;
  deviceId: string;
  presetId: string;
  presetVersion: number;
  status: PhotoStatus;
  capturedAtDevice: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  sharedAt: Date | null;
  publicSlug: string | null;
  originalPrivateRef: string | null;
  resultPrivateRef: string | null;
  resultPublicUrl: string | null;
  resultMimeType: string | null;
  width: number | null;
  height: number | null;
  errorCode: string | null;
};

export type PublishedPhoto = {
  id: string;
  publicSlug: string;
  presetId: string;
  presetName: string;
  presetDescription: string;
  imageUrl: string;
  width: number;
  height: number;
  capturedAt: Date;
  sharedAt: Date;
};
