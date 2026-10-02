-- Baseline schema before the demo-account migration.
CREATE TABLE "alembic_version" (
    "version_num" VARCHAR(32) NOT NULL,

    CONSTRAINT "alembic_version_pkc" PRIMARY KEY ("version_num")
);

CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR NOT NULL,
    "last_name" VARCHAR NOT NULL,
    "username" VARCHAR NOT NULL,
    "email" VARCHAR NOT NULL,
    "password" VARCHAR NOT NULL,
    "phonenumber" VARCHAR,
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,
    "status" VARCHAR,
    "is_active" BOOLEAN NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "monitor" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR NOT NULL,
    "target" VARCHAR NOT NULL,
    "frequency" INTEGER NOT NULL,
    "state" VARCHAR NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL,
    "check_type" VARCHAR NOT NULL,
    "check_config" JSON,
    "last_state" VARCHAR,
    "last_checked_at" TIMESTAMP(6),
    "consecutive_failures" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,

    CONSTRAINT "monitor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "check_result" (
    "id" SERIAL NOT NULL,
    "monitor_id" INTEGER NOT NULL,
    "state" VARCHAR NOT NULL,
    "status_code" INTEGER,
    "latency_ms" DOUBLE PRECISION,
    "response_sample" VARCHAR,
    "error_message" VARCHAR,
    "extra_data" JSON,
    "created_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "check_result_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "alert" (
    "id" SERIAL NOT NULL,
    "monitor_id" INTEGER NOT NULL,
    "alert_type" VARCHAR NOT NULL,
    "message" VARCHAR NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "alert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ix_users_username" ON "users"("username");
CREATE UNIQUE INDEX "ix_users_email" ON "users"("email");
CREATE INDEX "ix_users_last_name" ON "users"("last_name");
CREATE INDEX "ix_users_name" ON "users"("name");
CREATE INDEX "ix_monitor_name" ON "monitor"("name");
CREATE INDEX "ix_check_result_monitor_id" ON "check_result"("monitor_id");

ALTER TABLE "monitor" ADD CONSTRAINT "monitor_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "check_result" ADD CONSTRAINT "check_result_monitor_id_fkey"
    FOREIGN KEY ("monitor_id") REFERENCES "monitor"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "alert" ADD CONSTRAINT "alert_monitor_id_fkey"
    FOREIGN KEY ("monitor_id") REFERENCES "monitor"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
