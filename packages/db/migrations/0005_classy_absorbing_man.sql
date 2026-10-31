ALTER TABLE "transactions" ADD COLUMN "original_currency" varchar(3);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "original_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "fx_rate" real;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_original_amount_positive_ck" CHECK ("transactions"."original_amount_cents" IS NULL OR "transactions"."original_amount_cents" > 0);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_original_fields_pair_ck" CHECK (("transactions"."original_currency" IS NULL) = ("transactions"."original_amount_cents" IS NULL) AND ("transactions"."original_currency" IS NULL) = ("transactions"."fx_rate" IS NULL));