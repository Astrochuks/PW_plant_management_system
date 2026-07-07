-- 016: Roles v1 split (Phase 3 start)
--
-- 'management' now means MD + GPM (identical view: plants + projects).
-- 'plant_officer' is management-tier for the PLANT module only — no
-- access to the projects module (enforced in the API layer).
--
-- users.role is the enum user_role. ADD VALUE cannot run inside a
-- transaction that also uses the new value, so this file is two
-- statements executed separately (no BEGIN/COMMIT).

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'plant_officer';

-- Friday Onche is the plant officer (decision 2026-07-07)
UPDATE users SET role = 'plant_officer', updated_at = now()
WHERE email = 'fonche@pwnigeria.com';
