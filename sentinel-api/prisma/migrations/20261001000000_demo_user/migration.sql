ALTER TABLE "users" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "monitor" ADD COLUMN "seed_key" VARCHAR;
CREATE UNIQUE INDEX "uq_monitor_user_seed_key" ON "monitor"("user_id", "seed_key");
