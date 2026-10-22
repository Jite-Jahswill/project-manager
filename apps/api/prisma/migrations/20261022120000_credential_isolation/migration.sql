-- Security gate 2026-10-22, concern A: isolate password hashes from the
-- application role. Hand-written (Prisma's generated version dropped the column
-- before copying it, which would have locked every user out).
-- Requires role ventidoc_auth (docker/postgres/init/01-roles.sh).

CREATE TABLE "user_credentials" (
    "user_id" UUID NOT NULL,
    "password_hash" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_credentials_pkey" PRIMARY KEY ("user_id")
);
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copy existing hashes, then remove them from the table the application role can read.
INSERT INTO "user_credentials" ("user_id", "password_hash")
SELECT "id", "password_hash" FROM "users";
ALTER TABLE "users" DROP COLUMN "password_hash";

-- Only the credential-store role may touch hashes. It gets nothing else.
REVOKE ALL ON "user_credentials" FROM PUBLIC;
REVOKE ALL ON "user_credentials" FROM ventidoc_app;
GRANT SELECT, INSERT, UPDATE ON "user_credentials" TO ventidoc_auth;
