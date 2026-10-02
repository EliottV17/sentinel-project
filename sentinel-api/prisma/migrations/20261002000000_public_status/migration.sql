ALTER TABLE "monitor" ADD COLUMN "is_public" BOOLEAN NOT NULL DEFAULT false;

DROP INDEX "ix_check_result_monitor_id";
CREATE INDEX "ix_check_result_monitor_id_created_at"
  ON "check_result"("monitor_id", "created_at");
