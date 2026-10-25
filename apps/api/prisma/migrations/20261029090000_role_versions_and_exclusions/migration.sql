-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "role_permission_exclusions" (
    "organization_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_key" TEXT NOT NULL,
    "excluded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permission_exclusions_pkey" PRIMARY KEY ("role_id","permission_key")
);

-- CreateIndex
CREATE INDEX "role_permission_exclusions_organization_id_idx" ON "role_permission_exclusions"("organization_id");

-- AddForeignKey
ALTER TABLE "role_permission_exclusions" ADD CONSTRAINT "role_permission_exclusions_role_id_organization_id_fkey" FOREIGN KEY ("role_id", "organization_id") REFERENCES "roles"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission_exclusions" ADD CONSTRAINT "role_permission_exclusions_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "permissions"("key") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Hand-written: optimistic concurrency for roles, and explicit permission exclusions for
-- template roles (docs/architecture/10-organizations.md §10.6). Additive: existing roles start
-- at version 1; no permission is added or removed.
-- ===========================================================================

ALTER TABLE roles ADD CONSTRAINT roles_version CHECK (version >= 1);

-- 1. Backfill exclusions from the audited role edits that Phase 5.1 relied on: for each template
-- role and permission, if the last audited change was a removal and the role still lacks the
-- permission, it is a deliberate exclusion. Read through the template-sync policies (the schema
-- owner sees no tenant rows otherwise); refuse to continue if that scope is not in effect, so the
-- backfill can never silently see nothing.
SELECT set_config('app.template_sync', 'on', true);
DO $$ BEGIN
  IF NOT app_template_sync_scope() THEN RAISE EXCEPTION 'template sync scope not in effect; migration must run in one transaction'; END IF;
END $$;

WITH edits AS (
  SELECT a.organization_id, a.resource_id, a.actor_user_id, a.occurred_at, a.id, a.metadata
  FROM audit_events a
  WHERE a.action = 'organization.role.updated' AND a.resource_type = 'role' AND a.organization_id IS NOT NULL
), changes AS (
  SELECT e.organization_id, e.resource_id, e.actor_user_id, e.occurred_at, e.id, k.key, 'removed' AS change
  FROM edits e CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(e.metadata -> 'removed') = 'array' THEN e.metadata -> 'removed' ELSE '[]'::jsonb END) AS k(key)
  UNION ALL
  SELECT e.organization_id, e.resource_id, e.actor_user_id, e.occurred_at, e.id, k.key, 'added'
  FROM edits e CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(e.metadata -> 'added') = 'array' THEN e.metadata -> 'added' ELSE '[]'::jsonb END) AS k(key)
), last AS (
  SELECT DISTINCT ON (resource_id, key) * FROM changes ORDER BY resource_id, key, occurred_at DESC, id DESC
)
INSERT INTO role_permission_exclusions (organization_id, role_id, permission_key, excluded_by_user_id, created_at)
SELECT r.organization_id, r.id, l.key, l.actor_user_id, l.occurred_at
FROM last l
JOIN roles r ON r.id::text = l.resource_id AND r.organization_id = l.organization_id
WHERE l.change = 'removed' AND r.template_key IS NOT NULL AND NOT r.is_system
  AND EXISTS (SELECT 1 FROM permissions p WHERE p.key = l.key)
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_key = l.key);

SELECT set_config('app.template_sync', '', true);

-- 2. Tenant isolation, like every tenant table; the app role reads, adds and clears exclusions as
-- part of role edits (no UPDATE: an exclusion is created or deleted, never changed).
ALTER TABLE role_permission_exclusions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permission_exclusions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON role_permission_exclusions FOR ALL TO ventidoc_app
  USING (organization_id = app_current_org_id() AND (SELECT app_tenant_ok()))
  WITH CHECK (organization_id = app_current_org_id() AND (SELECT app_tenant_ok()));
GRANT SELECT, INSERT, DELETE ON role_permission_exclusions TO ventidoc_app;

-- 3. The template sync reads exclusions instead of replaying the audit log, so it no longer needs
-- to read audit events at all (least privilege).
CREATE POLICY template_sync_select ON role_permission_exclusions FOR SELECT TO ventidoc_migrator
  USING (app_template_sync_scope());
DROP POLICY template_sync_select ON audit_events;
