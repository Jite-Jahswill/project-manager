-- CreateEnum
CREATE TYPE "SupportConversationStatus" AS ENUM ('NEW', 'OPEN', 'PENDING_CUSTOMER', 'PENDING_SUPPORT', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "SupportCategory" AS ENUM ('ACCOUNT', 'BILLING', 'TECHNICAL', 'FEATURE_REQUEST', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportAuthorKind" AS ENUM ('CUSTOMER', 'STAFF');

-- CreateEnum
CREATE TYPE "SupportEventType" AS ENUM ('CREATED', 'ASSIGNED', 'REASSIGNED', 'UNASSIGNED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'CATEGORY_CHANGED', 'REOPENED', 'NOTE_ADDED');

-- CreateTable
CREATE TABLE "support_conversations" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "customer_user_id" UUID NOT NULL,
    "organization_id" UUID,
    "subject" TEXT NOT NULL,
    "category" "SupportCategory" NOT NULL DEFAULT 'OTHER',
    "priority" "SupportPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "SupportConversationStatus" NOT NULL DEFAULT 'NEW',
    "assignee_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "message_seq" INTEGER NOT NULL DEFAULT 0,
    "last_message_preview" TEXT,
    "last_message_at" TIMESTAMPTZ(3),
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customer_read_seq" INTEGER NOT NULL DEFAULT 0,
    "support_read_seq" INTEGER NOT NULL DEFAULT 0,
    "customer_notified_seq" INTEGER NOT NULL DEFAULT 0,
    "assignee_notified_seq" INTEGER NOT NULL DEFAULT 0,
    "resolved_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "author_user_id" UUID NOT NULL,
    "author_kind" "SupportAuthorKind" NOT NULL,
    "body" TEXT NOT NULL,
    "client_message_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_internal_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "client_note_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_internal_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "previous_assignee_user_id" UUID,
    "assignee_user_id" UUID,
    "assigned_by_user_id" UUID NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_conversation_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "type" "SupportEventType" NOT NULL,
    "actor_user_id" UUID,
    "actor_kind" "SupportAuthorKind" NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_conversation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_read_markers" (
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_read_seq" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_read_markers_pkey" PRIMARY KEY ("conversation_id","user_id")
);

-- CreateTable
CREATE TABLE "support_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "message_id" UUID,
    "uploader_user_id" UUID NOT NULL,
    "uploader_kind" "SupportAuthorKind" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_conversations_reference_key" ON "support_conversations"("reference");

-- CreateIndex
CREATE INDEX "support_conversations_customer_user_id_last_activity_at_idx" ON "support_conversations"("customer_user_id", "last_activity_at");

-- CreateIndex
CREATE INDEX "support_conversations_status_last_activity_at_idx" ON "support_conversations"("status", "last_activity_at");

-- CreateIndex
CREATE INDEX "support_conversations_assignee_user_id_status_idx" ON "support_conversations"("assignee_user_id", "status");

-- CreateIndex
CREATE INDEX "support_conversations_last_activity_at_id_idx" ON "support_conversations"("last_activity_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "support_messages_conversation_id_seq_key" ON "support_messages"("conversation_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "support_messages_id_conversation_id_key" ON "support_messages"("id", "conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "support_messages_conversation_id_author_user_id_client_mess_key" ON "support_messages"("conversation_id", "author_user_id", "client_message_id");

-- CreateIndex
CREATE INDEX "support_internal_notes_conversation_id_created_at_idx" ON "support_internal_notes"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "support_internal_notes_conversation_id_author_user_id_clien_key" ON "support_internal_notes"("conversation_id", "author_user_id", "client_note_id");

-- CreateIndex
CREATE INDEX "support_assignments_conversation_id_created_at_idx" ON "support_assignments"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "support_conversation_events_conversation_id_created_at_idx" ON "support_conversation_events"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "support_read_markers_user_id_idx" ON "support_read_markers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "support_attachments_storage_key_key" ON "support_attachments"("storage_key");

-- CreateIndex
CREATE INDEX "support_attachments_conversation_id_idx" ON "support_attachments"("conversation_id");

-- CreateIndex
CREATE INDEX "support_attachments_message_id_idx" ON "support_attachments"("message_id");

-- AddForeignKey
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_customer_user_id_fkey" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "platform_admins"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "support_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_internal_notes" ADD CONSTRAINT "support_internal_notes_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "support_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_internal_notes" ADD CONSTRAINT "support_internal_notes_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_assignments" ADD CONSTRAINT "support_assignments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "support_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_assignments" ADD CONSTRAINT "support_assignments_previous_assignee_user_id_fkey" FOREIGN KEY ("previous_assignee_user_id") REFERENCES "platform_admins"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_assignments" ADD CONSTRAINT "support_assignments_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "platform_admins"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_assignments" ADD CONSTRAINT "support_assignments_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_conversation_events" ADD CONSTRAINT "support_conversation_events_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "support_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_conversation_events" ADD CONSTRAINT "support_conversation_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_read_markers" ADD CONSTRAINT "support_read_markers_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "support_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_read_markers" ADD CONSTRAINT "support_read_markers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "support_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_message_id_conversation_id_fkey" FOREIGN KEY ("message_id", "conversation_id") REFERENCES "support_messages"("id", "conversation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_uploader_user_id_fkey" FOREIGN KEY ("uploader_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Hand-written: integrity, database-side authorization and RLS for support.
-- docs/architecture/09-support.md and docs/security/support.md.
--
-- Conversations belong to the customer (a user). Tenant context (app.org_id) grants
-- nothing here. Staff rights are not taken from any session flag: every policy asks
-- app_has_platform_permission(), which reads the caller's ACTIVE platform roles, so a
-- bug that skipped the API check still could not widen access.
-- ===========================================================================

-- 1. Integrity constraints Prisma cannot express.
ALTER TABLE support_conversations
  ADD CONSTRAINT support_conversations_reference_format CHECK (reference ~ '^SUP-[A-HJ-NP-Z2-9]{8}$'),
  ADD CONSTRAINT support_conversations_subject_length CHECK (length(btrim(subject)) BETWEEN 1 AND 200),
  ADD CONSTRAINT support_conversations_counters CHECK (
    version >= 1 AND message_seq >= 0
    AND customer_read_seq BETWEEN 0 AND message_seq AND support_read_seq BETWEEN 0 AND message_seq
    AND customer_notified_seq BETWEEN 0 AND message_seq AND assignee_notified_seq BETWEEN 0 AND message_seq),
  ADD CONSTRAINT support_conversations_preview_length CHECK (last_message_preview IS NULL OR length(last_message_preview) <= 200),
  ADD CONSTRAINT support_conversations_closed_at CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
  ADD CONSTRAINT support_conversations_resolved_at CHECK (status <> 'RESOLVED' OR resolved_at IS NOT NULL);
ALTER TABLE support_messages
  ADD CONSTRAINT support_messages_seq_positive CHECK (seq >= 1),
  ADD CONSTRAINT support_messages_body_length CHECK (length(btrim(body)) >= 1 AND length(body) <= 10000),
  ADD CONSTRAINT support_messages_client_id_length CHECK (client_message_id IS NULL OR length(client_message_id) BETWEEN 1 AND 100);
ALTER TABLE support_internal_notes
  ADD CONSTRAINT support_notes_body_length CHECK (length(btrim(body)) >= 1 AND length(body) <= 10000),
  ADD CONSTRAINT support_notes_client_id_length CHECK (client_note_id IS NULL OR length(client_note_id) BETWEEN 1 AND 100);
ALTER TABLE support_assignments
  ADD CONSTRAINT support_assignments_changes_something CHECK (previous_assignee_user_id IS DISTINCT FROM assignee_user_id),
  ADD CONSTRAINT support_assignments_reason_length CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 500);
ALTER TABLE support_attachments
  ADD CONSTRAINT support_attachments_size CHECK (size_bytes BETWEEN 1 AND 10485760),
  ADD CONSTRAINT support_attachments_content_type CHECK (content_type IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain')),
  ADD CONSTRAINT support_attachments_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  -- Keys are generated by the server only: no client-controlled path segments.
  ADD CONSTRAINT support_attachments_storage_key CHECK (storage_key ~ '^support/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  ADD CONSTRAINT support_attachments_file_name CHECK (length(file_name) BETWEEN 1 AND 200 AND file_name !~ '[/\\[:cntrl:]]');

-- 2. Authorization helpers. SECURITY DEFINER (owned by ventidoc_rls, like the tenant
--    helpers) because the platform role tables are not readable from a user context.
CREATE FUNCTION app_user_has_platform_permission(u uuid, p text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT u IS NOT NULL AND EXISTS (
      SELECT 1
      FROM platform_admins a
      JOIN platform_admin_roles ar ON ar.admin_user_id = a.user_id
      JOIN platform_role_permissions rp ON rp.role_id = ar.role_id
      WHERE a.user_id = u AND a.status = 'ACTIVE' AND rp.permission_key = p)
  $$;
CREATE FUNCTION app_has_platform_permission(p text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT app_user_has_platform_permission(app_current_user_id(), p) $$;
-- Organization context on a conversation must be an organization the customer belongs to.
CREATE FUNCTION app_user_is_active_member_of(org uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
      WHERE m.organization_id = org AND m.user_id = app_current_user_id() AND m.status = 'ACTIVE' AND o.status = 'ACTIVE')
  $$;
GRANT SELECT ON platform_admins, platform_admin_roles, platform_role_permissions TO ventidoc_rls;
GRANT CREATE ON SCHEMA public TO ventidoc_rls;
ALTER FUNCTION app_user_has_platform_permission(uuid, text) OWNER TO ventidoc_rls;
ALTER FUNCTION app_has_platform_permission(text) OWNER TO ventidoc_rls;
ALTER FUNCTION app_user_is_active_member_of(uuid) OWNER TO ventidoc_rls;
REVOKE CREATE ON SCHEMA public FROM ventidoc_rls;
REVOKE EXECUTE ON FUNCTION app_user_has_platform_permission(uuid, text), app_has_platform_permission(text), app_user_is_active_member_of(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_user_has_platform_permission(uuid, text), app_has_platform_permission(text), app_user_is_active_member_of(uuid) TO ventidoc_app;

CREATE FUNCTION app_support_status_transition_ok(old_status text, new_status text) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT old_status = new_status OR CASE old_status
      WHEN 'NEW'              THEN new_status IN ('OPEN', 'PENDING_CUSTOMER', 'PENDING_SUPPORT', 'RESOLVED', 'CLOSED')
      WHEN 'OPEN'             THEN new_status IN ('PENDING_CUSTOMER', 'PENDING_SUPPORT', 'RESOLVED', 'CLOSED')
      WHEN 'PENDING_CUSTOMER' THEN new_status IN ('OPEN', 'PENDING_SUPPORT', 'RESOLVED', 'CLOSED')
      WHEN 'PENDING_SUPPORT'  THEN new_status IN ('OPEN', 'PENDING_CUSTOMER', 'RESOLVED', 'CLOSED')
      WHEN 'RESOLVED'         THEN new_status IN ('OPEN', 'PENDING_CUSTOMER', 'PENDING_SUPPORT', 'CLOSED')
      ELSE false -- CLOSED is terminal
    END
  $$;

-- 3. Conversation guard: who may change which column, valid transitions, server-managed
--    version/timestamps. Runs with the caller's identity (not SECURITY DEFINER).
CREATE FUNCTION app_support_conversation_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  me uuid := app_current_user_id();
  is_customer boolean := OLD.customer_user_id IS NOT DISTINCT FROM me;
  is_staff boolean := app_has_platform_permission('platform.support.inbox.read')
    OR (OLD.assignee_user_id IS NOT DISTINCT FROM me AND me IS NOT NULL AND app_has_platform_permission('platform.support.assigned.access'));
  attrs_changed boolean := NEW.status IS DISTINCT FROM OLD.status OR NEW.priority IS DISTINCT FROM OLD.priority
    OR NEW.category IS DISTINCT FROM OLD.category OR NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id;
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.customer_user_id IS DISTINCT FROM OLD.customer_user_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.subject IS DISTINCT FROM OLD.subject OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'support_conversations: identity columns are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'CLOSED' AND (attrs_changed OR NEW.message_seq <> OLD.message_seq) THEN
    RAISE EXCEPTION 'support_conversations: a closed conversation cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.message_seq < OLD.message_seq OR NEW.customer_read_seq < OLD.customer_read_seq OR NEW.support_read_seq < OLD.support_read_seq
     OR NEW.customer_notified_seq < OLD.customer_notified_seq OR NEW.assignee_notified_seq < OLD.assignee_notified_seq THEN
    RAISE EXCEPTION 'support_conversations: sequence counters never decrease' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.message_seq > OLD.message_seq + 1 THEN
    RAISE EXCEPTION 'support_conversations: messages are numbered one at a time' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.customer_read_seq <> OLD.customer_read_seq AND NOT is_customer THEN
    RAISE EXCEPTION 'support_conversations: only the customer moves the customer read marker' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.support_read_seq <> OLD.support_read_seq AND NOT is_staff THEN
    RAISE EXCEPTION 'support_conversations: only support staff move the support read marker' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id THEN
    IF NOT app_has_platform_permission('platform.support.assign') THEN
      RAISE EXCEPTION 'support_conversations: assignment requires platform.support.assign' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.assignee_user_id IS NOT NULL AND NOT app_user_has_platform_permission(NEW.assignee_user_id, 'platform.support.assigned.access') THEN
      RAISE EXCEPTION 'support_conversations: the assignee does not hold platform.support.assigned.access' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF (NEW.priority IS DISTINCT FROM OLD.priority OR NEW.category IS DISTINCT FROM OLD.category)
     AND NOT app_has_platform_permission('platform.support.status.manage') THEN
    RAISE EXCEPTION 'support_conversations: priority and category require platform.support.status.manage' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT app_support_status_transition_ok(OLD.status::text, NEW.status::text) THEN
      RAISE EXCEPTION 'support_conversations: invalid status transition % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    -- Customers can only hand the conversation back to support (by replying or reopening).
    IF NOT (app_has_platform_permission('platform.support.status.manage')
            OR (is_staff AND NEW.status = 'PENDING_CUSTOMER' AND app_has_platform_permission('platform.support.reply'))
            OR (is_customer AND NEW.status = 'PENDING_SUPPORT')) THEN
      RAISE EXCEPTION 'support_conversations: status change % -> % is not permitted for this caller', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status = 'RESOLVED' THEN NEW.resolved_at := now(); END IF;
    IF NEW.status = 'CLOSED' THEN NEW.closed_at := now(); END IF;
  END IF;
  NEW.version := OLD.version + CASE WHEN attrs_changed THEN 1 ELSE 0 END;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER support_conversations_guard BEFORE UPDATE ON support_conversations
  FOR EACH ROW EXECUTE FUNCTION app_support_conversation_guard();

-- New conversations start clean (the API cannot pre-set server-managed columns).
CREATE FUNCTION app_support_conversation_insert_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.version <> 1 OR NEW.customer_read_seq > NEW.message_seq OR NEW.support_read_seq <> 0
     OR NEW.customer_notified_seq <> 0 OR NEW.assignee_notified_seq <> 0 OR NEW.message_seq > 1 THEN
    RAISE EXCEPTION 'support_conversations: server-managed columns cannot be preset' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER support_conversations_insert_guard BEFORE INSERT ON support_conversations
  FOR EACH ROW EXECUTE FUNCTION app_support_conversation_insert_guard();

-- A message's seq must be the number just allocated on its conversation (which also
-- routes every message through the conversation guard, e.g. "closed means closed").
CREATE FUNCTION app_support_message_seq_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.seq IS DISTINCT FROM (SELECT c.message_seq FROM support_conversations c WHERE c.id = NEW.conversation_id) THEN
    RAISE EXCEPTION 'support_messages: seq must be allocated from the conversation' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER support_messages_seq_guard BEFORE INSERT ON support_messages
  FOR EACH ROW EXECUTE FUNCTION app_support_message_seq_guard();

-- Attachments: only the message link may be set, once, to a message by the uploader.
CREATE FUNCTION app_support_attachment_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.message_id IS NOT NULL OR NEW.message_id IS NULL
     OR (NEW.id, NEW.conversation_id, NEW.uploader_user_id, NEW.uploader_kind, NEW.storage_key, NEW.file_name, NEW.content_type, NEW.size_bytes, NEW.sha256, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.conversation_id, OLD.uploader_user_id, OLD.uploader_kind, OLD.storage_key, OLD.file_name, OLD.content_type, OLD.size_bytes, OLD.sha256, OLD.created_at) THEN
    RAISE EXCEPTION 'support_attachments: only an unsent attachment can be linked to a message' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM support_messages m WHERE m.id = NEW.message_id AND m.author_user_id = NEW.uploader_user_id) THEN
    RAISE EXCEPTION 'support_attachments: an attachment can only be sent by its uploader' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER support_attachments_guard BEFORE UPDATE ON support_attachments
  FOR EACH ROW EXECUTE FUNCTION app_support_attachment_guard();

-- History tables are append-only for every role (app_reject_mutation from the security foundation).
CREATE TRIGGER support_messages_append_only BEFORE UPDATE OR DELETE ON support_messages FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER support_internal_notes_append_only BEFORE UPDATE OR DELETE ON support_internal_notes FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER support_assignments_append_only BEFORE UPDATE OR DELETE ON support_assignments FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER support_conversation_events_append_only BEFORE UPDATE OR DELETE ON support_conversation_events FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

-- 4. Privileges: no DELETE anywhere; history tables are insert-only.
GRANT SELECT, INSERT, UPDATE ON support_conversations TO ventidoc_app;
GRANT SELECT, INSERT ON support_messages, support_internal_notes, support_assignments, support_conversation_events TO ventidoc_app;
GRANT SELECT, INSERT, UPDATE ON support_read_markers TO ventidoc_app;
GRANT SELECT, INSERT ON support_attachments TO ventidoc_app;
GRANT UPDATE (message_id) ON support_attachments TO ventidoc_app;

-- 5. Row-level security, FORCEd on every support table (the owner is bound too).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['support_conversations', 'support_messages', 'support_internal_notes', 'support_assignments',
                           'support_conversation_events', 'support_read_markers', 'support_attachments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

-- Conversations: the customer, inbox staff, or the assigned agent. Tenant context grants nothing.
CREATE POLICY support_conversations_select ON support_conversations FOR SELECT TO ventidoc_app
  USING (customer_user_id = app_current_user_id()
         OR (SELECT app_has_platform_permission('platform.support.inbox.read'))
         OR (assignee_user_id = app_current_user_id() AND (SELECT app_has_platform_permission('platform.support.assigned.access'))));
CREATE POLICY support_conversations_insert ON support_conversations FOR INSERT TO ventidoc_app
  WITH CHECK (customer_user_id = app_current_user_id() AND assignee_user_id IS NULL AND status = 'NEW'
              AND (organization_id IS NULL OR app_user_is_active_member_of(organization_id)));
CREATE POLICY support_conversations_update ON support_conversations FOR UPDATE TO ventidoc_app
  USING (customer_user_id = app_current_user_id()
         OR (SELECT app_has_platform_permission('platform.support.inbox.read'))
         OR (assignee_user_id = app_current_user_id() AND (SELECT app_has_platform_permission('platform.support.assigned.access'))))
  WITH CHECK (customer_user_id = app_current_user_id()
              OR (SELECT app_has_platform_permission('platform.support.inbox.read'))
              OR (SELECT app_has_platform_permission('platform.support.assign'))
              OR (assignee_user_id = app_current_user_id() AND (SELECT app_has_platform_permission('platform.support.assigned.access'))));

-- Public messages: readable wherever the conversation is (the subquery is itself under RLS).
CREATE POLICY support_messages_select ON support_messages FOR SELECT TO ventidoc_app
  USING (EXISTS (SELECT 1 FROM support_conversations c WHERE c.id = conversation_id));
CREATE POLICY support_messages_insert ON support_messages FOR INSERT TO ventidoc_app
  WITH CHECK (author_user_id = app_current_user_id() AND (
    (author_kind = 'CUSTOMER' AND EXISTS (SELECT 1 FROM support_conversations c WHERE c.id = conversation_id AND c.customer_user_id = app_current_user_id()))
    OR (author_kind = 'STAFF' AND (SELECT app_has_platform_permission('platform.support.reply')) AND EXISTS (
      SELECT 1 FROM support_conversations c WHERE c.id = conversation_id AND (
        (SELECT app_has_platform_permission('platform.support.inbox.read'))
        OR (c.assignee_user_id = app_current_user_id() AND (SELECT app_has_platform_permission('platform.support.assigned.access'))))))));

-- Internal notes: staff with platform.support.notes who can see the conversation as staff. Never customers.
CREATE POLICY support_internal_notes_select ON support_internal_notes FOR SELECT TO ventidoc_app
  USING ((SELECT app_has_platform_permission('platform.support.notes')) AND EXISTS (
    SELECT 1 FROM support_conversations c WHERE c.id = conversation_id AND (
      (SELECT app_has_platform_permission('platform.support.inbox.read'))
      OR (c.assignee_user_id = app_current_user_id() AND (SELECT app_has_platform_permission('platform.support.assigned.access'))))));
CREATE POLICY support_internal_notes_insert ON support_internal_notes FOR INSERT TO ventidoc_app
  WITH CHECK (author_user_id = app_current_user_id() AND (SELECT app_has_platform_permission('platform.support.notes')) AND EXISTS (
    SELECT 1 FROM support_conversations c WHERE c.id = conversation_id AND (
      (SELECT app_has_platform_permission('platform.support.inbox.read'))
      OR (c.assignee_user_id = app_current_user_id() AND (SELECT app_has_platform_permission('platform.support.assigned.access'))))));

-- Assignment history: staff who can see the conversation; written only with platform.support.assign.
CREATE POLICY support_assignments_select ON support_assignments FOR SELECT TO ventidoc_app
  USING (EXISTS (SELECT 1 FROM support_conversations c WHERE c.id = conversation_id AND (
    (SELECT app_has_platform_permission('platform.support.inbox.read'))
    OR (c.assignee_user_id = app_current_user_id() AND (SELECT app_has_platform_permission('platform.support.assigned.access'))))));
CREATE POLICY support_assignments_insert ON support_assignments FOR INSERT TO ventidoc_app
  WITH CHECK (assigned_by_user_id = app_current_user_id() AND (SELECT app_has_platform_permission('platform.support.assign'))
              AND EXISTS (SELECT 1 FROM support_conversations c WHERE c.id = conversation_id));

-- Lifecycle events: read with platform.support.audit.read; written by whoever performs the visible action.
CREATE POLICY support_events_select ON support_conversation_events FOR SELECT TO ventidoc_app
  USING ((SELECT app_has_platform_permission('platform.support.audit.read')) AND EXISTS (
    SELECT 1 FROM support_conversations c WHERE c.id = conversation_id AND (
      (SELECT app_has_platform_permission('platform.support.inbox.read'))
      OR (c.assignee_user_id = app_current_user_id() AND (SELECT app_has_platform_permission('platform.support.assigned.access'))))));
CREATE POLICY support_events_insert ON support_conversation_events FOR INSERT TO ventidoc_app
  WITH CHECK (actor_user_id = app_current_user_id() AND EXISTS (SELECT 1 FROM support_conversations c WHERE c.id = conversation_id));

-- Staff read markers: one's own, on conversations one can see.
CREATE POLICY support_read_markers_own ON support_read_markers FOR ALL TO ventidoc_app
  USING (user_id = app_current_user_id() AND EXISTS (SELECT 1 FROM support_conversations c WHERE c.id = conversation_id))
  WITH CHECK (user_id = app_current_user_id() AND EXISTS (SELECT 1 FROM support_conversations c WHERE c.id = conversation_id));

-- Attachments: the uploader; the customer for anything sent in their conversation; staff
-- with platform.support.attachments.read who can see the conversation.
CREATE POLICY support_attachments_select ON support_attachments FOR SELECT TO ventidoc_app
  USING ((uploader_user_id = app_current_user_id() AND EXISTS (SELECT 1 FROM support_conversations c WHERE c.id = conversation_id))
         OR (message_id IS NOT NULL AND EXISTS (SELECT 1 FROM support_conversations c WHERE c.id = conversation_id AND c.customer_user_id = app_current_user_id()))
         OR ((SELECT app_has_platform_permission('platform.support.attachments.read')) AND EXISTS (
               SELECT 1 FROM support_conversations c WHERE c.id = conversation_id AND (
                 (SELECT app_has_platform_permission('platform.support.inbox.read'))
                 OR (c.assignee_user_id = app_current_user_id() AND (SELECT app_has_platform_permission('platform.support.assigned.access')))))));
CREATE POLICY support_attachments_insert ON support_attachments FOR INSERT TO ventidoc_app
  WITH CHECK (uploader_user_id = app_current_user_id() AND message_id IS NULL AND (
    (uploader_kind = 'CUSTOMER' AND EXISTS (SELECT 1 FROM support_conversations c WHERE c.id = conversation_id AND c.customer_user_id = app_current_user_id()))
    OR (uploader_kind = 'STAFF' AND (SELECT app_has_platform_permission('platform.support.reply')) AND EXISTS (
      SELECT 1 FROM support_conversations c WHERE c.id = conversation_id AND (
        (SELECT app_has_platform_permission('platform.support.inbox.read'))
        OR (c.assignee_user_id = app_current_user_id() AND (SELECT app_has_platform_permission('platform.support.assigned.access'))))))));
CREATE POLICY support_attachments_link ON support_attachments FOR UPDATE TO ventidoc_app
  USING (uploader_user_id = app_current_user_id() AND message_id IS NULL)
  WITH CHECK (uploader_user_id = app_current_user_id());
