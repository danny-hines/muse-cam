CREATE TYPE "public"."photo_status" AS ENUM('processing', 'complete', 'failed');--> statement-breakpoint
CREATE TABLE "photos" (
	"id" text PRIMARY KEY NOT NULL,
	"capture_id" text NOT NULL,
	"device_id" text NOT NULL,
	"preset_id" text NOT NULL,
	"preset_version" integer NOT NULL,
	"status" "photo_status" DEFAULT 'processing' NOT NULL,
	"captured_at_device" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"shared_at" timestamp with time zone,
	"public_slug" text,
	"original_private_ref" text,
	"result_private_ref" text,
	"result_public_url" text,
	"result_mime_type" text,
	"width" integer,
	"height" integer,
	"error_code" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "photos_capture_id_unique" ON "photos" USING btree ("capture_id");--> statement-breakpoint
CREATE UNIQUE INDEX "photos_public_slug_unique" ON "photos" USING btree ("public_slug");--> statement-breakpoint
CREATE INDEX "photos_shared_at_idx" ON "photos" USING btree ("shared_at");--> statement-breakpoint
CREATE INDEX "photos_device_created_idx" ON "photos" USING btree ("device_id","created_at");