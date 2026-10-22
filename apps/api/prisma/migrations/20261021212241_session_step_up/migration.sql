-- DropIndex
DROP INDEX "membership_overrides_unique";

-- DropIndex
DROP INDEX "membership_roles_unique_assignment";

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "reauthenticated_at" TIMESTAMPTZ(3);
