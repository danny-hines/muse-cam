CREATE TABLE "event_styles" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"accent" text NOT NULL,
	"hue" integer NOT NULL,
	"prompt" text NOT NULL,
	"reference_image_refs" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
