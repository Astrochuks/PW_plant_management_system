# PW Plant Management System

A comprehensive plant and equipment management platform for tracking heavy machinery across multiple project sites. Built with **FastAPI** (Python) and **Next.js** (TypeScript), backed by **Supabase** (PostgreSQL).

## What It Does

This system replaces manual Excel-based tracking for a fleet of 2,000+ pieces of heavy equipment (excavators, dozers, loaders, cranes, dump trucks, etc.) spread across 27+ active project sites. Site officers submit weekly reports via Excel upload; the system automatically ingests, validates, and transforms the data into queryable records with full movement tracking, usage analytics, and cost management.

---

## Key Features

### Plant & Equipment Registry
- Master registry of all fleet equipment with fleet numbers, descriptions, make/model, and condition tracking
- 10 condition states: Working, Standby, Under Repair, Breakdown, Faulty, Missing, Scrap, Off Hire, GPM Assessment, Unverified
- Physical verification tracking from weekly reports
- Full location history and event timeline per plant
- Weekly usage records: hours worked, standby hours, breakdown hours

### Site Management
- Manage project sites (locations) with state/region grouping
- Per-site dashboards showing plant counts by condition, utilization rates, submission history, and costs
- Transfer tracking: inbound/outbound plant movements between sites
- Weekly report submission history with expandable drill-down to individual plant records

### Project Registry
- Full project lifecycle management with contract details, milestones, and financials
- **Award Letters Excel import** for bulk project creation from historical records
- **Legacy vs Active distinction**: imported historical projects are marked as legacy; new operational projects are active
- **Active / Legacy / All** toggle on the projects list for easy filtering
- **Milestone timeline**: visual timeline of 8 key project dates (award, commencement, completion, certifications, retention)
- **Duration visualization**: original contract duration vs extension of time bar chart
- **Site-Project linking**: 1:1 relationship between a site and its project, linkable from either side by admin
- Collapsible form sections, change tracking (blue dot indicators), auto-computed contract sums, and sticky save bar

### Spare Parts & Purchase Orders
- Track maintenance costs per plant with full PO management
- Purchase order creation with line items, suppliers, VAT, discounts, and overhead costs
- Direct vs shared cost classification (items shared across multiple plants)
- Per-submission PO batches with scoped document uploads
- Cost analytics per site, per plant, with distribution breakdowns

### Automated Data Ingestion (ETL)
- **Weekly Report Upload**: site officers upload Excel files via token-based authentication (no system account needed)
- **Background ETL processing**: extracts plant records, normalizes fleet numbers, parses hours/verification/remarks
- **Movement detection**: automatically detects when equipment appears at a different site than the previous week
- **Transfer resolution**: matches raw transfer remarks to known locations
- **Notifications**: admin gets notified of new submissions, movements, and anomalies

### Reports & Analytics
- Fleet summary reports with export capability
- Verification and compliance reports
- Maintenance cost reports by site/plant/period
- Usage trend analysis
- Unverified plant reports

### User Management & Security
- Role-based access: **Admin** (full CRUD) and **Management** (read-only)
- JWT authentication via Supabase Auth
- Token-based upload authentication for site officers
- Audit logging for administrative actions

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 16 (App Router), TypeScript, Tailwind CSS, shadcn/ui |
| **State Management** | TanStack Query (React Query) |
| **Backend API** | FastAPI (Python 3.11+) |
| **Database** | PostgreSQL via Supabase |
| **Authentication** | Supabase Auth (JWT) |
| **File Storage** | Supabase Storage |
| **Data Processing** | Pandas, openpyxl |

---

## Architecture

```
Frontend (Next.js)                    Backend (FastAPI)
┌──────────────────────┐             ┌──────────────────────────────┐
│  Dashboard           │             │  /api/v1/                    │
│  Plants CRUD         │   HTTP      │  ├── auth/    (login/users)  │
│  Sites/Locations     │ ──────────> │  ├── plants/  (registry)     │
│  Projects            │             │  ├── locations/ (sites)      │
│  Spare Parts & POs   │             │  ├── projects/ (contracts)   │
│  Uploads             │             │  ├── spare-parts/ (costs)    │
│  Reports             │             │  ├── suppliers/ (vendors)    │
│  Admin Panel         │             │  ├── uploads/  (ETL ingest)  │
└──────────────────────┘             │  ├── transfers/ (movements)  │
                                     │  ├── reports/  (analytics)   │
                                     │  └── admin/   (audit, users) │
                                     │                              │
                                     │  ETL Worker (background)     │
                                     │  ├── Weekly report parser    │
                                     │  ├── Movement detection      │
                                     │  └── Notification dispatch   │
                                     └──────────────┬───────────────┘
                                                    │
                                     ┌──────────────▼───────────────┐
                                     │  Supabase                    │
                                     │  ├── PostgreSQL (data)       │
                                     │  ├── Auth (JWT tokens)       │
                                     │  └── Storage (Excel files)   │
                                     └──────────────────────────────┘
```

---

## Project Structure

```
├── backend/
│   ├── app/
│   │   ├── api/v1/          # API route handlers
│   │   │   ├── auth.py      # Authentication endpoints
│   │   │   ├── plants.py    # Plant CRUD + analytics
│   │   │   ├── locations.py # Site management
│   │   │   ├── projects.py  # Project registry + milestones
│   │   │   ├── spare_parts.py  # Maintenance costs
│   │   │   ├── suppliers.py # Supplier management
│   │   │   ├── uploads.py   # File upload + token management
│   │   │   ├── transfers.py # Plant movement tracking
│   │   │   ├── reports.py   # Report generation
│   │   │   └── ...
│   │   ├── models/          # Pydantic request/response models
│   │   ├── services/        # Business logic (parsers, ETL helpers)
│   │   ├── workers/         # Background ETL processing
│   │   ├── core/            # Database pool, config
│   │   └── main.py          # FastAPI application entry
│   ├── docs/                # Backend documentation
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── app/(dashboard)/ # Next.js pages (App Router)
│   │   │   ├── page.tsx            # Dashboard home
│   │   │   ├── plants/             # Plant list, detail, create, edit
│   │   │   ├── locations/          # Site list, detail, create, edit
│   │   │   ├── projects/           # Project list, detail, create, edit
│   │   │   ├── spare-parts/        # Spare parts, PO management
│   │   │   ├── suppliers/          # Supplier list and detail
│   │   │   ├── uploads/            # Upload portal, submission history
│   │   │   ├── transfers/          # Transfer queue
│   │   │   ├── reports/            # Report pages
│   │   │   ├── admin/              # User management, audit logs, states
│   │   │   └── ...
│   │   ├── components/      # Reusable UI components
│   │   │   ├── ui/          # shadcn/ui base components
│   │   │   ├── plants/      # Plant-specific components
│   │   │   ├── projects/    # Project-specific components
│   │   │   ├── locations/   # Location-specific components
│   │   │   ├── admin/       # Admin panel components
│   │   │   └── layout/      # Sidebar, header
│   │   ├── hooks/           # React Query hooks (data fetching)
│   │   ├── lib/api/         # API client functions
│   │   └── providers/       # Auth provider, theme
│   └── package.json
│
├── docs/
│   └── ARCHITECTURE.md      # System architecture blueprint
└── README.md
```

---

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+
- A Supabase project (free tier works)

### Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # macOS/Linux

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your Supabase credentials

# Run the server
uvicorn app.main:app --reload --port 8000
```

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with your API URL

# Run development server
npm run dev
```

### Environment Variables

**Backend** (`.env`):
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
DATABASE_URL=postgresql://...  # Direct connection for asyncpg
```

**Frontend** (`.env.local`):
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Database

The system uses PostgreSQL via Supabase with the following key tables:

| Table | Purpose |
|-------|---------|
| `plants_master` | Equipment registry (2,000+ records) |
| `locations` | Project sites (27+ active) |
| `projects` | Contract registry with milestones and financials |
| `plant_weekly_records` | Weekly usage snapshots per plant |
| `weekly_report_submissions` | Upload tracking and processing status |
| `spare_parts` | Maintenance cost line items |
| `purchase_orders` | PO header records |
| `suppliers` | Vendor registry |
| `plant_events` | Movement, new plant, and anomaly events |
| `plant_location_history` | Complete movement history |
| `plant_transfers` | Transfer queue with resolution tracking |
| `states` | Nigerian states reference data |
| `users` | System users (synced with Supabase Auth) |
| `notifications` | In-app admin notifications |
| `upload_tokens` | Token-based upload authentication |
| `audit_logs` | Administrative action audit trail |

Key views: `v_plants_master` (enriched plant data), `v_location_stats` (site dashboards with plant counts), `v_projects_summary` (projects with linked locations).

See [`backend/docs/DATABASE.md`](backend/docs/DATABASE.md) for full schema documentation.

---

## API Documentation

The FastAPI backend provides auto-generated interactive documentation:

- **Swagger UI**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`

Key API modules:

| Module | Endpoints | Description |
|--------|-----------|-------------|
| Auth | 5 | Login, logout, user CRUD, profile |
| Plants | 15+ | Registry CRUD, history, events, usage analytics |
| Locations | 10+ | Site CRUD, plants/submissions/usage/transfers/costs per site |
| Projects | 8 | Registry CRUD, stats, milestones, linkable projects, award letter import |
| Spare Parts | 10+ | Cost tracking, PO management, supplier analytics |
| Uploads | 8 | File upload, token management, submission tracking |
| Transfers | 5 | Transfer queue, confirmation, resolution |
| Reports | 5+ | Fleet summary, verification, compliance, trends |

---

## License

Private - Internal use only.
