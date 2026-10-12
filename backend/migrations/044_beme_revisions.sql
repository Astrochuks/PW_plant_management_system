-- 044: Bill of quantities as numbered REVISIONS (PRD v2 §3.6; decision
-- 2026-10-12 "go build" — milestone A of the Bill of Quantities tab).
--
-- A project's bill is a revision row; its bills and items hang off that
-- revision; the project points at its current one. Every later change
-- (a new import, a rate or item edit) is a new revision — nothing is ever
-- overwritten, so weekly facts can always say which revision they were
-- valued against. Approval by the project manager (pending → approved) is
-- the next milestone; until it ships a recorded revision is current at
-- once and the previous one is marked superseded.
--
-- Nothing is deleted. The bills the weekly workbooks established become
-- revision 1 of their project (source derived_from_weekly, approved).
--
-- Also: project_beme_items.sort_order — the order rows had on the sheet
-- (existing rows get a natural code order, 5.02 before 5.10).
--
-- Audit of this change-set: no view or function names these tables;
-- app code: project_bills.py (new), weekly_report_import.py (bill/item
-- upserts carry revision_id; the unique key on bills is now per revision).
--
-- Apply with:  python scripts/apply_migration.py 044

BEGIN;

CREATE TABLE IF NOT EXISTS project_beme_revisions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_no          integer NOT NULL,
  source               text NOT NULL
                       CHECK (source IN ('award_beme', 'derived_from_weekly', 'variation', 'correction')),
  state                text NOT NULL DEFAULT 'approved'
                       CHECK (state IN ('pending', 'approved', 'rejected', 'superseded')),
  effective_date       date NOT NULL,
  works_total          numeric(18,2),
  source_file_name     text,
  source_document_path text,
  note                 text,
  proposed_by          uuid REFERENCES users(id),
  proposed_at          timestamptz NOT NULL DEFAULT now(),
  decided_by           uuid REFERENCES users(id),
  decided_at           timestamptz,
  decision_note        text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, revision_no)
);
CREATE INDEX IF NOT EXISTS idx_beme_revisions_project ON project_beme_revisions (project_id, revision_no DESC);

ALTER TABLE project_beme_bills
  ADD COLUMN IF NOT EXISTS revision_id uuid REFERENCES project_beme_revisions(id) ON DELETE CASCADE;
ALTER TABLE project_beme_items
  ADD COLUMN IF NOT EXISTS revision_id uuid REFERENCES project_beme_revisions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS sort_order  integer;
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS current_beme_revision_id uuid REFERENCES project_beme_revisions(id) ON DELETE SET NULL;

-- ── backfill: the bills already on file become revision 1 ───────────────
INSERT INTO project_beme_revisions (project_id, revision_no, source, state, effective_date, works_total, note)
SELECT b.project_id, 1, 'derived_from_weekly', 'approved',
       min(b.created_at)::date,
       (SELECT sum(i.contract_amount) FROM project_beme_items i WHERE i.project_id = b.project_id),
       'revision 1 backfilled by 044 from the bills the weekly workbooks had established'
  FROM project_beme_bills b
 WHERE NOT EXISTS (SELECT 1 FROM project_beme_revisions r WHERE r.project_id = b.project_id)
 GROUP BY b.project_id;

UPDATE project_beme_bills b SET revision_id = r.id
  FROM project_beme_revisions r
 WHERE r.project_id = b.project_id AND r.revision_no = 1 AND b.revision_id IS NULL;

UPDATE project_beme_items i SET revision_id = r.id
  FROM project_beme_revisions r
 WHERE r.project_id = i.project_id AND r.revision_no = 1 AND i.revision_id IS NULL;

UPDATE projects p SET current_beme_revision_id = r.id
  FROM project_beme_revisions r
 WHERE r.project_id = p.id AND r.revision_no = 1 AND p.current_beme_revision_id IS NULL;

-- sheet order for existing items: natural order of the code (5.02 < 5.10)
WITH ordered AS (
  SELECT id, row_number() OVER (
           PARTITION BY bill_id
           ORDER BY (SELECT array_agg(lpad(p, 6, '0')) FROM unnest(string_to_array(COALESCE(item_code, ''), '.')) p),
                    dup_seq) AS rn
    FROM project_beme_items)
UPDATE project_beme_items i SET sort_order = o.rn FROM ordered o WHERE o.id = i.id AND i.sort_order IS NULL;

ALTER TABLE project_beme_bills ALTER COLUMN revision_id SET NOT NULL;
ALTER TABLE project_beme_items ALTER COLUMN revision_id SET NOT NULL;

-- bills are unique per REVISION now, not per project
DROP INDEX IF EXISTS uq_beme_bills_project_code;
CREATE UNIQUE INDEX IF NOT EXISTS uq_beme_bills_revision_code ON project_beme_bills (revision_id, bill_code);
CREATE INDEX IF NOT EXISTS idx_beme_items_revision ON project_beme_items (revision_id);

COMMIT;
