CREATE TABLE "layouts" (
	"id" text PRIMARY KEY NOT NULL,
	"home_id" text NOT NULL,
	"name" text NOT NULL,
	"schema_version" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "layouts" ADD CONSTRAINT "layouts_home_id_homes_id_fk" FOREIGN KEY ("home_id") REFERENCES "public"."homes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "layouts_home_id_idx" ON "layouts" USING btree ("home_id");