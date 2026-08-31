CREATE TABLE "savings_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target_cents" integer NOT NULL,
	"target_date" date,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "savings_goals_target_positive_ck" CHECK ("savings_goals"."target_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "savings_goal_id" uuid;--> statement-breakpoint
ALTER TABLE "savings_goals" ADD CONSTRAINT "savings_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "savings_goals_user_idx" ON "savings_goals" USING btree ("user_id") WHERE "savings_goals"."archived_at" IS NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_savings_goal_id_savings_goals_id_fk" FOREIGN KEY ("savings_goal_id") REFERENCES "public"."savings_goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_savings_goal_idx" ON "transactions" USING btree ("savings_goal_id") WHERE "transactions"."deleted_at" IS NULL AND "transactions"."savings_goal_id" IS NOT NULL;