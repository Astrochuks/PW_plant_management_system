-- 045: Adders on a bill revision + the in-use lock (decisions 2026-10-12).
--
-- adders: the ladder a site applies under the works total — contingency,
-- VOP, VAT 7.5% … — recorded WITH the bill as parameters, never baked into
-- items (CLAUDE.md rule 2 spirit; PRD §3.6 project_beme_parameters, kept
-- as one jsonb list on the revision). Ordered; each is
--   {"name": "VAT", "kind": "percent_of_running" | "percent_of_works" | "amount", "value": 7.5}
-- and is applied in order to a running subtotal that starts at the works
-- total. The summary (bills → works total → adders → contract figure) is
-- computed from this, one place, server side (app/services/bills_summary.py).
--
-- locked_at: set the moment the first weekly quantity is recorded against
-- the revision (phase C). Before that the admin may replace or edit the
-- bill freely; after it, every change is a pending revision that waits for
-- the project manager's approval (next milestone).
--
-- Apply with:  python scripts/apply_migration.py 045

BEGIN;

ALTER TABLE project_beme_revisions
  ADD COLUMN IF NOT EXISTS adders    jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;

ALTER TABLE project_beme_revisions
  DROP CONSTRAINT IF EXISTS project_beme_revisions_adders_is_array,
  ADD CONSTRAINT project_beme_revisions_adders_is_array CHECK (jsonb_typeof(adders) = 'array');

COMMIT;
