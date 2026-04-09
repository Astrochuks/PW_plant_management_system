# Projects Module — Audit & Strategy

> Last updated: 2026-04-08
> Status: Strategy phase, no implementation yet

---

## 1. WHAT I FOUND IN THE FILES

### 1.1 Award Letters Workbook (already imported)
**File:** `project files/Copy of Award letters Completion Certs.2017 (1).xlsx`
- **17 sheets** organized by client/state
- **What it tracks:** Historical project register — name, client, contract sum, award date, certification status, retention, payments
- **Used by:** `award_letters_parser.py` (already integrated)
- **Status:** Working but has parsing issues with narrative text

### 1.2 Weekly Progress Reports (NEW — not currently integrated)
**Folder:** `project files/uyoweeklyreport2026/` — 9 weekly reports for **Akwa Ibom Airport project**

**Each weekly report has 16 sheets:**

| Sheet | What it Contains | Importance |
|---|---|---|
| **Weekly Summary** | BEME items: Contract qty, Previous, This Week, To Date, % Complete | ⭐⭐⭐ Critical |
| **Contract Summary** | Client, contract sum, schedules, value of works, retention, payments % | ⭐⭐⭐ Critical |
| **BEME & Works Completed** | Detailed bill of engineering measurements (364 rows × 202 cols!) | ⭐⭐⭐ Critical |
| **Certificate Status** | All certificates submitted with values, dates, gross/net amounts | ⭐⭐⭐ Critical |
| **Payments Received** | Date, voucher #, gross, deductions (WHT, VAT, vetting fee, stamp duty) | ⭐⭐⭐ Critical |
| **Cost Report** | Cost categories: Plant, AGO, Materials, Subcontractors, Labour, Overheads, Site expenses | ⭐⭐⭐ Critical |
| **Diesel Consumption** | Per-fleet daily diesel usage (Sat-Fri) | ⭐⭐ Important |
| **Plant Return** | Per-plant hours worked / standby / breakdown / cost / location | ⭐⭐⭐ Critical (LINKS TO PLANTS!) |
| **Hired Vehicles** | Reg no, description, days worked, rate, owners | ⭐⭐ Important |
| **Labour Strength** | Department, current week vs previous week manning | ⭐⭐ Important |
| **Subcontractors** | Subcontractor name, description, rates, qty executed, payments | ⭐⭐⭐ Critical |
| **Precast** | Precast items inventory | ⭐ Useful |
| **Materials & Civils** | Cement, rebar inventory: opening stock, received, used, closing | ⭐⭐ Important |
| **Bill 1 Summary** | Bill 1 schedule (utility/government bills) | ⭐ Useful |
| **Bill 1 Payments** | Detailed Bill 1 payment log | ⭐ Useful |
| **Lists** | Reference data: dates, weeks, units of measure, cost categories | (config) |

### 1.3 Individual Site Output (separate file)
**File:** `project files/Individual site output January - October.xlsx`
- **What:** Monthly output values per site for 2017
- **Use:** Historical baseline for revenue tracking

---

## 2. KEY INSIGHT — These Reports Are GOLD

The Akwa Ibom weekly reports contain **EVERYTHING** about a project's operations:
- ✅ **Contract details** (sum, dates, duration, extensions, completion %)
- ✅ **Physical progress** (BEME line items with quantities and % complete)
- ✅ **Financial position** (payments received, certificates submitted, retention, outstanding)
- ✅ **Plant utilization** (which plants on this project, hours worked, costs)
- ✅ **Diesel consumption** (per-plant daily)
- ✅ **Labour strength** (department-wise headcount tracking)
- ✅ **Subcontractor management** (who, doing what, paid how much)
- ✅ **Materials inventory** (stock movements)
- ✅ **Cost categorization** (Plant, AGO, Materials, Subs, Labour, Overheads, Site)

**This is what the Projects module should be — not just a static project registry, but a LIVE operational dashboard fed by these weekly reports.**

---

## 3. WHAT THE PROJECTS MODULE LOOKS LIKE TODAY

### Current Architecture
```
projects table (33+ columns)
    ↓ (one-way)
locations.project_id (foreign key)
    ↓ (proxy)
plants_master.current_location_id

NO link between projects and:
  - plant utilization (hours worked)
  - spare parts costs
  - subcontractors
  - labour
  - materials
  - certificates / payments / cash flow
  - BEME progress
```

### What Works
- Basic CRUD (list, detail, create, edit, delete)
- Award letter bulk import (handles narrative text)
- Filtering (by client, state, status, search)
- Stats cards (totals, by status, contract value)
- Milestone timeline (8 dates from project record)
- Location linking (one location ↔ one project)

### What's Missing (Most Important)
1. **No project weekly progress reports** — the rich data above is invisible
2. **No plant ↔ project allocation** — can't see which plants worked on a project, when, for how many hours
3. **No certificate tracking** — only the count from award letters import
4. **No payment tracking** — only summary fields, no payment log
5. **No subcontractor management**
6. **No materials/diesel/labour tracking**
7. **No project cost rollup** — can't answer "how much did this project cost so far?"
8. **No physical progress tracking** — can't answer "what % of BEME is done?"
9. **No plant cost allocation** — plants_master shows total maintenance, but not per-project

---

## 4. PROPOSED ARCHITECTURE

### 4.1 New Database Tables

```sql
-- The header for each uploaded weekly project report
project_weekly_reports (
  id UUID PK,
  project_id UUID FK → projects(id),
  year INT,
  week_number INT,
  week_ending_date DATE,
  source_file_path TEXT,        -- Supabase storage path
  uploaded_by UUID,
  uploaded_at TIMESTAMPTZ,
  status TEXT,                   -- pending|processing|completed|failed
  errors JSONB,
  metadata JSONB,                -- raw header info
  UNIQUE (project_id, year, week_number)
)

-- BEME (Bill of Engineering Measurements) line items
project_beme_items (
  id UUID PK,
  project_id UUID FK,
  bill_no INT,
  item_no TEXT,
  description TEXT,
  unit TEXT,
  contract_qty NUMERIC,
  contract_rate NUMERIC,
  contract_amount NUMERIC,
  -- Updated each week from latest report:
  total_qty_completed NUMERIC,
  qty_outstanding NUMERIC,
  pct_complete NUMERIC,
  last_updated_week INT
)

-- Per-week BEME progress snapshot
project_beme_progress (
  id UUID PK,
  report_id UUID FK → project_weekly_reports(id),
  beme_item_id UUID FK,
  previous_qty NUMERIC,
  this_week_qty NUMERIC,
  total_qty NUMERIC,
  pct_complete NUMERIC
)

-- Certificate submissions tracking
project_certificates (
  id UUID PK,
  project_id UUID FK,
  cert_number INT,
  date_submitted DATE,
  gross_value_works_done NUMERIC,
  add_materials_on_site NUMERIC,
  less_materials_on_site NUMERIC,
  general_bill_1 NUMERIC,
  total_value_work_done NUMERIC,
  value_per_cert NUMERIC,
  status TEXT,                   -- pending|certified|paid
  notes TEXT,
  source_report_id UUID
)

-- Payments received
project_payments (
  id UUID PK,
  project_id UUID FK,
  payment_date DATE,
  voucher_number TEXT,
  payment_type TEXT,             -- Advance|Cert|Final
  cert_number INT,
  gross_amount NUMERIC,
  wht NUMERIC,
  vat NUMERIC,
  vetting_fee NUMERIC,
  stamp_duty NUMERIC,
  net_amount NUMERIC,
  source_report_id UUID
)

-- Per-week cost report
project_cost_report (
  id UUID PK,
  report_id UUID FK,
  project_id UUID FK,
  category TEXT,                 -- Plant|AGO|Materials|Subcontractors|Labour|Overheads|Site Level Expenses|Bill 1
  description TEXT,
  unit TEXT,
  quantity_this_week NUMERIC,
  rate NUMERIC,
  amount_previous_week NUMERIC,
  amount_this_week NUMERIC,
  amount_to_date NUMERIC
)

-- Plant utilization on project (THE LINK)
project_plant_utilization (
  id UUID PK,
  report_id UUID FK,
  project_id UUID FK,
  plant_id UUID FK → plants_master(id),    -- resolved by fleet number
  fleet_number TEXT,                        -- raw, in case unresolved
  description TEXT,
  hours_worked NUMERIC,
  standby_hours NUMERIC,
  breakdown_hours NUMERIC,
  rate NUMERIC,
  plant_cost NUMERIC,
  transferred_from TEXT,
  current_location TEXT
)

-- Diesel consumption per fleet
project_diesel_consumption (
  id UUID PK,
  report_id UUID FK,
  project_id UUID FK,
  plant_id UUID FK,
  fleet_number TEXT,
  description TEXT,
  category TEXT,
  saturday NUMERIC,
  sunday NUMERIC,
  monday NUMERIC,
  tuesday NUMERIC,
  wednesday NUMERIC,
  thursday NUMERIC,
  friday NUMERIC,
  total_litres NUMERIC,
  rate NUMERIC,
  amount NUMERIC
)

-- Labour strength snapshot
project_labour_strength (
  id UUID PK,
  report_id UUID FK,
  project_id UUID FK,
  department TEXT,
  manning_this_week INT,
  manning_previous_week INT,
  movement INT,
  comment TEXT
)

-- Subcontractor work
project_subcontractors (
  id UUID PK,
  report_id UUID FK,
  project_id UUID FK,
  subcontractor_name TEXT,
  description TEXT,
  location TEXT,
  unit TEXT,
  agreed_rate NUMERIC,
  assigned_qty NUMERIC,
  qty_this_week NUMERIC,
  total_qty_to_date NUMERIC,
  amount NUMERIC
)

-- Hired vehicles
project_hired_vehicles (
  id UUID PK,
  report_id UUID FK,
  project_id UUID FK,
  reg_no TEXT,
  description TEXT,
  section TEXT,
  owner TEXT,
  days_worked NUMERIC,
  rate NUMERIC,
  amount NUMERIC,
  remarks TEXT
)

-- Materials inventory
project_materials_stock (
  id UUID PK,
  report_id UUID FK,
  project_id UUID FK,
  description TEXT,
  unit TEXT,
  current_price NUMERIC,
  opening_stock NUMERIC,
  received NUMERIC,
  used_this_week NUMERIC,
  closing_stock NUMERIC,
  available_for_use NUMERIC
)

-- Project documents (PDFs of award letters, etc.)
project_documents (
  id UUID PK,
  project_id UUID FK,
  document_type TEXT,            -- award_letter|completion_cert|payment_voucher|other
  file_name TEXT,
  storage_path TEXT,
  uploaded_by UUID,
  uploaded_at TIMESTAMPTZ,
  description TEXT
)
```

### 4.2 New Views

```sql
-- Per-project rollup with everything aggregated
v_project_dashboard (
  project_id, project_name, client, status,
  contract_sum, total_certified, total_paid, outstanding,
  pct_physical_complete,
  pct_financial_complete,
  weeks_on_site,
  total_plant_cost,
  total_material_cost,
  total_subcontractor_cost,
  total_labour_count,
  active_plants_count,
  last_report_date,
  ...
)

-- Project plant utilization summary
v_project_plant_summary (
  project_id, plant_id, fleet_number,
  total_hours_worked, total_standby, total_breakdown,
  total_cost, weeks_active,
  first_seen_date, last_seen_date
)
```

### 4.3 New ETL Worker

```python
# backend/app/workers/project_etl_worker.py

async def process_project_weekly_report(
    submission_id: str,
    storage_path: str,
    project_id: str
) -> dict:
    """
    16-sheet workbook → many tables.

    Steps:
    1. Download from Supabase storage
    2. Parse Contract Summary (validates project_id matches)
    3. Parse each sheet → write to corresponding table
    4. Resolve plant fleet numbers → plant_id (LINK TO PLANTS MODULE)
    5. Aggregate into project_weekly_reports record
    6. Update v_project_dashboard view (already auto-refreshes)
    7. Mark submission as completed
    """
```

### 4.4 New API Endpoints

```
POST   /projects/{id}/weekly-reports         Upload weekly report
GET    /projects/{id}/weekly-reports         List uploaded reports
GET    /projects/{id}/weekly-reports/{wid}   Get report detail
DELETE /projects/{id}/weekly-reports/{wid}   Delete report

GET    /projects/{id}/dashboard              Full operational dashboard
GET    /projects/{id}/beme                   BEME progress
GET    /projects/{id}/certificates           Certificates list
GET    /projects/{id}/payments               Payments log
GET    /projects/{id}/cost-report            Cost report (with date filter)
GET    /projects/{id}/plant-utilization      Plants used on this project
GET    /projects/{id}/diesel-consumption     Diesel usage
GET    /projects/{id}/labour                 Labour strength over time
GET    /projects/{id}/subcontractors         Subcontractor work
GET    /projects/{id}/materials              Materials inventory

POST   /projects/{id}/documents              Upload project document
GET    /projects/{id}/documents              List documents
DELETE /projects/{id}/documents/{did}        Delete document
```

### 4.5 New Frontend Pages

```
/projects/[id]                                Main detail page (existing)
/projects/[id]/dashboard                      Operational dashboard (NEW)
/projects/[id]/weekly-reports                 Reports list (NEW)
/projects/[id]/weekly-reports/[week]          Report detail (NEW)
/projects/[id]/finance                        Certificates + payments + cash flow (NEW)
/projects/[id]/progress                       BEME progress timeline (NEW)
/projects/[id]/plants                         Plants utilized + utilization chart (NEW)
/projects/[id]/cost-breakdown                 Cost categories + trends (NEW)
/projects/[id]/labour                         Labour strength chart (NEW)
/projects/[id]/subcontractors                 Subcontractor list (NEW)
/projects/[id]/documents                      Document library (NEW)
```

---

## 5. RECOMMENDED PHASES

### Phase 1 — Foundation (Week 1-2)
- ✅ This audit document
- Create database tables (10-12 new tables + 2 views)
- Migration script
- Project documents storage (Supabase bucket setup)
- Backend models for new tables

### Phase 2 — Weekly Report ETL (Week 2-3)
- Build `project_etl_worker.py` to parse 16-sheet workbook
- Extract: Contract Summary, Plant Return, Cost Report, Payments, Certificates
- Create upload endpoint + UI
- Test with all 9 Akwa Ibom weekly reports

### Phase 3 — Project Dashboard (Week 3-4)
- New `/projects/[id]/dashboard` page with 6 KPI cards
- Charts: BEME progress %, payment timeline, cost trends, plant utilization
- Latest report summary
- Weeks remaining vs schedule

### Phase 4 — Detail Tabs (Week 4-5)
- Certificates tab
- Payments tab
- BEME progress tab
- Plant utilization tab (with link to plant detail)
- Cost breakdown tab
- Labour strength tab
- Subcontractors tab
- Materials inventory tab

### Phase 5 — Documents & Polish (Week 5-6)
- Document upload (PDF award letters, completion certs)
- Project notifications (overdue milestones, new reports uploaded)
- Plant↔Project allocation rollup (for plant detail page)
- Spare parts → project cost rollup

### Phase 6 — Testing & Production (Week 6-7)
- Unit tests for new ETL parsers
- Integration tests for new endpoints
- E2E test for full upload → dashboard flow
- Deploy to production

---

## 6. CRITICAL DESIGN DECISIONS NEEDED FROM YOU

Before I start implementing, I need answers to these:

### Q1: Plant ↔ Project link strategy
**Option A:** Plants are assigned to a project (1:N relationship). One project at a time.
**Option B:** Plants are tracked per-week per-project via the Plant Return sheet (M:N over time).
**Recommendation:** Option B — matches reality. A plant can move between projects, and the weekly Plant Return sheet IS the source of truth.

### Q2: Project weekly report uploads
- Who can upload? Admin only, or also management?
- Should there be validation that the report's project name matches the selected project?
- Should we allow re-uploading (overwrite previous data for that week)?

### Q3: Award letter PDFs
- Do you want to upload original PDFs and link them to project records?
- One PDF per project, or multiple documents (award letter + completion cert + addendums)?

### Q4: Project status auto-update
- Should project status auto-update from weekly reports? (e.g., if BEME 100% → status = "completed")
- Or stay manually controlled?

### Q5: Cross-project queries
- Do you need queries like "all plants currently working on Akwa Ibom project"?
- "Total cost across all active projects"?
- "Top 5 projects by overdue amount"?

### Q6: Historical data (2017 award letters)
- Should historical projects (2017 archive) be in the same module, or separate "Legacy Archive"?
- They have very different data (no weekly reports for old projects)

### Q7: Subcontractor management
- Are subcontractors a separate entity (like suppliers)?
- Should we track subcontractor performance across projects?

### Q8: Frontend complexity
- The 16-sheet weekly report has a LOT of data. Should we show ALL of it, or focus on the most important (Cost, Certs, Payments, Plants)?
- Detail page tabs vs subroutes?

---

## 7. WHAT I'LL START WITH (Once You Approve)

Once you answer the questions above, I'll:

1. **Build a sample parser** for ONE weekly report (Week 2 Akwa Ibom) to confirm extraction works
2. **Create database migrations** for the new tables
3. **Create the project ETL worker** with the parser
4. **Create the upload endpoint + minimal UI**
5. **Test with all 9 weeks** of Akwa Ibom data
6. **Build the dashboard page** showing the extracted data
7. **Iterate** based on what we see

I won't write code until we agree on the architecture.

---

## 8. ARCHITECTURE PRINCIPLES (For This Module)

1. **Source of truth = the weekly reports.** projects table holds metadata, but operational data comes from reports.
2. **Idempotent ETL.** Re-uploading the same report should produce the same result, not duplicates.
3. **Each sheet → its own table.** Don't try to fit everything in one big table.
4. **Plants connect via fleet_number.** The Plant Return sheet is how projects link to the existing plants module.
5. **Aggregations in views.** Computed on-the-fly for accuracy, not denormalized.
6. **Documents in Supabase Storage.** Database stores only the path.
7. **Audit trail on everything.** Who uploaded what, when.
8. **Graceful degradation.** Bad row in one sheet doesn't fail the whole upload.
