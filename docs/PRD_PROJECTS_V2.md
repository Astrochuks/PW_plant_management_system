# PRD — Projects module v2

Status: DRAFT for user mark-up · 2026-10-11 · supersedes `PRD_PROJECTS_MODULE.md`
(v1.1/v2 of July) for everything below; the July arithmetic findings in
`WORKBOOK_ARITHMETIC.md` and `REDESIGN_01_CONTRACT_SUMS_AND_MARKUPS.md` remain
the evidence base.

## 0. One paragraph

Head office needs the same report from every site, every site has its own
bill of quantities, and the spreadsheets they send cannot be trusted for
anything but the current week. So: the **register** holds projects with a
dated history of contract sums and statuses; each project carries its own
**bills** (BEME) under approved revisions; the weekly input — upload now,
web form later — contributes **this week's quantities only**, matched to
our bills; everything else (to-date, %, VAT, provisions, quarter, year) is
**computed by the system** from those facts and the project's own
parameters. Every change to a sum, a status or a bill is proposed by one
person, approved by another, and kept forever.

Build order: **A. Register → B. Bills → C. Weekly facts → D. Reports/form.**
This PRD specifies A completely and B–D to the depth the data model needs.

---

## 1. Goals and non-goals

**Goals (v2.0 = phase A)**
- Register the 12 ongoing projects (and keep the 218 legacy ones) with
  contract-sum and status *history*, documents, and a team.
- Report "as at" any date: a project that finished in August is in the
  Q2 report and absent from today's ongoing list.
- Four roles, with the project manager seeing every site and able to
  focus on one, and the site engineer confined to their own project.
- Maker–checker approval with in-app notification for every change to a
  contract sum, a status or (phase B) a bill.
- A complete, queryable "who did what" trail.

**Non-goals (for now)**
- MD / GPM seats, email notifications, thresholds by amount.
- Parsing the other 15 sheets of the weekly workbook (costs, plant,
  diesel…) — they stay stored-only until phase D.
- Any automatic correction of a site's numbers. Mismatches are flags.
- AI anywhere in parsing (CLAUDE.md rule 8).

---

## 2. Roles (v2.0)

| Role (enum value) | Sees | Does |
|---|---|---|
| `admin` | everything | creates projects; proposes contract-sum / status / bill changes; uploads weeklies; manages users and assignments; approves what another admin or the PM proposed |
| `project_manager` | **all projects**, with a project picker ("All sites" default → one site) | approves proposals; reads every report, history and audit view; (phase D) comments on weekly submissions |
| `site_engineer` | **only** projects in `user_project_assignments` | reads their project's bills; (phase C/D) enters/uploads this week's quantities; sees their own activity |
| `plant_officer` | plant module only | unchanged |

Rules
- Maker ≠ checker on every approval. With one admin and one PM in the
  company today that works; if the PM proposes, an admin approves.
- `site_engineer` loses its plant duties: the `location_id` requirement
  on user creation, the one-engineer-per-location check, and the
  `(site)` route group are retired for this role (the plant weekly report
  stays an admin/plant-officer upload, as it is in practice today).
- `managing_director` and `general_project_manager` are **parked, not
  deleted** (Postgres enum values can't be dropped cheaply): hidden from
  the UI, and the two existing accounts are moved to `project_manager`
  by migration. `management` stays retired.
- Money visibility: contract sums, value-of-work and margins are visible
  to `admin` and `project_manager`. A `site_engineer` sees bills,
  quantities and % of their own project; **no contract sum, no margin**
  (user to confirm — §14 Q1).

---

## 3. Domain model

Append-only history tables + thin caches on `projects`. Nothing in this
section is ever `UPDATE`d or `DELETE`d except the cache columns, which
only triggers write.

### 3.1 `projects` (existing, 59 columns — trimmed in use, not dropped)
Identity and award facts stay here: `project_name, short_name, client_id,
state_id, location_id, project_type, work_nature, scope_quantity,
scope_unit, award_date, commencement_date, original_duration_months,
original_completion_date, revised_completion_date, is_legacy, notes,
created_by, updated_by`.
**Cache columns (trigger-maintained, read-only to the API):**
`current_contract_sum`, `current_status`, `current_status_since`,
`current_beme_revision_id`. The old free-text `status` column is renamed
`status_legacy` and frozen.

### 3.2 `project_contract_sums`
| column | type | notes |
|---|---|---|
| id | uuid | |
| project_id | uuid → projects | |
| kind | enum `original · variation · revision · correction` | |
| amount | numeric(18,2) | the **resulting** contract sum after this instrument (not the delta) |
| delta | numeric(18,2) | generated: amount − previous effective amount; 0 for `original` |
| basis | enum `all_in · ex_vat · unknown` | what the figure includes (Kaduna problem, §14 Q2) |
| effective_date | date | |
| instrument_ref | text | VO number, letter reference |
| document_path | text | Storage path, served via API only |
| note | text | |
| state | enum `pending · approved · rejected · superseded` | |
| proposed_by / proposed_at | uuid / timestamptz | |
| decided_by / decided_at / decision_note | uuid / timestamptz / text | |
Constraint: at most one `original` per project. "Current" = latest
approved by `effective_date`, then `decided_at`.

### 3.3 `project_status_events`
`id, project_id, status (enum), effective_date, note, state, proposed_by,
proposed_at, decided_by, decided_at, decision_note`.
Status enum: `awarded · mobilised · active · suspended ·
substantially_complete · finally_complete · closed`. Allowed transitions
in §4. "Status as at D" = latest approved event with `effective_date ≤ D`.

### 3.4 `project_documents` (existing table, reused)
Award letter, variation orders, completion certificates, revised BEMEs.
Add `kind` and `linked_table/linked_id` so a contract-sum row can point at
its instrument.

### 3.5 Team: `user_project_assignments` (existing, empty)
`user_id, project_id, role_on_project (site_engineer · project_manager ·
observer), created_by, created_at, ended_at`. Site engineers are scoped
by this table; the PM's "picker" is a UI preference, not a row.

### 3.6 Bills (phase B — structure fixed now)
- `project_beme_revisions`: `id, project_id, revision_no, source (award_beme
  · derived_from_weekly · variation · correction), effective_date,
  source_document_path, works_total (ours, Σ items), note, state,
  proposed_by/at, decided_by/at, decision_note`.
- `project_beme_bills` and `project_beme_items`: gain `revision_id`;
  existing rows become revision 1 of their project (`source =
  derived_from_weekly`).
- `project_beme_parameters` (one row per revision): ordered jsonb list of
  adders `{name, rate, base: works | after_provisions, kind: tax | levy ·
  provisional, accrues: bool}` + `vat_rate` default 0.075. Captured from
  the workbook ladder on import, **confirmed by a person**.
- A rate/item/bill edit = new revision copied from the previous with the
  edits, pending until approved. Weekly facts (3.7) store the
  `revision_id` they were matched against, so history never re-values.

### 3.7 Weekly facts (phase C — structure fixed now)
`project_week_items`: `project_id, item_id, revision_id, week_ending_date,
iso_year, iso_week, qty_this_week, amount_this_week (as reported),
amount_at_rate (generated: qty × rate), source (upload · form), source_ref
(weekly_report_id or form submission id), entered_by, entered_at`.
Unique on `(project_id, item_id, week_ending_date)`; re-upload of a week
replaces its rows inside one transaction and writes an audit entry.
**No cumulative column is ever stored.** `project_opening_positions`
(dated, per item, approved) is reserved for when the site supplies the
real to-date figure — not built in v2.0.

### 3.8 `audit_logs` (existing)
Every proposal, approval, rejection, assignment, upload and replacement
writes one row (`action`, `table_name`, `record_id`, `old_values`,
`new_values`, `description`). Already written by the plant and PO flows;
the projects API gets the same wrapper.

### 3.9 `notifications` (existing)
Targeted by `target_user_id` or `target_role`, with `action_url`. New
types: `approval_requested`, `approval_decided`, `assignment_changed`.
Delivered live over the existing SSE stream.

---

## 4. Status machine

```
awarded → mobilised → active ⇄ suspended
active → substantially_complete → finally_complete → closed
any    → closed            (with note; e.g. terminated)
```
Reports and lists:
- **Ongoing as at D** = status as at D ∈ {mobilised, active, suspended}.
- A period report (quarter/year) includes a project if it was ongoing on
  **any day** of the period.
- Legacy rows: a single approved `closed` event dated by their recorded
  completion date (or 2017-12-31 when unknown, flagged `is_legacy`).

---

## 5. Contract sums — rules

1. Entered with the project (`original`), then only by new rows.
2. Amount is the resulting sum, so the table reads like the PDF; delta is
   derived. Akwa: `original 10,621,359,979.09` → `variation
   14,621,359,979.09 (delta 4,000,000,000.00)`.
3. `basis` is mandatory. The register page shows "all-in" and "ex-VAT"
   sums in different columns, never mixed in one total.
4. The "ongoing projects" page = the PDF, regenerated: name, state,
   client, current contract sum (and basis), status since, BEME works
   total (phase B), last week received (phase C). Export to xlsx/pdf.
5. BEME total ≠ contract sum is **normal and displayed**: "Scope (BEME)
   24,447,532,051.47 · Contract 14,621,359,979.09 · Uncontracted scope
   9,826,172,072.38". Never reconciled away.

---

## 6. Approval workflow

State machine for every proposable row (contract sum, status event,
BEME revision, later: opening position):

```
pending ──approve──▶ approved (effective)      maker ≠ checker
   └────reject────▶ rejected (reason required) → maker may propose anew
approved ──(a later approved row of the same kind)──▶ superseded
```
- On `propose`: notification to role `project_manager` (or to `admin` when
  the PM is the maker) — title, one-line diff summary, link to the review
  screen. Reminder every 24 h while pending > 72 h; dashboard card
  "Awaiting your approval (n)".
- Review screen: old vs new side by side; attached document; for BEME
  revisions the item-level diff and the change in works total; for
  contract sums the resulting delta; **"if approved, these figures
  change"** preview.
- On decision: notification to the maker; audit row; caches recomputed by
  trigger.
- Pending rows affect nothing: lists, reports and exports read approved
  rows only.

---

## 7. Screens (phase A)

1. **Register** `/projects` — table: name · state · client · status (as
   at today) · current contract sum · basis · award date · last change.
   Filters: status, state, client; toggle "include closed". PM gets the
   **project picker** in the header (All sites / one site) that scopes
   every projects page; site engineers get no picker.
2. **New project** `/projects/new` (admin) — the five groups (§1 of the
   register design): identity, award, original contract sum (+ basis +
   document), initial status (default `awarded`), team.
3. **Project page** `/projects/[id]` — summary header (status chip with
   "since", contract sum with basis, scope when bills exist); tabs:
   **Overview · Bills (B) · Weeks (C) · Documents · Team · History ·
   Activity**. History = merged timeline of contract sums, statuses,
   revisions (who/when/state). Activity = `audit_logs` filtered.
4. **Propose change** dialogs — contract sum (kind, amount, basis,
   effective date, instrument, document, note); status (status, effective
   date, note). Submit → pending.
5. **Approvals** `/projects/approvals` (PM, admin) — pending list,
   review screen, approve/reject.
6. **Ongoing projects** `/projects/ongoing?asat=YYYY-MM-DD` — the PDF,
   live; export.
7. **Users & assignments** — existing admin pages: role list reduced to
   the four; site-engineer form loses `location_id`, gains "projects".

---

## 8. API (phase A)

```
GET    /projects?status=&state=&client=&as_at=&include_closed=
POST   /projects                                     admin
GET    /projects/{id}
GET    /projects/{id}/history                        merged timeline
GET    /projects/{id}/activity                       audit rows
POST   /projects/{id}/contract-sums                  propose
POST   /projects/{id}/status-events                  propose
GET    /projects/approvals?state=pending             PM, admin
POST   /projects/approvals/{kind}/{id}/approve       checker ≠ maker
POST   /projects/approvals/{kind}/{id}/reject        reason required
GET    /projects/ongoing?as_at=                      + ?format=xlsx|pdf
GET    /projects/{id}/documents/{doc_id}             streamed, role-checked
PUT    /users/{id}/projects                          admin: assignments
```
Every list endpoint for a `site_engineer` is filtered by assignment in SQL
(`WHERE p.id = ANY($assigned_ids)`), not in the client.

---

## 9. Migration plan (one migration per step, each reversible)

1. `031_roles_v3`: add enum value `project_manager`; `UPDATE users SET
   role='project_manager' WHERE role IN ('managing_director',
   'general_project_manager')`; drop the site-engineer location
   constraint/check; `lib/roles.ts` → four roles, parked ones recognised
   for reading only.
2. `032_project_history`: create `project_contract_sums`,
   `project_status_events`; add cache columns + triggers; rename
   `projects.status` → `status_legacy`.
3. `033_backfill_history`: for each project insert `original` contract
   sum from `original_contract_sum` (basis `unknown`, approved by
   `system`, note "backfilled from register 2026-10"), plus `variation`
   where `current_contract_sum` differs; status events: 3 active →
   `active` dated from first weekly report; 218 legacy → `closed`.
4. `034_assignments_audit`: extend `user_project_assignments` (created_by,
   ended_at); `project_documents.kind/linked_*`; notification types.
5. (phase B) `035_beme_revisions`: revisions table, `revision_id` on
   bills/items, backfill revision 1 per project, parameters table.
6. (phase C) `036_week_items`.

Each migration ships with its `down` and a `tests/test_migration_03x.py`
that asserts counts before/after (run with the user's go — DB-heavy).

---

## 10. Seed: the twelve ongoing projects

From `ONGOING Projects..pdf` (2026-10-11). Register rows to create (9) or
update (3); contract sums entered as `original` unless a document says
otherwise; `basis = all_in` except Kaduna (`unknown`, §14 Q2).

| # | Project | State | PDF sum | In register today |
|---|---|---|---|---|
| 1 | Old Airport Rd Jn–Rayfield–Bukuru dualization… | Plateau | 15,097,438,936.16 | no |
| 2 | Utonkon–Nunku & Keana links, 9-span Abbatoir flyover… | Plateau | 12,467,410,568.27 | no |
| 3 | 15-span 6th Bridge over River Kaduna | Kaduna | 3,976,872,460.00 | yes (active) |
| 4 | 16.5 km Kayarda–Lere road | Kaduna | 10,139,435,742.70 | no |
| 5 | 5.16 km Kwoi township roads | Kaduna | 4,067,429,359.99 | no — **reported finished** |
| 6 | Gwantu township roads | Kaduna | 6,450,187,669.96 | no |
| 7 | Apron, Victor Attah Int'l Airport | Akwa Ibom | 14,621,359,979.09 | yes (active, 10,621,359,979.09 + variation) |
| 8 | Maru–Lugga road + 2 bridges | Zamfara | 8,574,216,648.75 | yes (active, 8,026,475,684.00 on record) |
| 9 | Gusau–Magami–Dansadau Lot 2 | Zamfara | 44,376,645,376.25 | no |
| 10 | Gusau–Magami–Dansadau Lot 3 | Zamfara | 54,264,096,079.33 | no |
| 11 | Jebbu–Bassa–Binchin–Buyo road | Plateau | 25,604,174,700.93 | no |
| 12 | Kuba–Tenti–Manguna–Daffo road, 81 km | Plateau | 53,796,850,584.12 | no |

Entry is by hand through the New-project screen (admin), one per
document — not scripted — so each gets its instrument attached.

---

## 11. Acceptance tests (phase A)

Register & history
- A1 Creating a project writes exactly one `original` contract sum
  (pending), one `awarded` status (pending), one audit row each.
- A2 A pending contract sum changes nothing on `/projects` or
  `/projects/ongoing`; approving it updates `current_contract_sum`
  within the same transaction (trigger).
- A3 `GET /projects/ongoing?as_at=2026-06-30` lists Kwoi when Kwoi has
  `active` from 2025-xx and `finally_complete` from 2026-08-xx;
  `as_at=2026-10-11` does not.
- A4 Two contract sums with the same `effective_date`: the later
  `decided_at` wins; the earlier is `superseded`.
- A5 `history` returns contract sums, statuses and revisions merged,
  newest first, each with proposer, decider and state.
- A6 A `correction` row must carry a note and a decision by someone other
  than the proposer.

Approval
- B1 The proposer cannot approve their own row (403, audited).
- B2 Reject without a reason → 422.
- B3 Proposing creates one notification for `project_manager` (or
  `admin` when the PM proposes) with a working `action_url`; deciding
  creates one for the proposer.
- B4 A pending row older than 72 h produces a reminder notification at
  most once per 24 h.

Roles & scope
- C1 A `site_engineer` with no assignment sees an empty register and 403
  on any project id.
- C2 A `site_engineer` assigned to project X gets 404 (not 403) for
  project Y — existence is not leaked.
- C3 `project_manager` lists all projects; the picker narrows every
  projects endpoint via `?project_id=` and never grants more.
- C4 Creating a `site_engineer` no longer requires `location_id`;
  creating one with `managing_director` is rejected.
- C5 Document download for a project the caller may not see → 404.

Audit
- D1 Every mutating endpoint in §8 writes one `audit_logs` row with
  `old_values`/`new_values`; verified by a parametrised test over the
  route table.
- D2 `activity` for a project returns only that project's rows and is
  visible to admin, PM, and the assigned site engineer (own actions only).

Migration
- E1 After 031: no user has role `managing_director` /
  `general_project_manager`; `project_manager` count = 2.
- E2 After 033: every project has ≥ 1 approved contract sum and ≥ 1
  approved status event; `current_*` caches equal the computed values
  for all 221 rows.

---

## 12. Build order and milestones (phase A)

| # | Milestone | Done when |
|---|---|---|
| A-1 | Roles v3 (migration 031, `roles.ts`, user form, gates) | E1, C4 pass; existing users log in and land correctly |
| A-2 | History tables + caches + backfill (032–033) | E2; register page unchanged to the eye |
| A-3 | Propose/approve API + notifications + audit wrapper | A1–A6, B1–B4, D1 |
| A-4 | Screens: register, new project, project page (History, Activity, Documents, Team), approvals, ongoing-as-at + export | manual walkthrough with the 3 active projects |
| A-5 | Enter the 12 ongoing projects (user, by hand, from documents) | `/projects/ongoing` reproduces the PDF to the kobo |

Each milestone: one PR-sized commit set, change manifest, verify
commands, log phrases, tests — per the working protocol.

---

## 13. Phases B–D in one line each (for context)

- **B. Bills**: BEME import (xls/xlsx) → review screen → revision 1;
  parameters captured and confirmed; template export per project.
- **C. Weekly facts**: workbook upload → match to items → this-week
  rows only; sheet totals as cross-checks; convention fingerprint
  detected and verified per upload.
- **D. Reports & form**: period/as-at reports (week ÷ BEME, Σ weeks,
  adders per parameters); site-engineer web form for quantities;
  opening positions when sites supply them.

---

## 14. Open questions (answer before A-3)

1. Does a site engineer see **any** money (rates, contract sum) or only
   quantities and %?
2. Kaduna contract sum: 3,976,872,460.00 (`ex_vat`?) or
   4,617,148,926.06 (`all_in`)?
3. Kwoi: completion date and instrument, so its status history is real.
4. Should an admin be allowed to approve another admin's proposal, or
   must the PM approve everything in the register? (Default here: either
   PM or a *different* admin.)
5. Revised-sum documents for Maru–Lugga (8,574,216,648.75) and Akwa
   (+₦4,000,000,000.00) — needed to set `basis` and `instrument_ref`.
