import type { Preset } from "@/config/presets";
import type { DeviceClaimRecord, DeviceRecord, EventRecord } from "@/lib/types";

export type CreateEventInput = Pick<
  EventRecord,
  "id" | "slug" | "name" | "publishOriginals"
> & { autoShare?: boolean; presetIds?: string[] | null; surpriseStyles?: boolean };

export type EventSettings = Pick<EventRecord, "autoShare" | "publishOriginals"> & {
  presetIds?: string[] | null;
  surpriseStyles?: boolean;
};

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

// A private event-only style as stored. The catalog marks it event-only.
export type EventStyle = Omit<Preset, "eventOnly">;

export type ConfiguredDeviceInput = Pick<DeviceRecord, "id" | "tokenHash">;

export interface FleetRepository {
  createEvent(input: CreateEventInput): Promise<EventRecord>;
  listEvents(): Promise<EventRecord[]>;
  findEventById(id: string): Promise<EventRecord | null>;
  findEventBySlug(slug: string): Promise<EventRecord | null>;
  updateEventSettings(id: string, settings: EventSettings): Promise<EventRecord>;
  listEventStyles(): Promise<EventStyle[]>;
  // Adds the style, or replaces the one with the same ID.
  saveEventStyle(style: EventStyle): Promise<void>;
  createClaim(input: CreateClaimInput): Promise<DeviceClaimRecord>;
  listClaims(limit?: number): Promise<DeviceClaimRecord[]>;
  claimDevice(input: ClaimDeviceInput): Promise<DeviceRecord | null>;
  syncConfiguredDevice(input: ConfiguredDeviceInput): Promise<DeviceRecord>;
  findDeviceByTokenHash(tokenHash: string): Promise<DeviceRecord | null>;
  findDeviceById(id: string): Promise<DeviceRecord | null>;
  listDevices(): Promise<DeviceRecord[]>;
  touchDevice(id: string): Promise<void>;
  updateDeviceEvent(id: string, eventId: string | null): Promise<DeviceRecord>;
  updateDeviceName(id: string, name: string): Promise<DeviceRecord>;
  updateDeviceStatus(id: string, status: DeviceRecord["status"]): Promise<DeviceRecord>;
}
