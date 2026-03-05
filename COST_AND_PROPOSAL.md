# PW Central Reporting System
### Platform Overview & Investment Costs

**Prepared by:** Ajakghe Shedrack Emeka &nbsp;|&nbsp; **Date:** March 2026 &nbsp;|&nbsp; *Confidential*

---

P.W. Nigeria generates operational data every week across 27+ sites — plant conditions, equipment movements, maintenance costs, purchase orders. That data has always existed. What has never existed is a single place for it to live, be processed, and be queried.

The **PW Central Reporting System** is a custom-built, enterprise-grade platform that captures operational data from every site, cleans and validates it automatically, stores it permanently in one centralized database, and delivers real-time dashboards, analytics, and management reports — accessible from any device, anywhere. It is not a dashboard on top of spreadsheets. It is the complete data infrastructure P.W. Nigeria has needed.

The database is general-purpose. It currently manages fleet operations. It is ready to accommodate project management, fuel tracking, HR records, or any other operational domain when the company is ready — without rebuilding anything.

---

## Architecture

```
 Site Engineers ──► Web Form ──►                           ──► Dashboard
 Weekly Reports ──► Excel    ──►  ETL Engine → Central DB  ──► Reports
 Purchase Orders ──► Admin   ──►                           ──► Analytics
```

| Layer | Technology | Role |
|-------|-----------|------|
| **Database** | PostgreSQL (Supabase) | Central store — 20+ tables, permanent history, zero data loss |
| **Backend API** | Python / FastAPI | Business logic, data processing, authentication, analytics queries |
| **Frontend** | Next.js 16 / React 19 / TypeScript | Web application — management platform + site engineer portal |
| **Hosting** | Render (API) · Vercel (Frontend) · Cloudflare (CDN/SSL) | Always-on cloud infrastructure |
| **Auth** | JWT / Supabase Auth | Secure, role-based access — 3 access tiers |

---

## Development Tool & Expenses


This platform was built using **Claude Code by Anthropic** — an AI software engineering tool that operates as a senior-level development collaborator, enabling full-stack features to be delivered in days rather than weeks, with clean, well-structured, maintainable code throughout.

The following development tool costs were incurred entirely by the developer during the build:

| Date | Description | Amount |
|------|-------------|--------|
| Nov 4, 2025 | AI Tool — Subscription | $20.00 |
| Nov 6, 2025 | AI Tool — API Usage | $81.19 |
| Dec 19, 2025 | AI Tool — Subscription | $20.00 |
| Dec 29, 2025 | AI Tool — API Usage | $86.18 |
| Feb 12, 2026 | AI Tool — Subscription | $20.00 |
| Feb 13, 2026 | AI Tool — API Usage | $80.89 |
| **Total** | | **$308.26** |

*Original invoices available on request. Going forward, any continued feature development requires this tool at $100/month — billed as part of active development work.*

---

## Platform Features

**Fleet & Plant Management**
- Live fleet dashboard — condition breakdown (Working / Standby / Breakdown / Missing / Scrap), site utilization rates, recent events; updated in real time
- Equipment registry — instant search across 1,600+ plants; full per-plant detail: current location, movement history, lifetime maintenance cost, weekly usage records
- Transfer tracking — every equipment movement between sites formally logged with audit trail; automatic movement detection via ETL

**Data Ingestion & Field Reporting**
- Automated ETL pipeline — processes weekly Excel uploads from 30+ sites; normalizes fleet numbers, validates data, detects movements, flags anomalies automatically
- Site engineer portal — purpose-built mobile web form for direct weekly data entry; auto-save drafts that survive logout; new plant registration from site; real-time submission status visible to management
- Transfer management — site engineers request, approve, or reject equipment transfers through a formal documented workflow, replacing phone calls and WhatsApp

**Cost Intelligence**
- Spare parts & purchase orders — full PO lifecycle, itemized costs per part, plant, site, and supplier
- Supplier benchmarking — total spend per supplier, price history, negotiation intelligence
- Cost analytics — maintenance spend by month, quarter, year; per-plant lifetime costs; repair-vs-replace analysis

**Analytics & Reporting**
- Management reports — fleet summary, verification compliance, cost trends, year-on-year comparison; generated in seconds
- Automated fleet intelligence — idle equipment pools, escalating plant costs, underperforming sites, missing equipment; surfaced automatically without manual analysis
- Excel export — every report and data table downloadable for offline distribution or board presentations

**Security & Access**
- 3 access roles: Admin (full control) · Management (read + reports) · Site Engineer (own site only)
- Role enforcement at both API and frontend level — engineers cannot access management data even by calling the API directly
- Complete audit log — every login, data change, and report access is timestamped and attributed

**Documentation, User Guides & Institutional Continuity**
- Full technical documentation — database schema, API reference, deployment guide
- Role-specific user guides — HQ admin, management, and site engineer manuals
- P.W. Nigeria owns the source code — any qualified developer can maintain or extend it; the platform is not dependent on any single person

---

## Platform Setup Fee — $2,500

*Five months of development. $308.26 in documented tooling costs. 50% on agreement · 50% on go-live.*

| Component | What It Includes | Cost |
|-----------|-----------------|------|
| **Centralized Database** | Schema design for 20+ tables, 4+ analytical views, 10+ database functions; permanent data storage architecture; extensible for any future data domain | $400 |
| **Automated ETL Pipeline** | Excel ingestion engine, fleet number normalization, data validation rules, movement detection, anomaly flagging, event classification (new / missing / returned / transferred) | $350 |
| **Backend API** | 50+ REST API endpoints, JWT authentication, 4-tier role-based access enforcement, file storage integration, background ETL workers, analytics query layer | $300 |
| **Management & Admin Application** | 11 modules · 50+ pages & components: fleet dashboard, plant registry, spare parts, PO management, supplier analytics, cost reports, transfers, insights engine, audit log, notifications, user management | $350 |
| **Site Engineer Portal** | 4 modules · 15+ pages: weekly report form with auto-save drafts, new plant registration, push/pull transfer management, submission history, branded Excel export | $400 |
| **Analytics & Intelligence Engine** | Management reports (fleet summary, compliance, cost analysis, trends), automated insight generation, year-on-year comparisons, Excel export for all data | $300 |
| **Security, Auth & Audit System** | JWT auth with auto-expiry, role enforcement at API + frontend routing level, complete tamper-evident audit log, encrypted data in transit and at rest | $150 |
| **Deployment, QA & Documentation** | Production deployment configuration, environment setup, end-to-end testing, technical documentation, user guides per role | $100 |
| **Extensible Architecture** | Modular design enabling new domains (project management, fuel, HR, finance) to be added to the same database and platform without rebuilding infrastructure | $150 |
| **Total** | | **$2,500** |

> At ₦1,400/$: **$2,500 = ₦3,500,000**

---

## Monthly Infrastructure Costs

*Actual provider charges — passed through at cost, no markup. Verifiable via provider invoices.*

| Service | Provider | USD/Month | NGN/Month |
|---------|----------|-----------|-----------|
| Database + Auth + Storage | Supabase Pro | $25.00 | ₦35,000 |
| Backend API (always-on) | Render | $20.00 | ₦28,000 |
| Frontend (global CDN) | Vercel Pro | $20.00 | ₦28,000 |
| DNS + CDN + SSL | Cloudflare | $0.00 | ₦0 |
| **Total Monthly** | | **$65.00** | **₦91,000** |
| **Total Annual (monthly services)** | | **$780.00** | **₦1,092,000** |

**Domain — `pwcrs.com`:** $11.28/year = ₦15,792/year *(billed annually by Namecheap)*

---

## Maintenance & Future Development

### Annual Maintenance — $1,000/year
Covers bug fixes, security updates, performance monitoring, hosting management, and minor enhancements within existing plant/fleet modules.

### New Features — Existing Scope
Features within the current plant and fleet domain (new report types, analytics views, workflow additions):

| Size | Examples | Cost |
|------|---------|------|
| Small | New dashboard metric, report filter, export format | $80 – $150 |
| Medium | New analytics report, notification rule, data workflow | $200 – $400 |
| Large | New operational workflow within an existing module | $400 – $700 |

*Each feature scoped and confirmed before work begins.*

### New Module Development (e.g., Project Management)
Any entirely new operational domain requires a separate scoped engagement:
**Process:** Discovery → Feature definition → Fixed-price quote → Development
**Estimated range:** $600 – $2,000 depending on scope and complexity

---

## Return on Investment

| Before | After |
|--------|-------|
| "Where is plant PW-XXX?" → hours of phone calls | **Answer in under 5 seconds** |
| Weekly report compilation → 20–30 hrs/week manual | **Automated — minutes to review** |
| Equipment movements → untracked, lost in phone calls | **35 detected automatically from 6 sites alone** |
| Missing equipment → unknown | **145 plants flagged for audit** |
| Idle equipment → invisible | **304 standby plants identified for redeployment** |
| Maintenance costs → scattered paper records | **Full cost analytics per plant, site, supplier** |
| Supplier pricing → no comparison possible | **Complete spend history per supplier** |

**P.W. Nigeria's active portfolio: ~₦200 billion.**
**Year 1 total investment: ~₦6 million — 0.003% of that portfolio.**

A 1% improvement in equipment utilization through the redeployment intelligence this platform provides is worth multiples of the entire cost of this system. The 304 standby plants and 145 unaccounted assets identified in the first 6 sites alone represent a redeployment and asset recovery opportunity worth tens of millions of naira.

---

| Summary | USD | NGN |
|---------|-----|-----|
| Platform Setup (one-time) | $2,500 | ₦3,500,000 |
| Domain — `pwcrs.com` (annual) | $11.28/yr | ₦15,792/yr |
| Infrastructure (monthly × 12) | $780/yr | ₦1,092,000/yr |
| Annual Maintenance | $1,000/yr | ₦1,400,000/yr |
| **Year 1 Total** | **~$4,291** | **~₦6,007,792** |
| **Year 2+ (recurring only)** | **~$1,791/yr** | **~₦2,507,792/yr** |

---

*Confidential — P.W. Nigeria Limited management only.*
*USD converted at ₦1,400/$. Original invoices available on request.*

**Ajakghe Shedrack Emeka · 09162225610 · ajakgheshedrack@gmail.com**
