import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { deviceClaims, devices, events } from "@/db/schema";
import type { DeviceClaimRecord, DeviceRecord, EventRecord } from "@/lib/types";
import type {
  ClaimDeviceInput,
  ConfiguredDeviceInput,
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

  async findEventBySlug(slug: string): Promise<EventRecord | null> {
    const rows = await getDb().select().from(events).where(eq(events.slug, slug)).limit(1);
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
    const db = getDb();
    const now = new Date();
    // neon-http cannot run interactive transactions. Consuming the code and
    // inserting its device in one statement keeps both operations atomic.
    const claim = db.$with("claimed_code").as(
      db
        .update(deviceClaims)
        .set({ claimedAt: now })
        .where(
          and(
            eq(deviceClaims.codeHash, input.codeHash),
            isNull(deviceClaims.claimedAt),
            gt(deviceClaims.expiresAt, now),
          ),
        )
        .returning(),
    );
    const rows = await db.with(claim)
      .insert(devices)
      .select(
        db.select({
          id: sql<string>`${input.deviceId}`.as("id"),
          name: sql<string>`coalesce(nullif(${input.deviceName}, ''), nullif(${claim.suggestedName}, ''), 'Muse Cam')`.as("name"),
          tokenHash: sql<string>`${input.tokenHash}`.as("token_hash"),
          eventId: claim.eventId,
          status: sql<"active">`'active'::device_status`.as("status"),
          lastSeenAt: claim.claimedAt,
          createdAt: claim.claimedAt,
          updatedAt: claim.claimedAt,
        }).from(claim),
      )
      .returning();
    return rows[0] ?? null;
  }

  async findDeviceByTokenHash(tokenHash: string): Promise<DeviceRecord | null> {
    const rows = await getDb()
      .select()
      .from(devices)
      .where(eq(devices.tokenHash, tokenHash))
      .limit(1);
    return rows[0] ?? null;
  }

  async syncConfiguredDevice(input: ConfiguredDeviceInput): Promise<DeviceRecord> {
    const now = new Date();
    const rows = await getDb().insert(devices).values({
      ...input,
      name: input.id,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: devices.id,
      set: { tokenHash: input.tokenHash, updatedAt: now },
      setWhere: ne(devices.tokenHash, input.tokenHash),
    }).returning();
    // Repeated requests preserve the operator's event, name, and revoked status.
    if (rows[0]) return rows[0];
    return firstOrThrow(await getDb().select().from(devices).where(eq(devices.id, input.id)), "Device", input.id);
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
