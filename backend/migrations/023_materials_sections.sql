-- 023: materials sheet_source = canonical section ('materials'|'quarry').
-- v1 allowed ('precast','materials'); the promoted parser stores the
-- sheet's two sections. Precast lives in its own (dormant) sheet now.
ALTER TABLE project_materials_stock
    DROP CONSTRAINT IF EXISTS project_materials_stock_sheet_source_check;
ALTER TABLE project_materials_stock
    ADD CONSTRAINT project_materials_stock_sheet_source_check
    CHECK (sheet_source IN ('materials', 'quarry', 'precast'));
