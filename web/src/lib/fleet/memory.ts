import type { DeviceClaimRecord, DeviceRecord, EventRecord } from "@/lib/types";
import type {
  ClaimDeviceInput,
  CreateClaimInput,
  CreateEventInput,
  FleetRepository,
} from "./types";

type MemoryFleet = {
  events: Map<string, EventRecord>;
  devices: Map<string, DeviceRecord>;
  claims: Map<string, DeviceClaimRecord>;
};

const globalMemory = globalThis as typeof globalThis & { __museCamFleet?: MemoryFleet };

function state(): MemoryFleet {
  globalMemory.__museCamFleet ??= {
    events: new Map(),
    devices: new Map(),
    claims: new Map(),
  };
  return globalMemory.__museCamFleet;
}

function requireDevice(id: string): DeviceRecord {
  const device = state().devices.get(id);
  if (!device) throw new Error(`Device ${id} was not found`);
  return device;
}

export class MemoryFleetRepository implements FleetRepository {
  async createEvent(input: CreateEventInput): Promise<EventRecord> {
    const now = new Date();
    const event = { ...input, createdAt: now, updatedAt: now };
    state().events.set(event.id, event);
    return event;
  }

  async listEvents(): Promise<EventRecord[]> {
    return [...state().events.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findEventById(id: string): Promise<EventRecord | null> {
    return state().events.get(id) ?? null;
  }

  async createClaim(input: CreateClaimInput): Promise<DeviceClaimRecord> {
    const claim = { ...input, claimedAt: null, createdAt: new Date() };
    state().claims.set(claim.id, claim);
    return claim;
  }

  async listClaims(limit = 30): Promise<DeviceClaimRecord[]> {
    return [...state().claims.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async claimDevice(input: ClaimDeviceInput): Promise<DeviceRecord | null> {
    const claim = [...state().claims.values()].find(
      (candidate) =>
        candidate.codeHash === input.codeHash &&
        !candidate.claimedAt &&
        candidate.expiresAt > new Date(),
    );
    if (!claim) return null;
    claim.claimedAt = new Date();
    const now = new Date();
    const device: DeviceRecord = {
      id: input.deviceId,
      name: input.deviceName || claim.suggestedName || "Muse Cam",
      tokenHash: input.tokenHash,
      eventId: claim.eventId,
      status: "active",
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };
    state().devices.set(device.id, device);
    return device;
  }

  async findDeviceByTokenHash(tokenHash: string): Promise<DeviceRecord | null> {
    return [...state().devices.values()].find((device) => device.tokenHash === tokenHash) ?? null;
  }

  async findDeviceById(id: string): Promise<DeviceRecord | null> {
    return state().devices.get(id) ?? null;
  }

  async listDevices(): Promise<DeviceRecord[]> {
    return [...state().devices.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async touchDevice(id: string): Promise<void> {
    const existing = requireDevice(id);
    state().devices.set(id, { ...existing, lastSeenAt: new Date(), updatedAt: new Date() });
  }

  async updateDeviceStatus(
    id: string,
    status: DeviceRecord["status"],
  ): Promise<DeviceRecord> {
    const updated = { ...requireDevice(id), status, updatedAt: new Date() };
    state().devices.set(id, updated);
    return updated;
  }
}
