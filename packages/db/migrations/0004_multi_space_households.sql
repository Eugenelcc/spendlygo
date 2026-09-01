ALTER TABLE "households" ADD COLUMN "is_personal" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE "household_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "household_members_household_user_uq" ON "household_members" USING btree ("household_id","user_id");
--> statement-breakpoint
CREATE INDEX "household_members_user_idx" ON "household_members" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "active_household_id" uuid;
--> statement-breakpoint
-- Preserve every existing shared membership as a row in the new join table,
-- before touching anything else.
INSERT INTO "household_members" ("household_id", "user_id")
SELECT "household_id", "id" FROM "users" WHERE "household_id" IS NOT NULL;
--> statement-breakpoint
-- Every user gets a personal space (PRD: multi-space households) seeded from
-- their current solo budget, becomes a member of it, and — only if they were
-- not already active in a shared household — starts out active in it.
WITH new_personal AS (
	INSERT INTO "households" ("created_by", "is_personal", "monthly_budget_cents")
	SELECT "id", true, "monthly_budget_cents" FROM "users"
	RETURNING "id", "created_by"
), inserted_members AS (
	INSERT INTO "household_members" ("household_id", "user_id")
	SELECT "id", "created_by" FROM new_personal
	RETURNING "household_id", "user_id"
)
UPDATE "users"
SET "active_household_id" = COALESCE("users"."household_id", new_personal."id")
FROM new_personal
WHERE new_personal."created_by" = "users"."id";
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_active_household_id_households_id_fk" FOREIGN KEY ("active_household_id") REFERENCES "public"."households"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_household_id_households_id_fk";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "household_id";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "monthly_budget_cents";
--> statement-breakpoint
-- Every transaction logged while solo now belongs to the author's new
-- personal space, so household_id can become the single source of scope.
UPDATE "transactions" t
SET "household_id" = h."id"
FROM "households" h
WHERE t."household_id" IS NULL AND h."created_by" = t."user_id" AND h."is_personal" = true;
--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "household_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_household_id_households_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
DROP INDEX "transactions_household_date_idx";
--> statement-breakpoint
CREATE INDEX "transactions_household_date_idx" ON "transactions" USING btree ("household_id","occurred_on") WHERE "transactions"."deleted_at" IS NULL;
