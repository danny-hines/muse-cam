ALTER TABLE "events" ADD COLUMN "preset_ids" text[];--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "surprise_styles" boolean DEFAULT false NOT NULL;