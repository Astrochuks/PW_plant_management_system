-- 043: All 36 states + FCT in the states table (request 2026-10-12: the
-- project form's State list must offer every state, not only the 18 that
-- had been entered by hand).
--
-- Reference data only. Idempotent: ON CONFLICT on name_normalized leaves
-- existing rows untouched; the four rows that had no region get one.
-- Codes follow the existing three-letter convention already in the table
-- (ADA, AKS, BEN, CRS, EDO, ENU, FCT, KAD, KWA, LAG, NAS, NIG, OGU, OYO,
-- PLA, SOK, TAR, ZAM).
--
-- Apply with:  python scripts/apply_migration.py 043

BEGIN;

INSERT INTO states (name, name_normalized, code, region) VALUES
  ('Abia',      'ABIA',      'ABI', 'South East'),
  ('Anambra',   'ANAMBRA',   'ANA', 'South East'),
  ('Bauchi',    'BAUCHI',    'BAU', 'North East'),
  ('Bayelsa',   'BAYELSA',   'BAY', 'South South'),
  ('Borno',     'BORNO',     'BOR', 'North East'),
  ('Delta',     'DELTA',     'DEL', 'South South'),
  ('Ebonyi',    'EBONYI',    'EBO', 'South East'),
  ('Ekiti',     'EKITI',     'EKI', 'South West'),
  ('Gombe',     'GOMBE',     'GOM', 'North East'),
  ('Imo',       'IMO',       'IMO', 'South East'),
  ('Jigawa',    'JIGAWA',    'JIG', 'North West'),
  ('Kano',      'KANO',      'KAN', 'North West'),
  ('Katsina',   'KATSINA',   'KAT', 'North West'),
  ('Kebbi',     'KEBBI',     'KEB', 'North West'),
  ('Kogi',      'KOGI',      'KOG', 'North Central'),
  ('Ondo',      'ONDO',      'OND', 'South West'),
  ('Osun',      'OSUN',      'OSU', 'South West'),
  ('Rivers',    'RIVERS',    'RIV', 'South South'),
  ('Yobe',      'YOBE',      'YOB', 'North East')
ON CONFLICT (name_normalized) DO NOTHING;

UPDATE states SET region = v.region, updated_at = now()
  FROM (VALUES
    ('CROSS RIVER', 'South South'),
    ('NASARAWA',    'North Central'),
    ('OYO',         'South West'),
    ('SOKOTO',      'North West')) AS v(name_normalized, region)
 WHERE states.name_normalized = v.name_normalized AND states.region IS NULL;

COMMIT;
