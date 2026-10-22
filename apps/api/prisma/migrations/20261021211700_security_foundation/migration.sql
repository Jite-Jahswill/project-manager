-- Ventidoc security foundation.
-- Hand-written (Prisma does not model RLS, grants, triggers or CHECK constraints).
-- See docs/architecture/02-tenant-isolation.md for the design.

-- ---------------------------------------------------------------------------
-- 1. Tenant context accessors.
-- The API sets these with set_config(..., is_local => true) inside a transaction,
-- so the values vanish at COMMIT/ROLLBACK and never leak across pooled connections.
-- Unset or empty settings yield NULL, and NULL never equals an organization_id,
-- so a query without tenant context sees no tenant rows (fail closed).
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_current_org_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.org_id', true), '')::uuid $$;

CREATE FUNCTION app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

-- Platform scope grants read access to a small, explicit set of tables
-- (organization metadata, subscriptions, audit). It is deliberately NOT referenced
-- by any business-data policy (products, stock, sales, payroll, ...).
CREATE FUNCTION app_platform_scope() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT COALESCE(current_setting('app.platform_scope', true), '') = 'on' $$;

-- ---------------------------------------------------------------------------
-- 2. Integrity constraints Prisma cannot express.
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD CONSTRAINT users_email_normalized CHECK (email = lower(btrim(email)) AND email <> '');
ALTER TABLE organization_invitations ADD CONSTRAINT invitations_email_normalized CHECK (email = lower(btrim(email)));
ALTER TABLE organizations ADD CONSTRAINT organizations_currency_iso CHECK (default_currency ~ '^[A-Z]{3}$');
ALTER TABLE plan_prices ADD CONSTRAINT plan_prices_currency_iso CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE plan_prices ADD CONSTRAINT plan_prices_amount_nonneg CHECK (amount_minor >= 0);
ALTER TABLE plan_entitlements ADD CONSTRAINT plan_entitlements_limit_nonneg CHECK (limit_value IS NULL OR limit_value >= 0);
ALTER TABLE stock_balances ADD CONSTRAINT stock_balances_nonnegative CHECK (quantity >= 0);
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_nonzero CHECK (quantity_delta <> 0);
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_balance_nonneg CHECK (balance_after >= 0);
ALTER TABLE membership_permission_overrides ADD CONSTRAINT overrides_reason_required CHECK (btrim(reason) <> '');

-- A role can be assigned once org-wide and once per branch; same for overrides.
CREATE UNIQUE INDEX membership_roles_unique_assignment
  ON membership_roles (membership_id, role_id, branch_id) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX membership_overrides_unique
  ON membership_permission_overrides (membership_id, permission_key, branch_id) NULLS NOT DISTINCT;

-- ---------------------------------------------------------------------------
-- 3. Append-only ledgers. Enforced by trigger (applies to every role, including
-- the owner) in addition to the privilege revocation below.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

-- ---------------------------------------------------------------------------
-- 4. Privileges for the runtime role. Granted explicitly per table: a new table is
-- unusable by the API until a migration grants it (fail closed).
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION app_current_org_id(), app_current_user_id(), app_platform_scope() TO ventidoc_app;
REVOKE EXECUTE ON FUNCTION app_reject_mutation() FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  users, sessions, refresh_tokens, user_action_tokens,
  platform_roles, platform_role_permissions, platform_admins, platform_admin_roles,
  organizations, organization_memberships, branches, organization_invitations,
  roles, role_permissions, membership_roles, membership_permission_overrides,
  plans, plan_prices, plan_entitlements, organization_subscriptions,
  products, stock_balances
TO ventidoc_app;

-- Permission catalogs are owned by code and synced by the migrator role.
GRANT SELECT ON permissions, platform_permissions TO ventidoc_app;
-- Ledgers: insert and read only.
GRANT SELECT, INSERT ON audit_events, stock_movements TO ventidoc_app;

-- ---------------------------------------------------------------------------
-- 5. Row-Level Security. FORCE makes policies apply to the table owner too.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations', 'organization_memberships', 'branches', 'organization_invitations',
    'roles', 'role_permissions', 'membership_roles', 'membership_permission_overrides',
    'organization_subscriptions', 'audit_events',
    'products', 'stock_balances', 'stock_movements'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

-- Plain tenant-owned tables: visible and writable only inside their organization's context.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'branches', 'organization_invitations', 'roles', 'role_permissions',
    'membership_roles', 'membership_permission_overrides',
    'products', 'stock_balances', 'stock_movements'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO ventidoc_app
         USING (organization_id = app_current_org_id())
         WITH CHECK (organization_id = app_current_org_id())', t);
  END LOOP;
END
$$;

-- organizations: a user can see orgs they actively belong to (for the org switcher);
-- writes require that org's context. Platform scope may read and change status.
CREATE POLICY org_select ON organizations FOR SELECT TO ventidoc_app USING (
  id = app_current_org_id()
  OR app_platform_scope()
  OR id IN (SELECT m.organization_id FROM organization_memberships m
            WHERE m.user_id = app_current_user_id() AND m.status = 'ACTIVE')
);
CREATE POLICY org_insert ON organizations FOR INSERT TO ventidoc_app
  WITH CHECK (id = app_current_org_id());
CREATE POLICY org_update ON organizations FOR UPDATE TO ventidoc_app
  USING (id = app_current_org_id() OR app_platform_scope())
  WITH CHECK (id = app_current_org_id() OR app_platform_scope());
-- No DELETE policy: organizations are never hard-deleted by the API.

-- memberships: users can always see their own memberships (to list their orgs).
CREATE POLICY membership_select ON organization_memberships FOR SELECT TO ventidoc_app
  USING (organization_id = app_current_org_id() OR user_id = app_current_user_id());
CREATE POLICY membership_write ON organization_memberships FOR INSERT TO ventidoc_app
  WITH CHECK (organization_id = app_current_org_id());
CREATE POLICY membership_update ON organization_memberships FOR UPDATE TO ventidoc_app
  USING (organization_id = app_current_org_id())
  WITH CHECK (organization_id = app_current_org_id());
CREATE POLICY membership_delete ON organization_memberships FOR DELETE TO ventidoc_app
  USING (organization_id = app_current_org_id());

-- subscriptions: the org can read its own and create its initial trial; only platform
-- (billing) scope may change an existing subscription.
CREATE POLICY subscription_select ON organization_subscriptions FOR SELECT TO ventidoc_app
  USING (organization_id = app_current_org_id() OR app_platform_scope());
CREATE POLICY subscription_insert ON organization_subscriptions FOR INSERT TO ventidoc_app
  WITH CHECK (organization_id = app_current_org_id() OR app_platform_scope());
CREATE POLICY subscription_update ON organization_subscriptions FOR UPDATE TO ventidoc_app
  USING (app_platform_scope()) WITH CHECK (app_platform_scope());

-- audit: org members (with permission, checked in the API) read their org's events;
-- identity events (organization_id NULL) are readable only in platform scope.
CREATE POLICY audit_select ON audit_events FOR SELECT TO ventidoc_app
  USING (organization_id = app_current_org_id() OR app_platform_scope());
CREATE POLICY audit_insert ON audit_events FOR INSERT TO ventidoc_app
  WITH CHECK (organization_id IS NULL OR organization_id = app_current_org_id() OR app_platform_scope());
