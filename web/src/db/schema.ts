import { index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const photoStatus = pgEnum("photo_status", ["processing", "complete", "failed"]);

export const photos = pgTable(
  "photos",
  {
    id: text("id").primaryKey(),
    captureId: text("capture_id").notNull(),
    deviceId: text("device_id").notNull(),
    presetId: text("preset_id").notNull(),
    presetVersion: integer("preset_version").notNull(),
    status: photoStatus("status").notNull().default("processing"),
    capturedAtDevice: timestamp("captured_at_device", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    sharedAt: timestamp("shared_at", { withTimezone: true, mode: "date" }),
    publicSlug: text("public_slug"),
    originalPrivateRef: text("original_private_ref"),
    resultPrivateRef: text("result_private_ref"),
    resultPublicUrl: text("result_public_url"),
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
  ],
);
