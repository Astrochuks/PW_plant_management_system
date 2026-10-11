-- 038: Every project row gets its first history rows automatically.
--
-- 036 made projects.status and current_contract_sum caches of the two
-- history tables. Until the A-3 register API writes history itself, the
-- July create endpoint still INSERTs straight into projects with a status
-- and a sum — which would leave a project with a cache but no history
-- (verify_project_history.py would fail). This trigger closes that gap
-- for any insert path, now and later: the inserted row's status becomes
-- its first status event, and its sum (if any) its 'original' contract
-- sum. The cache triggers then re-derive the same values, so nothing
-- changes on the row itself.
--
-- Updates to projects.status / current_contract_sum made directly (not via
-- history rows) are NOT guarded here — A-3 removes the last writer.

BEGIN;

CREATE OR REPLACE FUNCTION seed_project_history_on_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO project_status_events (project_id, status, effective_date, note, created_by)
  VALUES (NEW.id,
          COALESCE(NEW.status, 'awarded')::project_status,
          COALESCE(NEW.commencement_date, NEW.award_date, current_date),
          'opening status recorded with the project',
          NEW.created_by);

  IF COALESCE(NEW.original_contract_sum, NEW.current_contract_sum) IS NOT NULL THEN
    INSERT INTO project_contract_sums
      (project_id, kind, amount, basis, effective_date, note, created_by)
    VALUES (NEW.id, 'original',
            COALESCE(NEW.original_contract_sum, NEW.current_contract_sum),
            'unknown',
            COALESCE(NEW.award_date, NEW.commencement_date, current_date),
            'original contract sum recorded with the project',
            NEW.created_by);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_projects_seed_history ON projects;
CREATE TRIGGER trg_projects_seed_history
  AFTER INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION seed_project_history_on_insert();

COMMIT;
