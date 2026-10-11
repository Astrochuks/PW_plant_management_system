-- 040: Let the register API write a project's first history rows itself.
--
-- 038 seeds a status event and an original contract sum from every
-- inserted projects row, so no insert path can leave a project without
-- history. The new-project screen (A-4) knows MORE than the row does —
-- the contract sum's basis and instrument, the status' effective date —
-- so it inserts those rows itself inside the same transaction, after
-- telling the trigger to stand down for that transaction only:
--
--     SET LOCAL app.seed_history = 'off';
--
-- Any other insert (SQL by hand, the award-letters import, an older
-- client) still gets the 038 defaults.

BEGIN;

CREATE OR REPLACE FUNCTION seed_project_history_on_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.seed_history', true) = 'off' THEN
    RETURN NEW;  -- the caller writes the history rows in this transaction
  END IF;

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

COMMIT;
