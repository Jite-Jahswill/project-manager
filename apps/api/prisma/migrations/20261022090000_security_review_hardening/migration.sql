-- Security review 2026-10-22 (docs/security/2026-10-22-review.md).

-- F9: the runtime role must never create objects (e.g. functions shadowing the
-- tenant-context accessors). PG15+ already defaults to this; make it explicit.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- F5: platform scope may read identity/platform events and actions taken BY
-- platform administrators, but not tenants' business audit trail (which carries
-- before/after values of business records).
DROP POLICY audit_select ON audit_events;
CREATE POLICY audit_select ON audit_events FOR SELECT TO ventidoc_app USING (
  organization_id = app_current_org_id()
  OR (app_platform_scope() AND (organization_id IS NULL OR actor_type = 'PLATFORM_ADMIN'))
);

-- F6: the "my own memberships" exemption applies only when no organization
-- context is set (the org switcher). Inside an organization's context, other
-- organizations' memberships and rows are invisible.
DROP POLICY membership_select ON organization_memberships;
CREATE POLICY membership_select ON organization_memberships FOR SELECT TO ventidoc_app USING (
  organization_id = app_current_org_id()
  OR (app_current_org_id() IS NULL AND user_id = app_current_user_id())
);

DROP POLICY org_select ON organizations;
CREATE POLICY org_select ON organizations FOR SELECT TO ventidoc_app USING (
  id = app_current_org_id()
  OR app_platform_scope()
  OR (app_current_org_id() IS NULL AND id IN (
        SELECT m.organization_id FROM organization_memberships m
        WHERE m.user_id = app_current_user_id() AND m.status = 'ACTIVE'))
);

-- F8: an organization may only create its own initial, short trial. Paid or
-- active subscriptions are created and changed in platform (billing) scope only.
DROP POLICY subscription_insert ON organization_subscriptions;
CREATE POLICY subscription_insert ON organization_subscriptions FOR INSERT TO ventidoc_app WITH CHECK (
  app_platform_scope()
  OR (
    organization_id = app_current_org_id()
    AND status = 'TRIALING'
    AND trial_ends_at IS NOT NULL
    AND current_period_end <= now() + interval '31 days'
    AND trial_ends_at <= now() + interval '31 days'
  )
);

-- F7: global catalogs (plans, platform RBAC) are readable by the runtime role but
-- writable only in platform scope. Not FORCEd: the migrator (schema owner) seeds
-- them during deployment.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'plans', 'plan_prices', 'plan_entitlements',
    'platform_roles', 'platform_role_permissions', 'platform_admins', 'platform_admin_roles'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY catalog_read ON %I FOR SELECT TO ventidoc_app USING (true)', t);
    EXECUTE format(
      'CREATE POLICY catalog_write_platform ON %I FOR ALL TO ventidoc_app
         USING (app_platform_scope()) WITH CHECK (app_platform_scope())', t);
  END LOOP;
END
$$;
