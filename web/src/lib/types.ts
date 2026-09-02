export const photoStatuses = ["processing", "complete", "failed"] as const;

export type PhotoStatus = (typeof photoStatuses)[number];

export type PhotoRecord = {
  id: string;
  captureId: string;
  deviceId: string;
  eventId: string | null;
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
  originalPublicUrl: string | null;
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
  originalImageUrl: string | null;
  deviceName: string;
  eventName: string | null;
  width: number;
  height: number;
  capturedAt: Date;
  sharedAt: Date;
};

export type EventRecord = {
  id: string;
  slug: string;
  name: string;
  publishOriginals: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type DeviceRecord = {
  id: string;
  name: string;
  tokenHash: string;
  eventId: string | null;
  status: "active" | "revoked";
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DeviceClaimRecord = {
  id: string;
  codeHash: string;
  suggestedName: string | null;
  eventId: string | null;
  expiresAt: Date;
  claimedAt: Date | null;
  createdAt: Date;
};
