-- 048: Readable project addresses (request 2026-10-13: "the project name
-- is supposed to be showing, not the id").
--
-- projects.slug — lower-case, hyphenated, from the short name (or the
-- project name when there is none), at most 80 characters, unique
-- (duplicates get -2, -3 …). The UUID keeps working everywhere as a
-- fallback so old links never break; the app links with the slug.
-- Create/update set it from app/core/text.py slugify(); this backfills.
--
-- Apply with:  python scripts/apply_migration.py 048

BEGIN;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS slug text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_slug ON projects (slug) WHERE slug IS NOT NULL;

WITH base AS (
  SELECT id,
         trim(both '-' from left(
           trim(both '-' from regexp_replace(lower(coalesce(nullif(trim(short_name), ''), project_name)), '[^a-z0-9]+', '-', 'g')),
           80)) AS s
    FROM projects
   WHERE slug IS NULL
), numbered AS (
  SELECT id, s, row_number() OVER (PARTITION BY s ORDER BY id) AS rn FROM base
)
UPDATE projects p
   SET slug = CASE WHEN n.rn = 1 AND NOT EXISTS (SELECT 1 FROM projects q WHERE q.slug = n.s)
                   THEN n.s ELSE n.s || '-' || n.rn END
  FROM numbered n
 WHERE n.id = p.id;

COMMIT;
