-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "template_version" INTEGER;

-- CreateTable
CREATE TABLE "role_template_state" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL,
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_template_state_pkey" PRIMARY KEY ("id")
);


-- ===========================================================================
-- Hand-written: versioned organization role templates (docs/architecture/10-organizations.md §10.6).
-- Additive only: no existing row is changed here. Template roles created before this migration
-- keep template_version NULL and are treated as version 1; `pnpm api db:seed` (syncRoleTemplates)
-- then grants each of them what later template versions added.
-- ===========================================================================

-- 1. Only template-derived, non-system roles carry a template version.
ALTER TABLE roles ADD CONSTRAINT roles_template_version
  CHECK (template_version IS NULL OR (template_version >= 1 AND template_key IS NOT NULL AND NOT is_system));

ALTER TABLE role_template_state
  ADD CONSTRAINT role_template_state_singleton CHECK (id = 1),
  ADD CONSTRAINT role_template_state_version CHECK (version >= 1);
-- The API reads it at startup (refuses to serve while it is behind the code); only the seed writes it.
GRANT SELECT ON role_template_state TO ventidoc_app;

-- 2. Template sync scope. The seed connects as the schema owner, which FORCEd RLS also binds and
-- which has no tenant policy, so it sees no tenant rows. These policies give it exactly what the
-- sync needs, only while it sets app.template_sync = 'on' in its transaction:
--   read organizations, template roles and their permissions, and role-edit audit events;
--   lock and update template roles (their version); ADD permissions to template roles;
--   write its own SYSTEM audit events.
-- There is deliberately no DELETE or UPDATE policy on role_permissions: the sync can only add.
-- The runtime role is unaffected (every policy below is TO ventidoc_migrator).
CREATE FUNCTION app_template_sync_scope() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT COALESCE(current_setting('app.template_sync', true), '') = 'on' $$;
REVOKE ALL ON FUNCTION app_template_sync_scope() FROM PUBLIC;

CREATE POLICY template_sync_select ON organizations FOR SELECT TO ventidoc_migrator
  USING (app_template_sync_scope());

CREATE POLICY template_sync_select ON roles FOR SELECT TO ventidoc_migrator
  USING (app_template_sync_scope());
CREATE POLICY template_sync_update ON roles FOR UPDATE TO ventidoc_migrator
  USING (app_template_sync_scope() AND template_key IS NOT NULL AND NOT is_system)
  WITH CHECK (app_template_sync_scope() AND template_key IS NOT NULL AND NOT is_system);

CREATE POLICY template_sync_select ON role_permissions FOR SELECT TO ventidoc_migrator
  USING (app_template_sync_scope());
CREATE POLICY template_sync_insert ON role_permissions FOR INSERT TO ventidoc_migrator
  WITH CHECK (app_template_sync_scope() AND EXISTS (
    SELECT 1 FROM roles r
    WHERE r.id = role_permissions.role_id AND r.organization_id = role_permissions.organization_id
      AND r.template_key IS NOT NULL AND NOT r.is_system));

CREATE POLICY template_sync_select ON audit_events FOR SELECT TO ventidoc_migrator
  USING (app_template_sync_scope() AND resource_type = 'role' AND action = 'organization.role.updated');
CREATE POLICY template_sync_insert ON audit_events FOR INSERT TO ventidoc_migrator
  WITH CHECK (app_template_sync_scope() AND action = 'organization.role.template_upgraded' AND resource_type = 'role'
    AND actor_type = 'SYSTEM' AND actor_user_id IS NULL AND organization_id IS NOT NULL);
