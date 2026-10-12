-- 043: All 36 states + FCT in the states table (request 2026-10-12: the
-- project form's State list must offer every state, not only the 18 that
-- had been entered by hand).
--
-- Reference data only. Idempotent: ON CONFLICT on name_normalized (a
-- GENERATED column — upper(name) — so it is never written directly) leaves
-- existing rows untouched; the four rows that had no region get one.
-- Codes follow the existing three-letter convention already in the table
-- (ADA, AKS, BEN, CRS, EDO, ENU, FCT, KAD, KWA, LAG, NAS, NIG, OGU, OYO,
-- PLA, SOK, TAR, ZAM).
--
-- Apply with:  python scripts/apply_migration.py 043

BEGIN;

INSERT INTO states (name, code, region) VALUES
  ('Abia',    'ABI', 'South East'),
  ('Anambra', 'ANA', 'South East'),
  ('Bauchi',  'BAU', 'North East'),
  ('Bayelsa', 'BAY', 'South South'),
  ('Borno',   'BOR', 'North East'),
  ('Delta',   'DEL', 'South South'),
  ('Ebonyi',  'EBO', 'South East'),
  ('Ekiti',   'EKI', 'South West'),
  ('Gombe',   'GOM', 'North East'),
  ('Imo',     'IMO', 'South East'),
  ('Jigawa',  'JIG', 'North West'),
  ('Kano',    'KAN', 'North West'),
  ('Katsina', 'KAT', 'North West'),
  ('Kebbi',   'KEB', 'North West'),
  ('Kogi',    'KOG', 'North Central'),
  ('Ondo',    'OND', 'South West'),
  ('Osun',    'OSU', 'South West'),
  ('Rivers',  'RIV', 'South South'),
  ('Yobe',    'YOB', 'North East')
ON CONFLICT (name_normalized) DO NOTHING;

UPDATE states SET region = v.region, updated_at = now()
  FROM (VALUES
    ('CROSS RIVER', 'South South'),
    ('NASARAWA',    'North Central'),
    ('OYO',         'South West'),
    ('SOKOTO',      'North West')) AS v(name_normalized, region)
 WHERE states.name_normalized = v.name_normalized AND states.region IS NULL;

COMMIT;
