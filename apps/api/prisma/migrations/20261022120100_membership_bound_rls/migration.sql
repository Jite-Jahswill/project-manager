-- Security gate 2026-10-22, concern B: wrong-tenant context.
--
-- Before: policies checked only organization_id = app_current_org_id(). The tenant
-- context is a transaction setting the application role can set to any value, so
-- an application bug that opened organization B's context for a user of
-- organization A was faithfully served by RLS (reproduced by the broken-guard
-- experiment).
--
-- After: every tenant policy additionally requires the context user to be an
-- ACTIVE member of the context organization, verified by the database itself.
-- Two narrow, database-verified exceptions exist:
--   * invitation acceptance: a live invitation for this organization whose token
--     hash is in app.invitation_token_hash and whose email is the context user's
--     verified email (RBAC/administration tables only, never business data);
--   * organization creation: the creator, until the first membership exists.
-- Membership rows themselves can only be created through those two paths.
--
-- Requires role ventidoc_rls (NOLOGIN, BYPASSRLS), granted to ventidoc_migrator.

-- ---------------------------------------------------------------------------
-- Helper functions. SECURITY DEFINER + owned by ventidoc_rls so they can read
-- memberships/invitations without re-entering those tables' own policies.
-- search_path pinned so callers cannot shadow objects.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_is_active_member() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM organization_memberships m
      WHERE m.organization_id = app_current_org_id()
        AND m.user_id = app_current_user_id()
        AND m.status = 'ACTIVE')
  $$;

CREATE FUNCTION app_invitation_ok() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM organization_invitations i
      JOIN users u ON u.email = i.email
      WHERE i.organization_id = app_current_org_id()
        AND i.token_hash = NULLIF(current_setting('app.invitation_token_hash', true), '')
        AND u.id = app_current_user_id()
        AND u.email_verified_at IS NOT NULL
        AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now())
  $$;

CREATE FUNCTION app_tenant_ok() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT app_is_active_member() OR app_invitation_ok() $$;

CREATE FUNCTION app_org_has_members() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT EXISTS (SELECT 1 FROM organization_memberships m WHERE m.organization_id = app_current_org_id()) $$;

CREATE FUNCTION app_org_bootstrap_ok() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = app_current_org_id() AND o.created_by_user_id = app_current_user_id())
    AND NOT app_org_has_members()
  $$;

GRANT SELECT ON organization_memberships, organization_invitations, organizations, users TO ventidoc_rls;
-- Transferring ownership requires the new owner to hold CREATE on the schema; withdrawn right after.
GRANT CREATE ON SCHEMA public TO ventidoc_rls;
ALTER FUNCTION app_is_active_member() OWNER TO ventidoc_rls;
ALTER FUNCTION app_invitation_ok() OWNER TO ventidoc_rls;
ALTER FUNCTION app_tenant_ok() OWNER TO ventidoc_rls;
ALTER FUNCTION app_org_has_members() OWNER TO ventidoc_rls;
ALTER FUNCTION app_org_bootstrap_ok() OWNER TO ventidoc_rls;
REVOKE CREATE ON SCHEMA public FROM ventidoc_rls;
REVOKE EXECUTE ON FUNCTION app_is_active_member(), app_invitation_ok(), app_tenant_ok(), app_org_has_members(), app_org_bootstrap_ok() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_active_member(), app_invitation_ok(), app_tenant_ok(), app_org_has_members(), app_org_bootstrap_ok() TO ventidoc_app;

-- ---------------------------------------------------------------------------
-- Policies. "(SELECT f())" makes PostgreSQL evaluate the helper once per query
-- (InitPlan) instead of once per row.
-- ---------------------------------------------------------------------------

-- Business data: active members only (an invitation never exposes it).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products', 'stock_balances', 'stock_movements'] LOOP
    EXECUTE format('DROP POLICY tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO ventidoc_app
         USING (organization_id = app_current_org_id() AND (SELECT app_is_active_member()))
         WITH CHECK (organization_id = app_current_org_id() AND (SELECT app_is_active_member()))', t);
  END LOOP;
END
$$;

-- RBAC / administration: active members, or a verified invitee during acceptance.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'branches', 'organization_invitations', 'roles', 'role_permissions',
    'membership_roles', 'membership_permission_overrides'
  ] LOOP
    EXECUTE format('DROP POLICY tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO ventidoc_app
         USING (organization_id = app_current_org_id() AND (SELECT app_tenant_ok()))
         WITH CHECK (organization_id = app_current_org_id() AND (SELECT app_tenant_ok()))', t);
  END LOOP;
END
$$;

DROP POLICY org_select ON organizations;
CREATE POLICY org_select ON organizations FOR SELECT TO ventidoc_app USING (
  (id = app_current_org_id() AND (
      (SELECT app_tenant_ok())
      -- The creator can see the row they just inserted, until the first membership exists.
      OR (created_by_user_id = app_current_user_id() AND NOT (SELECT app_org_has_members()))))
  OR app_platform_scope()
  OR (app_current_org_id() IS NULL AND id IN (
        SELECT m.organization_id FROM organization_memberships m
        WHERE m.user_id = app_current_user_id() AND m.status = 'ACTIVE'))
);
DROP POLICY org_insert ON organizations;
CREATE POLICY org_insert ON organizations FOR INSERT TO ventidoc_app
  WITH CHECK (id = app_current_org_id() AND created_by_user_id = app_current_user_id());
DROP POLICY org_update ON organizations;
CREATE POLICY org_update ON organizations FOR UPDATE TO ventidoc_app
  USING ((id = app_current_org_id() AND (SELECT app_tenant_ok())) OR app_platform_scope())
  WITH CHECK ((id = app_current_org_id() AND (SELECT app_tenant_ok())) OR app_platform_scope());

DROP POLICY membership_select ON organization_memberships;
CREATE POLICY membership_select ON organization_memberships FOR SELECT TO ventidoc_app USING (
  (organization_id = app_current_org_id() AND (SELECT app_tenant_ok()))
  -- Your own row in the context organization (needed for INSERT ... RETURNING, whose
  -- snapshot cannot yet see the row). A non-member has no such row.
  OR (organization_id = app_current_org_id() AND user_id = app_current_user_id())
  OR (app_current_org_id() IS NULL AND user_id = app_current_user_id())
);
-- A membership can only be created for the context user, through a verified
-- invitation or as the creator of a brand-new organization.
DROP POLICY membership_write ON organization_memberships;
CREATE POLICY membership_insert ON organization_memberships FOR INSERT TO ventidoc_app WITH CHECK (
  organization_id = app_current_org_id()
  AND user_id = app_current_user_id()
  AND ((SELECT app_invitation_ok()) OR (SELECT app_org_bootstrap_ok()))
);
DROP POLICY membership_update ON organization_memberships;
CREATE POLICY membership_update ON organization_memberships FOR UPDATE TO ventidoc_app
  USING (organization_id = app_current_org_id() AND (SELECT app_tenant_ok()))
  WITH CHECK (organization_id = app_current_org_id() AND (SELECT app_tenant_ok()));
DROP POLICY membership_delete ON organization_memberships;
CREATE POLICY membership_delete ON organization_memberships FOR DELETE TO ventidoc_app
  USING (organization_id = app_current_org_id() AND (SELECT app_is_active_member()));

DROP POLICY subscription_select ON organization_subscriptions;
CREATE POLICY subscription_select ON organization_subscriptions FOR SELECT TO ventidoc_app
  USING ((organization_id = app_current_org_id() AND (SELECT app_tenant_ok())) OR app_platform_scope());
DROP POLICY subscription_insert ON organization_subscriptions;
CREATE POLICY subscription_insert ON organization_subscriptions FOR INSERT TO ventidoc_app WITH CHECK (
  app_platform_scope()
  OR (
    organization_id = app_current_org_id()
    AND (SELECT app_is_active_member())
    AND status = 'TRIALING'
    AND trial_ends_at IS NOT NULL
    AND current_period_end <= now() + interval '31 days'
    AND trial_ends_at <= now() + interval '31 days'
  )
);

DROP POLICY audit_select ON audit_events;
CREATE POLICY audit_select ON audit_events FOR SELECT TO ventidoc_app USING (
  (organization_id = app_current_org_id() AND (SELECT app_is_active_member()))
  OR (app_platform_scope() AND (organization_id IS NULL OR actor_type = 'PLATFORM_ADMIN'))
);
DROP POLICY audit_insert ON audit_events;
CREATE POLICY audit_insert ON audit_events FOR INSERT TO ventidoc_app WITH CHECK (
  organization_id IS NULL
  OR (organization_id = app_current_org_id() AND (SELECT app_tenant_ok()))
  OR app_platform_scope()
);
