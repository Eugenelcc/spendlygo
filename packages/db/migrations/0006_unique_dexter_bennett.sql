CREATE TABLE "transaction_splits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"share_cents" integer NOT NULL,
	CONSTRAINT "transaction_splits_share_positive_ck" CHECK ("transaction_splits"."share_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_splits_tx_user_uq" ON "transaction_splits" USING btree ("transaction_id","user_id");--> statement-breakpoint
CREATE INDEX "transaction_splits_user_idx" ON "transaction_splits" USING btree ("user_id");