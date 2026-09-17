import { and, desc, eq, gt, isNull } from "drizzle-orm";

import { getDb } from "@/db/client";
import { deviceClaims, devices, events } from "@/db/schema";
import type { DeviceClaimRecord, DeviceRecord, EventRecord } from "@/lib/types";
import type {
  ClaimDeviceInput,
  CreateClaimInput,
  CreateEventInput,
  EventSettings,
  FleetRepository,
} from "./types";

function firstOrThrow<T>(rows: T[], kind: string, id: string): T {
  const row = rows[0];
  if (!row) throw new Error(`${kind} ${id} was not found`);
  return row;
}

export class NeonFleetRepository implements FleetRepository {
  async createEvent(input: CreateEventInput): Promise<EventRecord> {
    const now = new Date();
    const rows = await getDb()
      .insert(events)
      .values({ ...input, createdAt: now, updatedAt: now })
      .returning();
    return firstOrThrow(rows, "Event", input.id);
  }

  async listEvents(): Promise<EventRecord[]> {
    return getDb().select().from(events).orderBy(desc(events.createdAt));
  }

  async findEventById(id: string): Promise<EventRecord | null> {
    const rows = await getDb().select().from(events).where(eq(events.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async createClaim(input: CreateClaimInput): Promise<DeviceClaimRecord> {
    const rows = await getDb()
      .insert(deviceClaims)
      .values({ ...input, createdAt: new Date() })
      .returning();
    return firstOrThrow(rows, "Claim", input.id);
  }

  async updateEventSettings(id: string, settings: EventSettings): Promise<EventRecord> {
    const rows = await getDb().update(events)
      .set({ ...settings, updatedAt: new Date() })
      .where(eq(events.id, id)).returning();
    return firstOrThrow(rows, "Event", id);
  }

  async listClaims(limit = 30): Promise<DeviceClaimRecord[]> {
    return getDb().select().from(deviceClaims).orderBy(desc(deviceClaims.createdAt)).limit(limit);
  }

  async claimDevice(input: ClaimDeviceInput): Promise<DeviceRecord | null> {
    return getDb().transaction(async (transaction) => {
      const now = new Date();
      const claimed = await transaction
        .update(deviceClaims)
        .set({ claimedAt: now })
        .where(
          and(
            eq(deviceClaims.codeHash, input.codeHash),
            isNull(deviceClaims.claimedAt),
            gt(deviceClaims.expiresAt, now),
          ),
        )
        .returning();
      const claim = claimed[0];
      if (!claim) return null;
      const rows = await transaction
        .insert(devices)
        .values({
          id: input.deviceId,
          name: input.deviceName || claim.suggestedName || "Muse Cam",
          tokenHash: input.tokenHash,
          eventId: claim.eventId,
          status: "active",
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return firstOrThrow(rows, "Device", input.deviceId);
    });
  }

  async findDeviceByTokenHash(tokenHash: string): Promise<DeviceRecord | null> {
    const rows = await getDb()
      .select()
      .from(devices)
      .where(eq(devices.tokenHash, tokenHash))
      .limit(1);
    return rows[0] ?? null;
  }

  async findDeviceById(id: string): Promise<DeviceRecord | null> {
    const rows = await getDb().select().from(devices).where(eq(devices.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async listDevices(): Promise<DeviceRecord[]> {
    return getDb().select().from(devices).orderBy(devices.name);
  }

  async touchDevice(id: string): Promise<void> {
    const now = new Date();
    await getDb().update(devices).set({ lastSeenAt: now, updatedAt: now }).where(eq(devices.id, id));
  }

  async updateDeviceEvent(id: string, eventId: string | null): Promise<DeviceRecord> {
    const rows = await getDb()
      .update(devices)
      .set({ eventId, updatedAt: new Date() })
      .where(eq(devices.id, id))
      .returning();
    return firstOrThrow(rows, "Device", id);
  }

  async updateDeviceStatus(
    id: string,
    status: DeviceRecord["status"],
  ): Promise<DeviceRecord> {
    const rows = await getDb()
      .update(devices)
      .set({ status, updatedAt: new Date() })
      .where(eq(devices.id, id))
      .returning();
    return firstOrThrow(rows, "Device", id);
  }
}
