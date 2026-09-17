import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const photoStatus = pgEnum("photo_status", ["processing", "complete", "failed"]);
export const deviceStatus = pgEnum("device_status", ["active", "revoked"]);

export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    publishOriginals: boolean("publish_originals").notNull().default(false),
    autoShare: boolean("auto_share").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [uniqueIndex("events_slug_unique").on(table.slug)],
);

export const devices = pgTable(
  "devices",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    eventId: text("event_id").references(() => events.id, { onDelete: "set null" }),
    status: deviceStatus("status").notNull().default("active"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("devices_token_hash_unique").on(table.tokenHash),
    index("devices_event_idx").on(table.eventId),
  ],
);

export const deviceClaims = pgTable(
  "device_claims",
  {
    id: text("id").primaryKey(),
    codeHash: text("code_hash").notNull(),
    suggestedName: text("suggested_name"),
    eventId: text("event_id").references(() => events.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [uniqueIndex("device_claims_code_hash_unique").on(table.codeHash)],
);

export const photos = pgTable(
  "photos",
  {
    id: text("id").primaryKey(),
    captureId: text("capture_id").notNull(),
    deviceId: text("device_id").notNull(),
    eventId: text("event_id").references(() => events.id, { onDelete: "set null" }),
    presetId: text("preset_id").notNull(),
    presetVersion: integer("preset_version").notNull(),
    status: photoStatus("status").notNull().default("processing"),
    autoSharePending: boolean("auto_share_pending").notNull().default(false),
    capturedAtDevice: timestamp("captured_at_device", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    sharedAt: timestamp("shared_at", { withTimezone: true, mode: "date" }),
    publicSlug: text("public_slug"),
    originalPrivateRef: text("original_private_ref"),
    resultPrivateRef: text("result_private_ref"),
    resultPublicUrl: text("result_public_url"),
    originalPublicUrl: text("original_public_url"),
    resultMimeType: text("result_mime_type"),
    width: integer("width"),
    height: integer("height"),
    errorCode: text("error_code"),
  },
  (table) => [
    uniqueIndex("photos_capture_id_unique").on(table.captureId),
    uniqueIndex("photos_public_slug_unique").on(table.publicSlug),
    index("photos_shared_at_idx").on(table.sharedAt),
    index("photos_device_created_idx").on(table.deviceId, table.createdAt),
    index("photos_event_shared_idx").on(table.eventId, table.sharedAt),
  ],
);

// Persist camera deletions even when the upload response was lost or is still in flight.
export const captureRetractions = pgTable(
  "capture_retractions",
  {
    deviceId: text("device_id").notNull(),
    captureId: text("capture_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.deviceId, table.captureId] })],
);
