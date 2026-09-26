-- Every photo now belongs to an event. Move photos and cameras that predate
-- event assignment into a personal event with the same sharing behavior they had.
INSERT INTO "events" ("id", "slug", "name", "publish_originals", "auto_share", "created_at", "updated_at")
SELECT gen_random_uuid()::text, 'danny-personal', 'Danny Personal', false, false, now(), now()
WHERE EXISTS (SELECT 1 FROM "photos" WHERE "event_id" IS NULL)
   OR EXISTS (SELECT 1 FROM "devices" WHERE "event_id" IS NULL)
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
UPDATE "photos" SET "event_id" = (SELECT "id" FROM "events" WHERE "slug" = 'danny-personal')
WHERE "event_id" IS NULL;--> statement-breakpoint
UPDATE "devices" SET "event_id" = (SELECT "id" FROM "events" WHERE "slug" = 'danny-personal')
WHERE "event_id" IS NULL;--> statement-breakpoint
ALTER TABLE "photos" DROP CONSTRAINT "photos_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "photos" ALTER COLUMN "event_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;
