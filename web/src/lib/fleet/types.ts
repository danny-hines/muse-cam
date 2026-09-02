import type { DeviceClaimRecord, DeviceRecord, EventRecord } from "@/lib/types";

export type CreateEventInput = Pick<
  EventRecord,
  "id" | "slug" | "name" | "publishOriginals"
>;

export type CreateClaimInput = Pick<
  DeviceClaimRecord,
  "id" | "codeHash" | "suggestedName" | "eventId" | "expiresAt"
>;

export type ClaimDeviceInput = {
  codeHash: string;
  deviceId: string;
  deviceName: string;
  tokenHash: string;
};

export interface FleetRepository {
  createEvent(input: CreateEventInput): Promise<EventRecord>;
  listEvents(): Promise<EventRecord[]>;
  findEventById(id: string): Promise<EventRecord | null>;
  createClaim(input: CreateClaimInput): Promise<DeviceClaimRecord>;
  listClaims(limit?: number): Promise<DeviceClaimRecord[]>;
  claimDevice(input: ClaimDeviceInput): Promise<DeviceRecord | null>;
  findDeviceByTokenHash(tokenHash: string): Promise<DeviceRecord | null>;
  findDeviceById(id: string): Promise<DeviceRecord | null>;
  listDevices(): Promise<DeviceRecord[]>;
  touchDevice(id: string): Promise<void>;
  updateDeviceStatus(id: string, status: DeviceRecord["status"]): Promise<DeviceRecord>;
}
