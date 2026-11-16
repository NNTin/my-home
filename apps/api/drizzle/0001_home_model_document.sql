-- The Epic 1 sample rows have no model document; they are replaced by the seeded mock home.
DELETE FROM "homes";--> statement-breakpoint
ALTER TABLE "homes" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "homes" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "homes" ADD COLUMN "schema_version" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "homes" ADD COLUMN "model" jsonb NOT NULL;