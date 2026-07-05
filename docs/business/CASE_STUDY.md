# Case Study: Fleet Operations Intelligence Platform
## Transforming Equipment Management for a 1,600+ Asset Construction Company

---

## The Client

**P.W. Nigeria Limited** — a major Nigerian construction and civil engineering firm operating across 27 active project sites nationwide. The company manages a fleet of **1,615 pieces of heavy equipment and plant machinery** including excavators, dozers, trucks, generators, welders, and support equipment, with a project portfolio valued at **N466 billion**.

---

## The Problem

### Data Chaos at Scale

P.W. Nigeria's fleet operations ran on a patchwork of manual processes:

- **27 site officers** submitted weekly equipment reports via Excel — each in slightly different formats, with inconsistent naming conventions, and varying levels of completeness
- **No central system** existed to consolidate fleet data. Equipment status was tracked through phone calls, WhatsApp messages, and stacks of spreadsheets saved across individual computers
- **Management questions** like "How many plants are working across all sites?" or "Where is excavator PW-1234?" required **days of manual compilation** — calling sites, opening files, cross-referencing data
- **Equipment movements** between sites went untracked. Plants were transferred from one project to another with no digital record — only informal communication
- **Maintenance costs** were recorded on paper purchase orders with no systematic way to analyze spend by plant, site, or supplier
- **Missing equipment** was unknown. With 1,600+ assets spread across 27 locations and no verification system, the company had no reliable count of what it actually had and where

### The Business Impact

- **Decision-making paralysis:** Management couldn't access basic operational data without waiting days
- **Asset invisibility:** No real-time view of fleet condition, location, or utilization
- **Cost blindness:** No way to identify which equipment was costing the most to maintain, which suppliers were overcharging, or which sites were overspending
- **Lost equipment:** No mechanism to detect when plants went missing or were moved without authorization
- **Wasted capacity:** Idle equipment at some sites while other sites potentially hired externally — but no data to prove or quantify it

---

## The Approach

### Build the Complete Data Pipeline — Not Just a Dashboard

The standard approach would be to connect Power BI to the existing Excel files and build visualizations. But that would only address the last mile — displaying data. The real problem was everything upstream: **collection, cleaning, validation, storage, tracking, and analysis.**

I built a **full-stack data analytics platform** — handling the entire data lifecycle:

### 1. Automated Data Ingestion (ETL Pipeline)

Built a background processing engine that:
- Accepts weekly Excel uploads from site officers via a web portal
- **Automatically extracts** plant records from varied spreadsheet formats
- **Normalizes fleet numbers** (handles inconsistent naming: "PW-1234", "PW 1234", "PW1234" → standardized format)
- **Parses condition codes, hours worked, and officer remarks** using custom parsing rules
- **Validates data** and flags errors before they enter the system
- **Detects equipment movements** by comparing each plant's reported location against its previous known location
- Processes **1,353+ records from 957 unique plants** across initial uploads from 6 sites

### 2. Persistent Operational Database

Designed a PostgreSQL database (via Supabase) that maintains:
- **Complete equipment registry** — every plant with its current condition, location, fleet type, and full history
- **Cumulative weekly records** — every weekly snapshot preserved, building a growing operational timeline
- **Movement history** — every transfer between sites logged with timestamps and audit trail
- **Event detection** — automated flags for movements (35 detected), returns (9), missing equipment (8), new equipment (7)
- **Project registry** — 218 projects with contract values, milestones, timelines, and site linkages
- **614 spare parts records** for maintenance cost tracking

### 3. Analytics & Reporting Layer

Built a web-based analytics platform (FastAPI backend + Next.js frontend) providing:
- **Live dashboards** — fleet health, site status, recent events at a glance
- **Searchable plant registry** — find any equipment by fleet number, filter by condition/location/type
- **Site-level analytics** — per-site plant counts, condition breakdowns, utilization rates, submission history
- **Project tracking** — milestone timelines, contract values, site-project linkages
- **Role-based access** — Admin (full control), Management (read + reports), Site Officers (upload only)
- **40+ API endpoints** serving real-time data to the frontend

### 4. Insight Extraction

Didn't just build the tool — **used it to analyze the data and surface findings:**
- Identified that only **51% of the fleet is currently working** — nearly half is idle, broken, missing, or scrapped
- Discovered the **Abuja yard** holds 41% of all equipment (660 plants) but runs at only **15% utilization**
- Found **145 plants classified as "missing"** — 136 of them at Abuja alone
- Identified **304 plants on standby** across sites — a massive redeployment opportunity
- Found that **Dansadau Zamfara** has 40 plants with **0% utilization** — 39 sitting idle
- Contrasted against high-performing sites: Yola, Jalingo, Serti, Kayarda, and Abeokuta-Shagamu all running at **100% utilization**

---

## The Outcome

### From Days to Seconds

| Metric | Before | After |
|--------|--------|-------|
| Time to answer "Where is plant X?" | Hours (phone calls) | **Seconds** (search) |
| Time to compile weekly fleet summary | 20-30 hours/week (manual) | **Automated** (minutes to review) |
| Equipment movements tracked | 0 (untracked) | **35 detected automatically** from 6 sites |
| Missing equipment identified | Unknown | **145 plants flagged** |
| Utilization visibility | None | **Per-site utilization rates** for all 27 locations |
| Historical trend data | None (overwritten each week) | **Every weekly record preserved** permanently |
| Spare parts cost tracking | Paper/scattered files | **614 records** in searchable database |

### What Management Can Now Do

**In the first 13 report submissions from 6 sites**, the platform:

1. **Processed 1,353 plant records** automatically — no manual data entry
2. **Tracked 957 unique plants** with current condition and location
3. **Detected 35 equipment movements** between sites — previously invisible
4. **Flagged 8 newly missing plants** that disappeared between reporting periods
5. **Identified 7 new plants** entering the system for the first time
6. **Generated site-level utilization scores** revealing the massive gap between Abuja (15%) and top sites (100%)

### Reporting Time Reduction

**Estimated 70% reduction in reporting and data compilation time.**

- Manual weekly compilation across 27 sites: ~20-30 hours/week
- With automated ingestion and exception-based review: ~5-8 hours/week
- **Annual hours saved: ~800-1,000 hours** — redirected from data entry to analysis and decision-making

---

## Quantified Impact

### Direct Findings With Financial Implications

**1. The Abuja Idle Fleet — 561 non-working plants**

660 plants at Abuja. Only 99 working (15% utilization). The remaining 561 include:
- 213 on standby — potentially redeployable to active sites
- 136 missing — unaccounted assets requiring physical verification
- 72 scrap — candidates for disposal and salvage value recovery
- 57 under repair — maintenance pipeline visibility
- 37 faulty + 35 breakdown — repair-or-replace decisions needed

**If even 50 standby plants could be redeployed to active sites** instead of hiring externally, the cost avoidance could reach **tens of millions of naira annually** depending on equipment type (excavator hire alone runs N2-5M/month).

**2. The Missing Equipment Problem — 145 plants**

145 plants the company cannot currently account for. At average replacement values of N5-50M per unit depending on type, this represents potentially **billions of naira in unverified assets**. Physical verification + proper classification is the first step to either recovering these assets or writing them off for accurate financial reporting.

**3. Fleet Rebalancing Opportunity — 304 standby plants**

304 plants sitting idle across sites while active projects may be hiring equipment externally. The platform enables matching idle capacity to demand — a rebalancing exercise that was previously impossible because no one had visibility across all 27 sites simultaneously.

**4. The Zero-Utilization Site — Dansadau**

40 plants, 0% working, 39 on standby. If this represents a completed or paused project, those 39 plants could be generating value elsewhere. Without the platform, this idle pocket was invisible to management.

### Operational Impact Summary

| Impact Area | Metric |
|-------------|--------|
| Reporting time reduction | ~70% (800-1,000 hours/year saved) |
| Fleet visibility | From 0% real-time to 100% digital tracking |
| Movement detection | From manual/none to automated (35 events from 6 sites) |
| Missing equipment identified | 145 plants flagged for verification |
| Idle capacity surfaced | 304 standby + 40 fully idle site |
| Decision speed | From days → seconds for standard queries |
| Historical data retained | From zero (overwritten weekly) to permanent cumulative record |

---

## Why This Approach — Not Power BI

A common question: "Why build a custom platform instead of using Power BI?"

**Power BI solves the last mile** — it visualizes data that already exists in clean, structured form. But P.W. Nigeria's challenge was everything before visualization:

| Challenge | Power BI | This Platform |
|-----------|----------|---------------|
| 27 sites submitting Excel in different formats | Manual cleaning required before each refresh | Automated parsing and normalization |
| Fleet numbers written inconsistently | Analyst fixes every time | Built-in normalization rules |
| Detecting equipment movements between sites | Not possible without custom scripting | Automatic cross-week comparison |
| Maintaining historical records over time | Each refresh replaces previous data | Every record stored permanently |
| Site officers need a simple upload portal | Requires SharePoint + Power Automate + configuration | Built-in web portal with token authentication |
| Role-based access for different user types | Power BI Pro licensing per user ($10/user/month) | Built-in, no per-user cost |
| Alerting on anomalies (missing plants, unauthorized transfers) | Requires Power Automate + custom logic | Built into the ETL pipeline |

**The platform replaces what would require: Power BI Pro + Power Automate + Azure SQL Database + SharePoint + custom Python scripts + a dedicated analyst to manage the pipeline — as a single, integrated system.**

---

## About the Analyst

I am a Full Stack Data Analyst — I don't just analyze data; I build the infrastructure that makes analysis possible.

For this engagement, I:
- **Designed the database schema** — 15+ tables optimized for construction fleet operations
- **Built the ETL pipeline** — automated ingestion, parsing, normalization, and movement detection
- **Developed 40+ API endpoints** — serving real-time data to dashboards and reports
- **Created 62+ frontend components** — the complete web application interface
- **Extracted the initial insights** — the utilization analysis, missing equipment findings, and rebalancing recommendations presented in this case study

The typical approach would require a team of three (database admin, backend developer, data analyst). I delivered all three functions, plus domain expertise gained from studying P.W. Nigeria's actual operational workflows, report formats, and business processes.

---

*This case study is based on live production data from the PW Fleet Operations Intelligence Platform. All numbers reflect actual database records as of February 2026.*
