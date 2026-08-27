CREATE TYPE "public"."cadence" AS ENUM('daily', 'weekly', 'monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('expense', 'income');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."ocr_status" AS ENUM('none', 'pending', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."transaction_source" AS ENUM('chat', 'miniapp', 'recurring');--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid,
	"user_id" uuid NOT NULL,
	"tg_file_id" text NOT NULL,
	"tg_file_unique_id" text NOT NULL,
	"width" integer,
	"height" integer,
	"file_size" integer,
	"ocr_status" "ocr_status" DEFAULT 'none' NOT NULL,
	"ocr_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"budget_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_periods_month_ck" CHECK ("budget_periods"."month" BETWEEN 1 AND 12),
	CONSTRAINT "budget_periods_budget_ck" CHECK ("budget_periods"."budget_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"emoji" text NOT NULL,
	"color_token" text NOT NULL,
	"kind" "category_kind" NOT NULL,
	"keywords" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"exclude_from_budget" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"direction" "direction" NOT NULL,
	"amount_cents" integer NOT NULL,
	"category_id" uuid,
	"note" text,
	"cadence" "cadence" NOT NULL,
	"anchor_date" date NOT NULL,
	"day_of_month" smallint,
	"end_date" date,
	"last_run_on" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_rules_amount_positive_ck" CHECK ("recurring_rules"."amount_cents" > 0),
	CONSTRAINT "recurring_rules_day_of_month_ck" CHECK ("recurring_rules"."day_of_month" IS NULL OR "recurring_rules"."day_of_month" BETWEEN 1 AND 31)
);
--> statement-breakpoint
CREATE TABLE "recurring_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"occurrence_date" date NOT NULL,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"direction" "direction" NOT NULL,
	"amount_cents" integer NOT NULL,
	"category_id" uuid,
	"note" text,
	"occurred_on" date NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "transaction_source" DEFAULT 'chat' NOT NULL,
	"recurring_rule_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_amount_positive_ck" CHECK ("transactions"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" bigint NOT NULL,
	"first_name" text,
	"username" text,
	"timezone" text DEFAULT 'Asia/Singapore' NOT NULL,
	"currency" varchar(3) DEFAULT 'SGD' NOT NULL,
	"locale" text DEFAULT 'en-SG' NOT NULL,
	"monthly_budget_cents" integer,
	"digest_hour" smallint DEFAULT 21 NOT NULL,
	"digest_enabled" boolean DEFAULT true NOT NULL,
	"nudge_enabled" boolean DEFAULT true NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_digest_hour_ck" CHECK ("users"."digest_hour" BETWEEN 0 AND 23),
	CONSTRAINT "users_monthly_budget_ck" CHECK ("users"."monthly_budget_cents" IS NULL OR "users"."monthly_budget_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_periods" ADD CONSTRAINT "budget_periods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_runs" ADD CONSTRAINT "recurring_runs_rule_id_recurring_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."recurring_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_runs" ADD CONSTRAINT "recurring_runs_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_transaction_idx" ON "attachments" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "attachments_user_idx" ON "attachments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_periods_user_period_uq" ON "budget_periods" USING btree ("user_id","year","month");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_slug_uq" ON "categories" USING btree ("user_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_system_slug_uq" ON "categories" USING btree ("slug") WHERE "categories"."user_id" IS NULL;--> statement-breakpoint
CREATE INDEX "categories_user_idx" ON "categories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "events_user_created_idx" ON "events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "recurring_rules_user_active_idx" ON "recurring_rules" USING btree ("user_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_runs_rule_date_uq" ON "recurring_runs" USING btree ("rule_id","occurrence_date");--> statement-breakpoint
CREATE INDEX "transactions_user_date_idx" ON "transactions" USING btree ("user_id","occurred_on") WHERE "transactions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "transactions_user_created_idx" ON "transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "transactions_category_idx" ON "transactions" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_telegram_id_uq" ON "users" USING btree ("telegram_id");