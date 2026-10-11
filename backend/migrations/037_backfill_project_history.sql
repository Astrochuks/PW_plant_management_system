-- 037: Backfill project history from what the register already holds
-- (PRD v2 §9 step 3). Idempotent: skips projects that already have rows.
--
-- Contract sums: one 'original' per project that has a sum on record
-- (original_contract_sum, else current_contract_sum), basis 'unknown' —
-- the award letters workbook never said what the figure included — and a
-- 'variation' where current differs from original. 35 legacy rows carry
-- no sum at all and get no contract-sum row (nothing to invent).
--
-- Status events: every project gets one. The three active projects:
-- 'active' from their commencement (else award, else first weekly report
-- on file). Everything else (218 legacy rows): 'closed' from the latest
-- completion date on record, else 2017-12-31 — the award-letters workbook
-- that produced them ends in 2017 — with a note saying so.
--
-- The triggers from 036 refresh projects.status / status_since /
-- current_contract_sum as the rows land.

BEGIN;

-- ── contract sums ────────────────────────────────────────────────────────

INSERT INTO project_contract_sums
  (project_id, kind, amount, basis, effective_date, note)
SELECT p.id, 'original',
       COALESCE(p.original_contract_sum, p.current_contract_sum),
       'unknown',
       COALESCE(p.award_date, p.commencement_date, p.created_at::date),
       'backfilled from register 2026-10 (migration 037)'
  FROM projects p
 WHERE COALESCE(p.original_contract_sum, p.current_contract_sum) IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM project_contract_sums s
                    WHERE s.project_id = p.id AND s.kind = 'original');

INSERT INTO project_contract_sums
  (project_id, kind, amount, basis, effective_date, note)
SELECT p.id, 'variation',
       p.current_contract_sum,
       'unknown',
       -- the register never recorded when the sum changed; the day it was
       -- captured is the only honest date, and the note says so
       GREATEST(COALESCE(p.award_date, p.commencement_date, p.created_at::date),
                p.created_at::date),
       'backfilled from register 2026-10 (migration 037): current sum differed from original; effective date = date captured, not the instrument date'
  FROM projects p
 WHERE p.original_contract_sum IS NOT NULL
   AND p.current_contract_sum IS NOT NULL
   AND p.current_contract_sum <> p.original_contract_sum
   AND NOT EXISTS (SELECT 1 FROM project_contract_sums s
                    WHERE s.project_id = p.id AND s.kind = 'variation');

-- ── status events ────────────────────────────────────────────────────────

-- the live projects (3 on 2026-10-11): active since they started
INSERT INTO project_status_events (project_id, status, effective_date, note)
SELECT p.id, 'active',
       COALESCE(p.commencement_date, p.award_date,
                (SELECT min(w.week_ending_date) FROM project_weekly_reports w
                  WHERE w.project_id = p.id),
                p.created_at::date),
       'backfilled from register 2026-10 (migration 037)'
  FROM projects p
 WHERE NOT p.is_legacy
   AND p.status = 'active'
   AND NOT EXISTS (SELECT 1 FROM project_status_events e WHERE e.project_id = p.id);

-- everything else: closed, dated by the best completion date on record
INSERT INTO project_status_events (project_id, status, effective_date, note)
SELECT p.id, 'closed',
       COALESCE(p.final_completion_date, p.substantial_completion_date,
                p.original_completion_date, DATE '2017-12-31'),
       CASE WHEN COALESCE(p.final_completion_date, p.substantial_completion_date,
                          p.original_completion_date) IS NULL
            THEN 'backfilled from register 2026-10 (migration 037): no completion date on record; 2017-12-31 = end of the award-letters workbook'
            ELSE 'backfilled from register 2026-10 (migration 037)' END
  FROM projects p
 WHERE NOT EXISTS (SELECT 1 FROM project_status_events e WHERE e.project_id = p.id);

COMMIT;
