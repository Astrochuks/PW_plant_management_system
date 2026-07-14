-- 025: durable fleet-number verdicts (2026-07-14).
--
-- The import auto-matches raw fleet numbers against plants_master; what
-- doesn't match lands in the unmapped queue. Until now a manual link
-- only backfilled existing rows — the same raw number came back
-- unresolved on every future upload — and there was no way to say
-- "this is not company plant" (e.g. hired-vehicle registration
-- AE 926 HER in the diesel log).
--
-- One row here = one durable verdict for a normalized raw number:
--   kind='plant'    → resolves to plant_id at import time, links stick
--   kind='external' → not company plant (hired/contractor); rows keep
--                     plant_id NULL, number leaves the queue for good
-- Rows are always saved regardless — a verdict only affects linking.

BEGIN;

CREATE TABLE IF NOT EXISTS project_fleet_aliases (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_normalized text NOT NULL UNIQUE,
    kind           text NOT NULL CHECK (kind IN ('plant', 'external')),
    plant_id       uuid REFERENCES plants_master(id) ON DELETE CASCADE,
    label          text,
    notes          text,
    created_by     uuid,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CHECK ((kind = 'plant') = (plant_id IS NOT NULL))
);

COMMIT;
