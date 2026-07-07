-- 015_project_submission_status_view.sql
-- Applied: 2026-07-07
-- T2.21: per-project weekly-report coverage (mirrors the plant module's
-- v_weekly_submission_status pattern). Missing weeks between a project's
-- first and last ingested week are surfaced explicitly.

CREATE OR REPLACE VIEW v_project_submission_status AS
WITH spans AS (
    SELECT project_id, year,
           min(week_number) AS first_week,
           max(week_number) AS last_week,
           count(*)         AS weeks_received,
           max(week_ending_date) AS last_week_ending
    FROM project_weekly_reports
    GROUP BY project_id, year
)
SELECT p.id AS project_id,
       p.short_name,
       p.project_name,
       s.year,
       s.first_week,
       s.last_week,
       s.weeks_received,
       (s.last_week - s.first_week + 1) - s.weeks_received AS missing_count,
       ARRAY(
           SELECT w FROM generate_series(s.first_week, s.last_week) AS w
           WHERE NOT EXISTS (
               SELECT 1 FROM project_weekly_reports r
               WHERE r.project_id = p.id AND r.year = s.year AND r.week_number = w
           )
       ) AS missing_weeks,
       s.last_week_ending,
       (CURRENT_DATE - s.last_week_ending)::int AS days_since_last_report
FROM projects p
JOIN spans s ON s.project_id = p.id;
