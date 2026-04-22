# PRD: Projects Module v2 — Operational Project Tracking

| Field | Value |
|---|---|
| **Document Status** | DRAFT — awaiting review |
| **Author** | Ram + Claude |
| **Date** | 2026-04-08 |
| **Version** | 0.1 |
| **Reviewers** | (to be assigned) |
| **Approval Required From** | Product Owner (Ram) |

---

## 1. Problem Statement

P.W. Nigeria's project teams produce a detailed 16-sheet weekly progress report for every active construction project, capturing physical progress (BEME), financial position (certificates, payments, retention), plant utilization, diesel consumption, labour, subcontractors, and materials. Today, **none of this data lives in the system** — it stays trapped in Excel files, manually emailed between site engineers, project managers, and head office.

As a result:
- **Management cannot see real-time project health.** They wait for monthly summaries and rely on phone calls.
- **Plants and projects are disconnected.** We can see a plant's location, but not which project it's working on or how many hours it has billed to that project.
- **Project costs are invisible.** No one can answer "how much has Project X cost so far?" without opening Excel files.
- **Historical analysis is impossible.** Comparing weeks, projects, or fleet performance requires manual aggregation.
- **Award letter parsing exists** but only captures static metadata, not the operational reality.

The current Projects module is a **registry** — it stores a list of projects with contract values and certificate counts. It is NOT a project management tool.

---

## 2. Goals (What "Done" Looks Like)

### 2.1 Primary Goals
1. **Single source of truth for project operations.** All weekly progress data lives in the system, structured and queryable.
2. **Plant ↔ Project visibility.** Anyone can see which plants are/were working on which project, for how many hours, at what cost.
3. **Real-time financial position.** Live view of contract value, works certified, payments received, outstanding balance, and retention.
4. **BEME progress tracking.** Visual dashboard showing physical % complete vs financial % complete vs schedule.
5. **Cost rollup by category.** Plant, fuel, materials, subcontractors, labour, overheads — all aggregated per project per week.

### 2.2 Success Metrics

| Metric | Baseline | Target | How Measured |
|---|---|---|---|
| Weekly reports uploaded per project | 0 (manual) | ≥1/week for active projects | Count of `project_weekly_reports` records |
| Time to view current project status | ~30min (Excel) | <30sec (dashboard) | Manual user testing |
| Plants linked to projects | 0% | 100% of plants on active projects | `project_plant_utilization` count |
| Project cost queries answered without Excel | 0% | 100% | User feedback survey |
| ETL upload success rate | N/A | ≥95% (with graceful failure on bad rows) | `submissions.status` |
| End-to-end upload time | N/A | <30s for a typical 16-sheet report | Server-side timing |

### 2.3 Non-Goals (Out of Scope for v1)
- ❌ Replacing the Excel template itself (users keep using their existing templates)
- ❌ Real-time collaborative editing of weekly reports inside the app
- ❌ Building a separate mobile app (responsive web only)
- ❌ Project planning / Gantt chart from scratch
- ❌ Inventory procurement workflow (only inventory tracking)
- ❌ Subcontractor invoicing system
- ❌ Time-clock / attendance system
- ❌ Document approval workflows
- ❌ Customer-facing project portal
- ❌ Integration with external accounting software (QuickBooks, etc.)
- ❌ Predictive analytics / ML forecasting

---

## 3. User Personas

### 3.1 Bashir — Site Engineer (Akwa Ibom Airport)
- **Role:** site_engineer
- **Tech comfort:** Medium. Uses Excel daily.
- **Goals:** Finish weekly report by Friday, send to head office, move on.
- **Pain points:** Re-types data into multiple formats. Has no way to know if his report was received or had issues.
- **What he needs:** Drag-and-drop upload, immediate confirmation, ability to see his uploaded reports.

### 3.2 Engr. Adebayo — Project Manager (Head Office)
- **Role:** management
- **Tech comfort:** Medium-high. Comfortable with dashboards.
- **Goals:** Understand which projects are on/off track. Identify cost overruns early. Report to leadership.
- **Pain points:** Spends Mondays gathering data from Friday weekly reports. No way to compare projects.
- **What he needs:** Cross-project dashboard, alerts on overdue milestones, ability to drill into any project's financials.

### 3.3 Mrs. Okonkwo — Finance Officer
- **Role:** management (with finance focus)
- **Tech comfort:** High for finance tools, medium for general apps.
- **Goals:** Track which certificates have been submitted, vetted, paid. Calculate outstanding balances.
- **Pain points:** Reconciles certificate records manually with bank statements.
- **What she needs:** Clear payments log, certificate-to-payment matching, outstanding balance per project.

### 3.4 Mr. Nwankwo — Plant/Equipment Manager
- **Role:** management
- **Tech comfort:** Medium.
- **Goals:** Maximize plant utilization, minimize idle time, allocate plants to where they're needed.
- **Pain points:** Doesn't know how much each plant earns per week or which projects use it most.
- **What he needs:** Plant utilization view per project, hours-billed report, idle plant alerts.2

### 3.5 Chuks — Admin (System Administrator)
- **Role:** admin
- **Tech comfort:** High.
- **Goals:** Keep the system running, troubleshoot upload failures, manage users.
- **Pain points:** No visibility into ETL failures.
- **What he needs:** Submission status logs, error details, ability to retry failed uploads.

---

## 4. User Stories

### Epic 1: Upload & Process Weekly Reports
- **US-1.1:** As a Site Engineer, I want to upload my project's weekly report Excel file via drag-and-drop, so I don't have to email it.
- **US-1.2:** As a Site Engineer, I want to see immediate validation (file accepted / rejected with reason), so I know if my upload worked.
- **US-1.3:** As a Site Engineer, I want to see a list of all weekly reports I've uploaded for my project, with status, so I can track what's been processed.
- **US-1.4:** As an Admin, I want to see all upload attempts across all projects with status and error details, so I can troubleshoot failures.
- **US-1.5:** As an Admin, I want to retry a failed upload without re-uploading the file, so I can recover from transient errors.
- **US-1.6:** As any user, I want re-uploading the same week to overwrite previous data (with confirmation), so corrections are easy.

### Epic 2: Project Operational Dashboard
- **US-2.1:** As a Project Manager, I want to see a dashboard for each project showing: contract value, % physical complete, % financial complete, weeks on site, last report date, top cost categories.
- **US-2.2:** As a Project Manager, I want to see a chart of weekly cost trends over time, so I can spot anomalies.
- **US-2.3:** As a Project Manager, I want to see overdue milestones (e.g., past expected completion date) flagged in red.
- **US-2.4:** As a Project Manager, I want to filter projects by status (active/completed/on hold/cancelled) and see aggregated metrics.

### Epic 3: Financial Tracking
- **US-3.1:** As a Finance Officer, I want to see all certificates submitted for a project, with cert number, date, gross/net values, and status (submitted/vetted/paid).
- **US-3.2:** As a Finance Officer, I want to see all payments received for a project, with date, voucher number, gross, deductions (WHT/VAT/vetting/stamp), and net.
- **US-3.3:** As a Finance Officer, I want to see the outstanding balance (cert value submitted minus payments received) per project.
- **US-3.4:** As a Finance Officer, I want to export the payments log to Excel for reconciliation.

### Epic 4: Plant ↔ Project Link
- **US-4.1:** As a Plant Manager, I want to see all plants currently working on a specific project, with hours worked, breakdown hours, and plant cost.
- **US-4.2:** As a Plant Manager, I want to see for each plant: which projects it has worked on (over time), with total hours per project.
- **US-4.3:** As a Plant Manager, I want to see total diesel consumption per project per week.
- **US-4.4:** As any user, viewing a plant detail page, I want to see "Currently working on: Akwa Ibom Airport (Week 10, 50 hours this week)".

### Epic 5: Cost Breakdown
- **US-5.1:** As a Project Manager, I want to see this-week vs to-date totals for each cost category (Plant, AGO, Materials, Subcontractors, Labour, Overheads, Site Level Expenses, Bill 1).
- **US-5.2:** As a Project Manager, I want to see a stacked area chart of cost categories over time.
- **US-5.3:** As a Project Manager, I want to compare planned (BEME) vs actual costs.

### Epic 6: BEME Progress Tracking
- **US-6.1:** As a Project Manager, I want to see all BEME line items with their contract qty, completed qty, % complete, sorted by % complete ascending (worst first).
- **US-6.2:** As a Project Manager, I want to see a single "% Project Complete" number for the whole project.
- **US-6.3:** As a Project Manager, I want to see which BEME items had progress this week vs none.

### Epic 7: Subcontractors, Labour, Materials
- **US-7.1:** As a Project Manager, I want to see all subcontractors on this project, what they're doing, qty executed, and amount paid.
- **US-7.2:** As a Project Manager, I want to see labour strength per department, comparing this week vs last week.
- **US-7.3:** As a Project Manager, I want to see materials inventory: opening stock → received → used → closing stock per item per week.
- **US-7.4:** As a Project Manager, I want to see hired vehicles for the week with rates and amounts.

### Epic 8: Document Storage
- **US-8.1:** As an Admin, I want to upload PDF documents (award letter, completion certificates, etc.) and link them to projects.
- **US-8.2:** As any user, I want to download project documents from the project detail page.

### Epic 9: Notifications & Alerts
- **US-9.1:** As an Admin, I want to be notified when a weekly report fails to process.
- **US-9.2:** As a Project Manager, I want to be notified when a project's weekly report has been uploaded.
- **US-9.3:** As a Project Manager, I want to be notified when a project becomes overdue (past revised completion date).

---

## 5. Scope

### 5.1 In Scope (v1)
- Database tables for: project_weekly_reports, project_plant_utilization, project_diesel_consumption, project_certificates, project_payments, project_cost_report, project_subcontractors, project_labour_strength, project_materials_stock, project_hired_vehicles, project_documents
- ETL parser for the 16-sheet weekly report workbook (Akwa Ibom format as reference)
- Backend endpoints (~15 new) for upload, list, detail, and the operational tabs
- Frontend pages: project dashboard, weekly reports list, financial tab, plant utilization tab, cost breakdown tab
- Document upload (PDF only) for project award letters and certificates
- Notifications for upload success/failure
- Plant detail page enhancement: show current project link
- Migration scripts for new tables

### 5.2 Explicitly Out of Scope (v1)
- BEME line item tracking (we'll add in v2 once core works)
- Subcontractor master entity (just text in v1, separate entity in v2)
- Materials master catalog (just text in v1)
- Project planning / Gantt charts
- Document version control
- Document OCR / auto-extraction
- Multi-project rollup queries (only single-project view in v1)
- Mobile-optimized layouts (responsive only, no native app)
- AI insights / predictions
- Email/SMS notifications (in-app only)
- Custom dashboards / report builder
- Data export beyond Excel
- Multi-currency support (NGN only)
- Multi-language support
- Public project pages

---

## 6. Dependencies & Risks

### 6.1 Dependencies
| Item | Why | Status |
|---|---|---|
| Existing plants_master + fleet_number normalization | Plant utilization links via fleet number | ✅ Working |
| Supabase Storage bucket for documents | PDF uploads need somewhere to live | ⏳ Need to create |
| asyncpg pool stability | All queries depend on it | ✅ Working (auto-recovery added) |
| Existing auth + role system | Site engineers need to upload to their project only | ✅ Working |
| Existing notification system | For upload success/failure alerts | ✅ Working |
| Excel parsing libraries (openpyxl, pandas) | Already in requirements | ✅ Working |
| Sample weekly reports for testing | Need real data to validate parser | ✅ Have 9 weeks of Akwa Ibom |

### 6.2 Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Different projects have different Excel formats | High | High | Build parser around Akwa Ibom format first, document assumptions, gracefully handle missing sheets |
| Plant fleet numbers in reports don't match plants_master | Medium | Medium | Use existing normalization, log unresolved fleet numbers, allow manual mapping |
| BEME sheet has 364×202 cells — could be slow to parse | Low | Medium | Skip BEME details in v1, parse only summary |
| Re-uploads cause data duplication | Medium | High | Idempotent upserts, transaction wrapping |
| Excel formulas evaluate to #VALUE! / #REF! | High | Low | Filter out error cells, use `data_only=True` |
| Sheet names vary slightly between weeks | Medium | Medium | Fuzzy match sheet names, log warnings |
| Permission scope: site engineers shouldn't see other projects | Medium | High | RLS policies + endpoint-level role checks |
| 16-sheet parsing is slow → blocks user | Medium | Medium | Background job + status polling |
| ETL crashes mid-file → partial data | Medium | High | Wrap in transaction, rollback on failure |
| Storage costs grow with PDF uploads | Low | Low | Free tier covers 1GB, monitor usage |

---

## 7. Open Questions for Decision Makers

These need answers before we move to Design:

| # | Question | Default Recommendation |
|---|---|---|
| Q1 | Plant ↔ Project link: M:N over time (per week) or 1:1 current? | **M:N over time** (matches reality) |
| Q2 | Who can upload project weekly reports? | **Admin + Management** (site engineers v2) |
| Q3 | Should re-upload overwrite previous data? | **Yes, with confirmation modal** |
| Q4 | Award letter PDFs: one per project or multiple documents? | **Multiple** (`project_documents` table) |
| Q5 | Project status auto-update from BEME %? | **No, manual control** (suggest in UI) |
| Q6 | BEME line items: parse in v1 or v2? | **v2** (just summary in v1) |
| Q7 | Subcontractor entity (like suppliers)? | **v2** (just text in v1) |
| Q8 | Historical 2017 award letters: same module or separate? | **Same module, marked is_legacy** |
| Q9 | Cross-project queries: needed in v1? | **No** (single-project view only) |
| Q10 | Excel template variations: support multiple or enforce one? | **One** (Akwa Ibom format), document it |
| Q11 | What to do if plant fleet number is unrecognized? | **Log warning, store raw, allow manual link later** |
| Q12 | Notifications channel: in-app only or also email? | **In-app only** (v2 for email) |

---

## 8. Timeline (Rough)

> These are estimates, not commitments. Each phase ends with a working demo.

| Phase | Duration | Deliverable |
|---|---|---|
| **Phase 0: PRD review & approval** | 1-2 days | This document signed off |
| **Phase 1: Architecture & Design** | 3-5 days | C4 diagrams, ERD, API spec, wireframes for 3 main pages |
| **Phase 2: Database migrations** | 1 day | All new tables + views created in dev DB |
| **Phase 3: ETL parser (single sheet at a time)** | 5-7 days | Parser handles Plant Return, Cost Report, Certificates, Payments, Contract Summary |
| **Phase 4: Upload endpoint + minimal UI** | 2 days | Drag-and-drop upload, status feedback, list of reports |
| **Phase 5: Project dashboard page** | 3 days | KPI cards + 2-3 charts |
| **Phase 6: Detail tabs (Finance, Plants, Costs)** | 4-5 days | All Epic 3, 4, 5 user stories |
| **Phase 7: Documents + notifications** | 2 days | PDF upload + alerts |
| **Phase 8: Testing** | 3-4 days | Unit tests for parser, integration tests for endpoints, E2E for upload→dashboard |
| **Phase 9: Staged rollout to 1 user (you)** | 1 week | Real usage with all 9 Akwa Ibom reports, iterate on feedback |
| **Phase 10: GA + monitoring** | Ongoing | Watch metrics, fix bugs |

**Total estimate: ~5-6 weeks of focused work** for v1 (with current scope).

---

## 9. Success Criteria for Approval

The PRD is approved when:
1. ✅ All 12 open questions answered
2. ✅ Personas validated (these match real users)
3. ✅ Goals & metrics agreed
4. ✅ Out-of-scope items confirmed
5. ✅ Risks acknowledged with mitigations accepted
6. ✅ Timeline accepted as a rough order of magnitude

---

## 10. Next Steps

1. **You review this PRD** and answer the 12 open questions (or any others that come up)
2. **We discuss any disagreements** and update this doc
3. **Sign off** — mark this PRD as APPROVED
4. **Move to Stage 3 (Design)** — I'll write a separate Design document with:
   - C4 architecture diagrams (System → Container → Component)
   - Entity Relationship Diagram (ERD) for the new tables
   - OpenAPI spec for new endpoints
   - Wireframes for the 3 most important pages
5. **Review Design**, then move to Stage 4 (Engineering) — sprints, code reviews, CI/CD

**No code will be written until Stage 4.**

---

## Appendix A: Reference Files

- **Sample weekly reports:** `project files/uyoweeklyreport2026/Week {2-10} Weekly Progress Report-Akwa Ibom Airport 2026.xlsx`
- **Award letters workbook:** `project files/Copy of Award letters Completion Certs.2017 (1).xlsx`
- **Historical site output:** `project files/Individual site output January - October.xlsx`
- **Existing strategy doc:** `docs/PROJECTS_MODULE_STRATEGY.md`
- **System audit:** `docs/SYSTEM_AUDIT_2026_03_31.md`
