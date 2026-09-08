-- Promote existing ORGANIZER users before removing the enum value.
UPDATE "users"
SET "role" = 'ADMIN'
WHERE "role" = 'ORGANIZER';

-- Rebuild the enum without ORGANIZER.
ALTER TYPE "Role" RENAME TO "Role_old";
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users"
  ALTER COLUMN "role" TYPE "Role"
  USING ("role"::text::"Role");
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'USER';
DROP TYPE "Role_old";

-- Persist administrative changes for auditability.
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_target_id_idx" ON "audit_logs"("target_id");
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
