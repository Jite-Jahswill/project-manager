-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "archived_at" TIMESTAMPTZ(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "organization_invitations" ADD COLUMN     "last_sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "resend_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- ===========================================================================
-- Hand-written: organization and branch lifecycle (docs/architecture/10-organizations.md).
-- ===========================================================================

-- 1. Data fixes before the new constraints (existing rows must satisfy them).
UPDATE branches SET archived_at = updated_at WHERE status = 'ARCHIVED' AND archived_at IS NULL;
-- An invitation pointing at a branch of another organization (never created by the API, which
-- checks branches under RLS) cannot satisfy the new foreign key: revoke and detach it.
UPDATE organization_invitations i SET branch_id = NULL, revoked_at = COALESCE(i.revoked_at, now())
  WHERE i.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM branches b WHERE b.id = i.branch_id AND b.organization_id = i.organization_id);
-- At most one open invitation per address: keep the newest, revoke older duplicates.
UPDATE organization_invitations i SET revoked_at = now()
  WHERE i.accepted_at IS NULL AND i.revoked_at IS NULL AND EXISTS (
    SELECT 1 FROM organization_invitations n
    WHERE n.organization_id = i.organization_id AND n.email = i.email AND n.accepted_at IS NULL AND n.revoked_at IS NULL
      AND (n.created_at, n.id) > (i.created_at, i.id));

-- 2. Integrity.
-- Branch-scoped invitations can only name a branch of the same organization (composite FK).
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_branch_id_organization_id_fkey" FOREIGN KEY ("branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- One open (not accepted, not revoked) invitation per organization and address. Expired ones are
-- revoked by the API before a new invitation is created, so a retry or a second administrator
-- cannot produce two live links (concurrency-safe at the database level).
CREATE UNIQUE INDEX organization_invitations_one_open_per_email ON organization_invitations (organization_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
ALTER TABLE organization_invitations
  ADD CONSTRAINT organization_invitations_resend_count CHECK (resend_count BETWEEN 0 AND 5),
  ADD CONSTRAINT organization_invitations_email_normalized CHECK (email = lower(btrim(email)));
ALTER TABLE branches
  ADD CONSTRAINT branches_archived_at CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL)),
  ADD CONSTRAINT branches_version_positive CHECK (version >= 1),
  ADD CONSTRAINT branches_name_length CHECK (length(btrim(name)) BETWEEN 1 AND 120);
ALTER TABLE organizations
  ADD CONSTRAINT organizations_version_positive CHECK (version >= 1),
  ADD CONSTRAINT organizations_name_length CHECK (length(btrim(name)) BETWEEN 2 AND 120);

-- 3. History protection: organizations and branches are archived or suspended, never deleted by
--    the application (branches cascade to role assignments; stock history references them).
REVOKE DELETE ON organizations, branches FROM ventidoc_app;
