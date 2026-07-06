-- 009_register_views_and_benchmarks.sql
-- Applied: 2026-07-06
--
-- T1.12: v_projects_summary gains the migration-008 register columns +
--        a completeness score (6 core register fields).
-- T1.13: benchmark views. The 2017 register has NO planned durations
--        (original_duration_months = 0 rows), so planned-vs-actual overrun
--        factors are impossible for legacy data. What the data supports:
--          - v_project_delivery_times: actual award→completion months
--            (93 projects qualify)
--          - v_project_benchmarks_by_type: per type — project counts,
--            contract-value quartiles, delivery-time quartiles
--
-- Fully idempotent (CREATE OR REPLACE).

CREATE OR REPLACE VIEW v_projects_summary AS
SELECT p.id,
    p.project_name,
    p.short_name,
    p.client,
    p.state_id,
    p.original_contract_sum,
    p.variation_sum,
    p.current_contract_sum,
    p.contract_sum_raw,
    p.has_award_letter,
    p.award_date,
    p.award_date_raw,
    p.commencement_date,
    p.commencement_date_raw,
    p.original_duration_months,
    p.original_completion_date,
    p.extension_of_time_months,
    p.revised_completion_date,
    p.substantial_completion_cert,
    p.substantial_completion_date,
    p.substantial_completion_date_raw,
    p.final_completion_cert,
    p.final_completion_date,
    p.final_completion_date_raw,
    p.maintenance_cert,
    p.maintenance_cert_date,
    p.maintenance_cert_date_raw,
    p.retention_application_date,
    p.retention_application_date_raw,
    p.retention_paid,
    p.retention_amount_paid,
    p.works_vetted_certified,
    p.payment_received,
    p.outstanding_payment,
    p.cost_to_date,
    p.revenue_to_date,
    p.status,
    p.source_sheet,
    p.source_row,
    p.import_batch_id,
    p.notes,
    p.created_by,
    p.updated_by,
    p.created_at,
    p.updated_at,
    p.is_legacy,
    s.name AS state_name,
    s.code AS state_code,
    l.id AS linked_location_id,
    l.name AS linked_location_name,
    -- Register upgrade columns (migration 008)
    p.project_type,
    p.work_nature,
    p.register_source,
    p.client_id,
    p.location_id,
    p.scope_quantity,
    p.scope_unit,
    p.apg_amount,
    p.apg_expiry,
    p.apg_renewal_expiry,
    -- Completeness: 6 core register fields present, 0..1
    round((
        (p.original_contract_sum IS NOT NULL)::int
      + (p.award_date IS NOT NULL)::int
      + (p.state_id IS NOT NULL)::int
      + (p.project_type IS NOT NULL)::int
      + (p.work_nature IS NOT NULL)::int
      + (p.client_id IS NOT NULL)::int
    )::numeric / 6, 2) AS completeness
FROM projects p
LEFT JOIN states s ON s.id = p.state_id
LEFT JOIN locations l ON l.project_id = p.id;

-- ── T1.13 benchmark views ──────────────────────────────────────────────

CREATE OR REPLACE VIEW v_project_delivery_times AS
SELECT p.id,
    p.project_name,
    p.project_type,
    p.work_nature,
    p.client,
    p.client_id,
    s.name AS state_name,
    p.current_contract_sum,
    p.award_date,
    COALESCE(p.substantial_completion_date, p.final_completion_date) AS completion_date,
    round(
        (COALESCE(p.substantial_completion_date, p.final_completion_date) - p.award_date)::numeric
        / 30.44, 1
    ) AS delivery_months
FROM projects p
LEFT JOIN states s ON s.id = p.state_id
WHERE p.award_date IS NOT NULL
  AND COALESCE(p.substantial_completion_date, p.final_completion_date) IS NOT NULL
  AND COALESCE(p.substantial_completion_date, p.final_completion_date) > p.award_date;

CREATE OR REPLACE VIEW v_project_benchmarks_by_type AS
WITH vals AS (
    SELECT project_type,
        count(*) AS n_projects,
        count(current_contract_sum) AS n_valued,
        sum(current_contract_sum) AS total_value,
        percentile_cont(0.25) WITHIN GROUP (ORDER BY current_contract_sum) AS value_p25,
        percentile_cont(0.5)  WITHIN GROUP (ORDER BY current_contract_sum) AS value_median,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY current_contract_sum) AS value_p75
    FROM projects
    WHERE project_type IS NOT NULL
    GROUP BY project_type
),
deliv AS (
    SELECT project_type,
        count(*) AS n_delivered,
        percentile_cont(0.25) WITHIN GROUP (ORDER BY delivery_months) AS delivery_p25_months,
        percentile_cont(0.5)  WITHIN GROUP (ORDER BY delivery_months) AS delivery_median_months,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY delivery_months) AS delivery_p75_months
    FROM v_project_delivery_times
    WHERE project_type IS NOT NULL
    GROUP BY project_type
)
SELECT v.project_type,
    v.n_projects,
    v.n_valued,
    v.total_value,
    v.value_p25,
    v.value_median,
    v.value_p75,
    d.n_delivered,
    d.delivery_p25_months,
    d.delivery_median_months,
    d.delivery_p75_months
FROM vals v
LEFT JOIN deliv d USING (project_type);
