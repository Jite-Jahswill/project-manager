-- Stage 2C: email platform (docs/architecture/08-email-platform.md, docs/security/email.md).
-- Part 1: Prisma-generated, purely additive DDL (reviewed: new enums and tables only).

-- CreateEnum
CREATE TYPE "EmailProviderKind" AS ENUM ('RESEND', 'SMTP', 'LOG', 'CAPTURE');

-- CreateEnum
CREATE TYPE "EmailProviderStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "EmailTemplateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "EmailJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'EXPIRED', 'DISCARDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EmailAttemptOutcome" AS ENUM ('SENT', 'RETRYABLE', 'PERMANENT', 'AMBIGUOUS');

-- CreateEnum
CREATE TYPE "EmailSuppressionReason" AS ENUM ('BOUNCE', 'COMPLAINT', 'MANUAL');

-- CreateTable
CREATE TABLE "email_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "active_provider_id" UUID,
    "sending_enabled" BOOLEAN NOT NULL DEFAULT false,
    "default_sender_id" UUID,
    "retry_max_attempts" INTEGER NOT NULL DEFAULT 8,
    "retry_base_delay_seconds" INTEGER NOT NULL DEFAULT 30,
    "retry_max_delay_seconds" INTEGER NOT NULL DEFAULT 3600,
    "max_sends_per_minute" INTEGER NOT NULL DEFAULT 120,
    "test_recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "email_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_providers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "EmailProviderKind" NOT NULL,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "secret_configured" BOOLEAN NOT NULL DEFAULT false,
    "secret_hint" TEXT,
    "status" "EmailProviderStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "last_checked_at" TIMESTAMPTZ(3),
    "last_check_summary" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "email_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_provider_secrets" (
    "provider_id" UUID NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_provider_secrets_pkey" PRIMARY KEY ("provider_id")
);

-- CreateTable
CREATE TABLE "email_sender_identities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "reply_to" TEXT,
    "domain" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "verification_source" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "email_sender_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "text_body" TEXT NOT NULL,
    "html_body" TEXT NOT NULL,
    "status" "EmailTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "activated_at" TIMESTAMPTZ(3),
    "activated_by" UUID,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_outbox" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "template_key" TEXT NOT NULL,
    "template_version" INTEGER,
    "organization_id" UUID,
    "recipient_user_id" UUID,
    "recipient_email" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "sensitive_ciphertext" TEXT,
    "status" "EmailJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(3),
    "locked_by" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "test_send" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT,
    "provider_message_id" TEXT,
    "last_error_code" TEXT,
    "last_error" TEXT,
    "content_wiped_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_delivery_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "outbox_id" UUID NOT NULL,
    "organization_id" UUID,
    "attempt" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3) NOT NULL,
    "outcome" "EmailAttemptOutcome" NOT NULL,
    "error_code" TEXT,
    "error_summary" TEXT,
    "provider_message_id" TEXT,
    "duration_ms" INTEGER NOT NULL,

    CONSTRAINT "email_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_suppressions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "reason" "EmailSuppressionReason" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_providers_name_key" ON "email_providers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "email_sender_identities_email_key" ON "email_sender_identities"("email");

-- CreateIndex
CREATE UNIQUE INDEX "email_templates_key_version_key" ON "email_templates"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "email_outbox_idempotency_key_key" ON "email_outbox"("idempotency_key");

-- CreateIndex
CREATE INDEX "email_outbox_status_next_attempt_at_idx" ON "email_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "email_outbox_organization_id_idx" ON "email_outbox"("organization_id");

-- CreateIndex
CREATE INDEX "email_delivery_attempts_outbox_id_idx" ON "email_delivery_attempts"("outbox_id");

-- CreateIndex
CREATE INDEX "email_delivery_attempts_finished_at_idx" ON "email_delivery_attempts"("finished_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_suppressions_email_key" ON "email_suppressions"("email");

-- AddForeignKey
ALTER TABLE "email_settings" ADD CONSTRAINT "email_settings_active_provider_id_fkey" FOREIGN KEY ("active_provider_id") REFERENCES "email_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_settings" ADD CONSTRAINT "email_settings_default_sender_id_fkey" FOREIGN KEY ("default_sender_id") REFERENCES "email_sender_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_provider_secrets" ADD CONSTRAINT "email_provider_secrets_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "email_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_delivery_attempts" ADD CONSTRAINT "email_delivery_attempts_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "email_outbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Part 2 (hand-written): integrity, privileges and row-level security.

ALTER TABLE email_settings ADD CONSTRAINT email_settings_singleton CHECK (id = 1);
ALTER TABLE email_settings ADD CONSTRAINT email_settings_retry_bounds CHECK (
  retry_max_attempts BETWEEN 1 AND 20 AND retry_base_delay_seconds BETWEEN 1 AND 3600
  AND retry_max_delay_seconds BETWEEN retry_base_delay_seconds AND 86400 AND max_sends_per_minute BETWEEN 1 AND 10000);
ALTER TABLE email_sender_identities ADD CONSTRAINT email_sender_email_normalized CHECK (email = lower(btrim(email)) AND position('@' in email) > 1);
ALTER TABLE email_suppressions ADD CONSTRAINT email_suppression_email_normalized CHECK (email = lower(btrim(email)));
ALTER TABLE email_templates ADD CONSTRAINT email_templates_version_positive CHECK (version >= 1);
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_attempts_nonneg CHECK (attempts >= 0);
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_sent_at CHECK ((status = 'SENT') = (sent_at IS NOT NULL));
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_sensitive_format CHECK (sensitive_ciphertext IS NULL OR sensitive_ciphertext LIKE 'v1:%');

-- Exactly one active version per template key.
CREATE UNIQUE INDEX email_templates_one_active_per_key ON email_templates (key) WHERE status = 'ACTIVE';

-- Delivery-worker context (set only by TenantDb.asEmailWorker). Not referenced by any
-- business-data policy.
CREATE FUNCTION app_email_worker_scope() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT COALESCE(current_setting('app.email_worker', true), '') = 'on' $$;
GRANT EXECUTE ON FUNCTION app_email_worker_scope() TO ventidoc_app;

-- Provider credentials: the credential-store role only (like user_credentials / MFA).
REVOKE ALL ON email_provider_secrets FROM PUBLIC;
REVOKE ALL ON email_provider_secrets FROM ventidoc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON email_provider_secrets TO ventidoc_auth;

-- Configuration: readable by platform administrators and the delivery worker,
-- writable only in platform scope. Not FORCEd: the migrator seeds defaults.
GRANT SELECT, INSERT, UPDATE, DELETE ON email_settings, email_providers, email_sender_identities, email_templates, email_suppressions TO ventidoc_app;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['email_settings', 'email_providers', 'email_sender_identities', 'email_templates', 'email_suppressions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY email_config_read ON %I FOR SELECT TO ventidoc_app USING (app_platform_scope() OR app_email_worker_scope())', t);
    EXECUTE format('CREATE POLICY email_config_write ON %I FOR ALL TO ventidoc_app USING (app_platform_scope()) WITH CHECK (app_platform_scope())', t);
  END LOOP;
END
$$;

-- Outbox and attempts: FORCEd. Rows can be enqueued from identity flows (no organization),
-- by a verified member of the organization they belong to, or in platform scope. Nobody in
-- a tenant context can read them back (no company can see another's, or even its own, raw
-- message content); only the worker and platform administrators (metadata via the API) can.
GRANT SELECT, INSERT, UPDATE ON email_outbox TO ventidoc_app;
GRANT SELECT, INSERT ON email_delivery_attempts TO ventidoc_app;
ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_outbox FORCE ROW LEVEL SECURITY;
ALTER TABLE email_delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_delivery_attempts FORCE ROW LEVEL SECURITY;

CREATE POLICY email_outbox_insert ON email_outbox FOR INSERT TO ventidoc_app WITH CHECK (
  organization_id IS NULL
  OR (organization_id = app_current_org_id() AND (SELECT app_tenant_ok()))
  OR app_platform_scope()
  OR app_email_worker_scope()
);
CREATE POLICY email_outbox_read ON email_outbox FOR SELECT TO ventidoc_app
  USING (app_platform_scope() OR app_email_worker_scope());
CREATE POLICY email_outbox_update ON email_outbox FOR UPDATE TO ventidoc_app
  USING (app_platform_scope() OR app_email_worker_scope())
  WITH CHECK (app_platform_scope() OR app_email_worker_scope());

CREATE POLICY email_attempts_insert ON email_delivery_attempts FOR INSERT TO ventidoc_app WITH CHECK (app_email_worker_scope());
CREATE POLICY email_attempts_read ON email_delivery_attempts FOR SELECT TO ventidoc_app
  USING (app_platform_scope() OR app_email_worker_scope());
