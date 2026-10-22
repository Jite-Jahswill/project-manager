-- Stage 2B: MFA foundation (docs/security/mfa.md).
-- Part 1: Prisma-generated, purely additive DDL (reviewed: two nullable columns, four new tables).

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "mfa_verified_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mfa_enabled_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "user_mfa_factors" (
    "user_id" UUID NOT NULL,
    "secret_ciphertext" TEXT NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3) NOT NULL,
    "last_used_step" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_mfa_factors_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_mfa_enrollments" (
    "user_id" UUID NOT NULL,
    "secret_ciphertext" TEXT NOT NULL,
    "email_code_hash" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_mfa_enrollments_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_mfa_recovery_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "client_type" "ClientType" NOT NULL,
    "device_name" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_mfa_recovery_codes_user_id_code_hash_key" ON "user_mfa_recovery_codes"("user_id", "code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_challenges_token_hash_key" ON "mfa_challenges"("token_hash");

-- CreateIndex
CREATE INDEX "mfa_challenges_user_id_idx" ON "mfa_challenges"("user_id");

-- AddForeignKey
ALTER TABLE "user_mfa_factors" ADD CONSTRAINT "user_mfa_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mfa_enrollments" ADD CONSTRAINT "user_mfa_enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mfa_recovery_codes" ADD CONSTRAINT "user_mfa_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Part 2 (hand-written): integrity, privileges and the owner-policy helper.

ALTER TABLE "user_mfa_factors" ADD CONSTRAINT "user_mfa_factors_step_nonneg" CHECK ("last_used_step" >= 0);
ALTER TABLE "user_mfa_factors" ADD CONSTRAINT "user_mfa_factors_ciphertext_format" CHECK ("secret_ciphertext" LIKE 'v1:%');
ALTER TABLE "user_mfa_enrollments" ADD CONSTRAINT "user_mfa_enrollments_attempts_nonneg" CHECK ("attempts" >= 0);
ALTER TABLE "user_mfa_enrollments" ADD CONSTRAINT "user_mfa_enrollments_ciphertext_format" CHECK ("secret_ciphertext" LIKE 'v1:%');
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_attempts_nonneg" CHECK ("attempts" >= 0);

-- MFA secret material: the credential-store role only. The application role
-- (every tenant/business query) has no privilege on these tables at all.
REVOKE ALL ON "user_mfa_factors", "user_mfa_enrollments", "user_mfa_recovery_codes" FROM PUBLIC;
REVOKE ALL ON "user_mfa_factors", "user_mfa_enrollments", "user_mfa_recovery_codes" FROM ventidoc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "user_mfa_factors", "user_mfa_enrollments", "user_mfa_recovery_codes" TO ventidoc_auth;

-- Pending second-factor challenges hold only token hashes and metadata (no secrets).
GRANT SELECT, INSERT, UPDATE, DELETE ON "mfa_challenges" TO ventidoc_app;

-- Mandatory-MFA policy needs "does the context user own any active organization?"
-- outside any tenant context. Returns a boolean only, for the context user only.
CREATE FUNCTION app_current_user_owns_any_org() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1
      FROM membership_roles mr
      JOIN roles r ON r.id = mr.role_id AND r.organization_id = mr.organization_id
      JOIN organization_memberships m ON m.id = mr.membership_id AND m.organization_id = mr.organization_id
      JOIN organizations o ON o.id = mr.organization_id
      WHERE m.user_id = app_current_user_id()
        AND m.status = 'ACTIVE' AND o.status = 'ACTIVE'
        AND mr.branch_id IS NULL AND r.is_system AND r.template_key = 'owner')
  $$;
GRANT SELECT ON membership_roles, roles TO ventidoc_rls;
GRANT CREATE ON SCHEMA public TO ventidoc_rls;
ALTER FUNCTION app_current_user_owns_any_org() OWNER TO ventidoc_rls;
REVOKE CREATE ON SCHEMA public FROM ventidoc_rls;
REVOKE EXECUTE ON FUNCTION app_current_user_owns_any_org() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_current_user_owns_any_org() TO ventidoc_app;
