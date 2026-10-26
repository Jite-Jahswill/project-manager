-- ===========================================================================
-- Hand-written: Phase 6 audit hardening (docs/architecture/13-finance.md §13.7).
-- Adds checks and replaces trigger functions only: no table, column or row is changed, and the
-- new constraints hold for every row the API has written.
-- ===========================================================================

-- 1. Cash events only enter an OPEN cashier session. The API locks the session FOR SHARE when
-- it records a cash payment or refund (closing locks it FOR UPDATE); this is the database's
-- own refusal of a payment or refund into a closed session, of the session's branch only.
CREATE FUNCTION app_session_cash_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE branch uuid;
BEGIN
  IF NEW.session_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- IF, not CASE: PL/pgSQL plans a whole expression, and refunds have no branch_id column.
  IF TG_TABLE_NAME = 'payments' THEN
    branch := NEW.branch_id;
  ELSE
    SELECT s.branch_id INTO branch FROM sales s WHERE s.id = NEW.sale_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cashier_sessions c WHERE c.id = NEW.session_id AND c.organization_id = NEW.organization_id
                 AND c.branch_id = branch AND c.status = 'OPEN') THEN
    RAISE EXCEPTION '%: the cashier session is not open at this branch', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER payments_session_guard BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION app_session_cash_guard();
CREATE TRIGGER refunds_session_guard BEFORE INSERT ON refunds FOR EACH ROW EXECUTE FUNCTION app_session_cash_guard();

-- 2. Only the creator submits; an unsubmitted draft records no submitter.
ALTER TABLE expenses
  ADD CONSTRAINT expenses_submitter_is_creator CHECK (submitted_by_user_id IS NULL OR submitted_by_user_id = created_by_user_id),
  ADD CONSTRAINT expenses_draft_unsubmitted CHECK (status <> 'DRAFT' OR submitted_by_user_id IS NULL);

-- 3. Actor columns name the acting user (the tenant context's app.user_id, which RLS already
-- trusts), so no code path can record someone else as creator, editor, decider or voider.
CREATE OR REPLACE FUNCTION app_expense_insert_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.status <> 'DRAFT' OR NEW.version <> 1 THEN
    RAISE EXCEPTION 'expenses: new expenses start as version 1 drafts' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.created_by_user_id IS DISTINCT FROM app_current_user_id() THEN
    RAISE EXCEPTION 'expenses: created_by_user_id must be the acting user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.corrects_expense_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM expenses e WHERE e.id = NEW.corrects_expense_id AND e.organization_id = NEW.organization_id AND e.status = 'VOIDED') THEN
    RAISE EXCEPTION 'expenses: only a voided expense can be corrected' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION app_expense_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.number IS DISTINCT FROM OLD.number
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.corrects_expense_id IS DISTINCT FROM OLD.corrects_expense_id THEN
    RAISE EXCEPTION 'expenses: identity columns are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT app_expense_transition_ok(OLD.status::text, NEW.status::text) THEN
    RAISE EXCEPTION 'expenses: invalid status transition % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  -- Financial content is editable only in DRAFT: what was submitted is what is decided and reported.
  IF OLD.status <> 'DRAFT' AND (NEW.branch_id IS DISTINCT FROM OLD.branch_id OR NEW.category_id IS DISTINCT FROM OLD.category_id
     OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.description IS DISTINCT FROM OLD.description OR NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.occurred_on IS DISTINCT FROM OLD.occurred_on) THEN
    RAISE EXCEPTION 'expenses: only a draft can be edited' USING ERRCODE = 'check_violation';
  END IF;
  -- A non-draft row changes only by a transition, and recorded decisions never change afterwards.
  IF OLD.status <> 'DRAFT' AND NEW.status = OLD.status
     AND to_jsonb(NEW) - 'updated_at' - 'version' IS DISTINCT FROM to_jsonb(OLD) - 'updated_at' - 'version' THEN
    RAISE EXCEPTION 'expenses: a % expense is immutable', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD.submitted_by_user_id IS NOT NULL AND (NEW.submitted_by_user_id IS DISTINCT FROM OLD.submitted_by_user_id OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at))
     OR (OLD.decided_by_user_id IS NOT NULL AND (NEW.decided_by_user_id IS DISTINCT FROM OLD.decided_by_user_id OR NEW.decided_at IS DISTINCT FROM OLD.decided_at)) THEN
    RAISE EXCEPTION 'expenses: recorded submissions and decisions are immutable' USING ERRCODE = 'check_violation';
  END IF;
  -- Who: a draft is edited by its creator; each actor column a transition sets is the acting user.
  IF OLD.status = 'DRAFT' AND NEW.status = 'DRAFT' AND app_current_user_id() IS DISTINCT FROM OLD.created_by_user_id
     AND to_jsonb(NEW) - 'updated_at' - 'version' IS DISTINCT FROM to_jsonb(OLD) - 'updated_at' - 'version' THEN
    RAISE EXCEPTION 'expenses: only the creator edits a draft' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.submitted_by_user_id IS DISTINCT FROM OLD.submitted_by_user_id AND NEW.submitted_by_user_id IS DISTINCT FROM app_current_user_id())
     OR (NEW.decided_by_user_id IS DISTINCT FROM OLD.decided_by_user_id AND NEW.decided_by_user_id IS DISTINCT FROM app_current_user_id())
     OR (NEW.cancelled_by_user_id IS DISTINCT FROM OLD.cancelled_by_user_id AND NEW.cancelled_by_user_id IS DISTINCT FROM app_current_user_id())
     OR (NEW.voided_by_user_id IS DISTINCT FROM OLD.voided_by_user_id AND NEW.voided_by_user_id IS DISTINCT FROM app_current_user_id()) THEN
    RAISE EXCEPTION 'expenses: a decision must be recorded by the acting user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Server-managed version: any change is exactly one new version.
  IF to_jsonb(NEW) - 'updated_at' - 'version' IS DISTINCT FROM to_jsonb(OLD) - 'updated_at' - 'version' OR NEW.version <> OLD.version THEN
    NEW.version := OLD.version + 1;
  ELSE
    NEW.version := OLD.version;
  END IF;
  RETURN NEW;
END
$$;

-- Attachments: uploaded by the acting user, who is the expense's creator.
CREATE OR REPLACE FUNCTION app_expense_attachment_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM expenses e WHERE e.id = NEW.expense_id AND e.organization_id = NEW.organization_id AND e.status IN ('DRAFT', 'SUBMITTED')) THEN
    RAISE EXCEPTION 'expense_attachments: the expense is no longer open' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.uploaded_by_user_id IS DISTINCT FROM app_current_user_id()
     OR NOT EXISTS (SELECT 1 FROM expenses e WHERE e.id = NEW.expense_id AND e.created_by_user_id = NEW.uploaded_by_user_id) THEN
    RAISE EXCEPTION 'expense_attachments: only the expense creator, acting themselves, attaches files' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

-- History rows name the acting user.
CREATE FUNCTION app_expense_event_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.actor_user_id IS DISTINCT FROM app_current_user_id() THEN
    RAISE EXCEPTION 'expense_events: actor_user_id must be the acting user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER expense_events_guard BEFORE INSERT ON expense_events FOR EACH ROW EXECUTE FUNCTION app_expense_event_guard();

-- Cash movements: recorded by the acting user (the session and reversal rules are unchanged).
CREATE OR REPLACE FUNCTION app_cash_movement_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE o cash_movements%ROWTYPE;
BEGIN
  IF NEW.recorded_by_user_id IS DISTINCT FROM app_current_user_id() THEN
    RAISE EXCEPTION 'cash_movements: recorded_by_user_id must be the acting user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM cashier_sessions s WHERE s.id = NEW.session_id AND s.organization_id = NEW.organization_id
      AND s.branch_id = NEW.branch_id AND s.currency = NEW.currency AND s.status = 'OPEN') THEN
    RAISE EXCEPTION 'cash_movements: the cashier session is not open at this branch in this currency' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.type = 'REVERSAL' THEN
    SELECT * INTO o FROM cash_movements WHERE id = NEW.reverses_id AND organization_id = NEW.organization_id;
    IF NOT FOUND OR o.type = 'REVERSAL' OR o.branch_id <> NEW.branch_id OR o.session_id IS DISTINCT FROM NEW.session_id
       OR o.currency <> NEW.currency OR o.amount_minor <> NEW.amount_minor OR o.direction = NEW.direction THEN
      RAISE EXCEPTION 'cash_movements: a reversal must mirror its original movement' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
