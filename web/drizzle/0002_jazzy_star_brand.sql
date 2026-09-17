CREATE TABLE "capture_retractions" (
	"device_id" text NOT NULL,
	"capture_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "capture_retractions_device_id_capture_id_pk" PRIMARY KEY("device_id","capture_id")
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "auto_share" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "auto_share_pending" boolean DEFAULT false NOT NULL;