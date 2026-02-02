# Plant Management System - Backend Documentation

A comprehensive plant and equipment management system built with FastAPI and Supabase for tracking heavy machinery across multiple sites, managing spare parts, and generating analytics.

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Database Schema](#database-schema)
4. [API Endpoints](#api-endpoints)
5. [ETL Pipeline](#etl-pipeline)
6. [Authentication & Authorization](#authentication--authorization)
7. [Storage Setup](#storage-setup)
8. [Deployment](#deployment)

---

## System Overview

### Purpose

This system manages a fleet of heavy equipment (excavators, dozers, loaders, etc.) deployed across multiple project sites in Nigeria. It provides:

- **Plant Tracking**: Real-time visibility into equipment location, status, and verification
- **Weekly Reporting**: Site officers submit weekly reports on plant status and usage
- **Spare Parts Management**: Track maintenance costs, parts replaced, and supplier analytics
- **Movement Detection**: Automatic detection when equipment moves between sites
- **Usage Analytics**: Hours worked, breakdown hours, standby time, and utilization rates

### Data Sources

1. **Weekly Plant Reports** (Excel files)
   - Submitted by site officers every week
   - Contains: Fleet numbers, physical verification, hours worked, breakdown hours, transfers

2. **Spare Parts Records** (Excel files)
   - Purchase orders for replacement parts
   - Contains: Part details, costs, quantities, suppliers

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend (Next.js)                          │
│                    Dashboard, Reports, Analytics                    │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      FastAPI Backend Server                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │
│  │ Auth API    │  │ Plants API  │  │ Uploads API │  │ Reports   │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    ETL Worker (Background)                   │   │
│  │    - Weekly Report Processing                                │   │
│  │    - Spare Parts Processing                                  │   │
│  │    - Movement Detection                                      │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           Supabase                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │
│  │  PostgreSQL │  │   Auth      │  │  Storage    │  │  Realtime │  │
│  │  Database   │  │  (JWT)      │  │  (Reports)  │  │           │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Component | Technology |
|-----------|------------|
| API Framework | FastAPI |
| Database | PostgreSQL (Supabase) |
| Authentication | Supabase Auth (JWT) |
| File Storage | Supabase Storage |
| Background Tasks | FastAPI BackgroundTasks |
| Data Processing | Pandas |
| Logging | Structlog |

---

## Database Schema

### Core Tables

#### `plants`
Main equipment registry.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| fleet_number | VARCHAR | Unique identifier (e.g., "PW 001") |
| description | TEXT | Equipment description |
| category | VARCHAR | Type category (FK to fleet_types) |
| status | VARCHAR | active, maintenance, decommissioned |
| current_location_id | UUID | Current site location |
| physical_verification | BOOLEAN | Last verification status |
| year_of_manufacture | INTEGER | Manufacturing year |
| remarks | TEXT | Latest remarks |

#### `locations`
Project sites where equipment is deployed.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | VARCHAR | Site name |
| code | VARCHAR | Short code |
| region | VARCHAR | Geographic region |
| is_active | BOOLEAN | Active status |

#### `spare_parts`
Maintenance and replacement parts tracking.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| plant_id | UUID | Related equipment |
| part_description | TEXT | Part name/description |
| part_number | VARCHAR | Part number |
| supplier | VARCHAR | Supplier name |
| replaced_date | DATE | Replacement date |
| unit_cost | NUMERIC | Cost per unit |
| quantity | INTEGER | Quantity used |
| vat_percentage | NUMERIC | VAT % (0-100) |
| discount_percentage | NUMERIC | Discount % (0-100) |
| other_costs | NUMERIC | Shipping, handling, etc. |
| total_cost | NUMERIC | **Generated**: Auto-calculated |
| reason_for_change | TEXT | Why replaced |
| purchase_order_number | VARCHAR | PO reference |

**Total Cost Formula:**
```
total_cost = (unit_cost × quantity × (1 + vat_percentage/100) × (1 - discount_percentage/100)) + other_costs
```

### Weekly Tracking Tables

#### `plant_weekly_records`
Weekly snapshots of each plant's status and usage.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| plant_id | UUID | Related equipment |
| location_id | UUID | Location this week |
| year | INTEGER | ISO year |
| week_number | INTEGER | ISO week (1-53) |
| week_ending_date | DATE | Week ending date |
| physical_verification | BOOLEAN | Verified this week |
| hours_worked | NUMERIC | Working hours |
| standby_hours | NUMERIC | Standby hours |
| breakdown_hours | NUMERIC | Breakdown hours |
| off_hire | BOOLEAN | Off-hire status |
| transfer_from | VARCHAR | Transferred from site |
| transfer_to | VARCHAR | Transferred to site |
| remarks | TEXT | Weekly remarks |

**Unique Constraint:** `(plant_id, year, week_number)` - One record per plant per week.

#### `plant_events`
Tracks significant events (movements, new plants, missing plants).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| plant_id | UUID | Related equipment |
| event_type | VARCHAR | movement, new, missing, off_hire, decommissioned |
| event_date | DATE | When it occurred |
| from_location_id | UUID | Previous location |
| to_location_id | UUID | New location |
| is_acknowledged | BOOLEAN | Admin acknowledged |
| acknowledged_by | UUID | Who acknowledged |
| remarks | TEXT | Event notes |

#### `upload_tokens`
Token-based authentication for site officers uploading reports.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | VARCHAR | Token name (e.g., "Lagos Site Officer") |
| token | VARCHAR | The actual token/passcode |
| location_id | UUID | Restrict to specific location |
| allowed_upload_types | TEXT[] | ['weekly_report', 'purchase_order'] |
| is_active | BOOLEAN | Token enabled |
| expires_at | TIMESTAMP | Expiration (null = never) |
| last_used_at | TIMESTAMP | Last usage |
| use_count | INTEGER | Usage counter |

### Analytics Views

| View | Purpose |
|------|---------|
| `plants_summary` | Plant status with location names |
| `spare_parts_by_plant` | Total cost and part count per plant |
| `monthly_spend_by_category` | Spending trends by equipment type |

---

## API Endpoints

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/login` | Login with email/password |
| POST | `/api/v1/auth/logout` | Logout |
| GET | `/api/v1/auth/me` | Get current user |
| POST | `/api/v1/auth/users` | Create user (admin) |

### Plants

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/plants` | List plants with filters |
| GET | `/api/v1/plants/{id}` | Get plant details |
| POST | `/api/v1/plants` | Create plant (admin) |
| PATCH | `/api/v1/plants/{id}` | Update plant (admin) |
| GET | `/api/v1/plants/{id}/history` | Location history |
| GET | `/api/v1/plants/{id}/spare-parts` | Parts for this plant |
| GET | `/api/v1/plants/{id}/weekly-records` | Weekly tracking data |
| GET | `/api/v1/plants/events` | List plant events |
| PATCH | `/api/v1/plants/events/{id}/acknowledge` | Acknowledge event |
| GET | `/api/v1/plants/usage/summary` | Usage statistics |
| GET | `/api/v1/plants/usage/breakdowns` | Breakdown report |
| GET | `/api/v1/plants/utilization` | Fleet utilization rates |

### Spare Parts

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/spare-parts` | List with filters |
| GET | `/api/v1/spare-parts/{id}` | Get details |
| POST | `/api/v1/spare-parts` | Create record (admin) |
| PATCH | `/api/v1/spare-parts/{id}` | Update record (admin) |
| DELETE | `/api/v1/spare-parts/{id}` | Delete record (admin) |
| GET | `/api/v1/spare-parts/stats` | Aggregate statistics |
| GET | `/api/v1/spare-parts/top-suppliers` | Top suppliers by spend |
| GET | `/api/v1/spare-parts/high-cost-plants` | Highest maintenance cost plants |

### Uploads

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/uploads/weekly-report` | Upload weekly report (token auth) |
| POST | `/api/v1/uploads/purchase-order` | Upload PO file (token auth) |
| GET | `/api/v1/uploads/status/{job_id}` | Check processing status |
| GET | `/api/v1/uploads/submissions/weekly` | List submissions (admin) |
| POST | `/api/v1/uploads/tokens/generate` | Generate upload token (admin) |
| GET | `/api/v1/uploads/tokens` | List tokens (admin) |

### Locations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/locations` | List all locations |
| GET | `/api/v1/locations/{id}` | Get location details |
| GET | `/api/v1/locations/{id}/plants` | Plants at location |

---

## ETL Pipeline

### Weekly Report Processing

The ETL worker (`app/workers/etl_worker.py`) processes uploaded Excel files.

#### Column Mapping

The system handles various column name formats (case-insensitive):

| Excel Column | Internal Field |
|--------------|----------------|
| Fleet No, FLEET NO, Fleet Number | fleet_number |
| Physical Verification, P.P.V, PPV | physical_verification |
| Hours Worked, HOURS WORKED | hours_worked |
| S/B Hour, Standby Hours | standby_hours |
| B/D Hour, Breakdown Hours | breakdown_hours |
| Off Hire, OFF HIRE | off_hire |
| Transf. From, Transfer From | transfer_from |
| Transf. To, Transfer To | transfer_to |
| Remarks, REMARKS | remarks |

#### Physical Verification Logic

```
1. If physical_verification column has value:
   - "P" → Verified (True)
   - "O" → Not Verified (False)
   
2. If column is empty, check remarks:
   - Contains "not seen", "missing", "unavailable" → False
   - Otherwise → True (plant in report = assumed verified)
```

#### Processing Flow

```
1. Upload file via API
2. Validate token and file
3. Store file in Supabase Storage
4. Create submission record (status: pending)
5. Queue background task
6. ETL Worker:
   a. Download file from storage
   b. Parse Excel, map columns
   c. For each row:
      - Normalize fleet number
      - Derive physical verification
      - Parse usage hours
      - Create/update plant record
   d. Record weekly tracking data
   e. Detect movements (compare to previous week)
   f. Create events for movements/new plants
7. Update submission status (completed/failed)
8. Create admin notification
```

#### Movement Detection

When a plant appears at a different location than the previous week:
1. Creates a `movement` event
2. Updates `plant_location_history`
3. Notifies admin dashboard

---

## Authentication & Authorization

### Roles

| Role | Permissions |
|------|-------------|
| `admin` | Full access to all endpoints |
| `management` | Read access, limited write |

### JWT Authentication

- Login returns JWT access token
- Token sent in `Authorization: Bearer <token>` header
- Supabase validates token and extracts user info

### Token-Based Uploads

For site officers without system accounts:
1. Admin generates upload token
2. Token can be restricted to specific location
3. Token can have expiration date
4. Site officer uses token to upload weekly reports

---

## Storage Setup

### Supabase Storage Bucket

Create a storage bucket named `reports` in your Supabase project:

1. Go to Supabase Dashboard → Storage
2. Click "New Bucket"
3. Name: `reports`
4. Public: **No** (private bucket)
5. File size limit: 50MB
6. Allowed MIME types:
   - `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
   - `application/vnd.ms-excel`

### Storage Structure

```
reports/
├── weekly-reports/
│   └── {location_id}/
│       └── {week_ending_date}/
│           └── {filename}.xlsx
└── purchase-orders/
    └── {location_id}/
        └── {po_date}/
            └── {filename}.xlsx
```

---

## Deployment

### Environment Variables

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Application
ENVIRONMENT=production
LOG_LEVEL=INFO
DEBUG=false

# Security
SECRET_KEY=your-secret-key
CORS_ORIGINS=["https://your-frontend.com"]
```

### Running Locally

```bash
# Install dependencies
pip install -r requirements.txt

# Run development server
uvicorn app.main:app --reload --port 8000
```

### Running Tests

```bash
# All tests
pytest

# With coverage
pytest --cov=app

# Specific test file
pytest tests/test_etl_worker.py -v
```

### Docker

```bash
# Build
docker build -t plant-management-api .

# Run
docker run -p 8000:8000 --env-file .env plant-management-api
```

---

## Database Functions

### Key RPC Functions

| Function | Description |
|----------|-------------|
| `search_plants(query, filters)` | Full-text search with filters |
| `get_spare_parts_stats(year, location)` | Aggregate spare parts stats |
| `get_top_suppliers(limit, year)` | Top suppliers by spend |
| `get_high_cost_plants(limit, year)` | Plants with highest maintenance |
| `generate_upload_token(...)` | Create new upload token |
| `validate_upload_token(token, type)` | Validate and return token info |
| `get_plant_location_history(plant_id)` | Full movement history |
| `transfer_plant(plant_id, to_location, reason)` | Manual transfer |

---

## Monitoring

### Structured Logging

All logs use JSON format with:
- Timestamp
- Request ID
- User ID
- Log level
- Context data

### Metrics

The API tracks:
- Request counts by endpoint
- Response times
- Error rates
- Background task status

### Health Check

```
GET /api/v1/health
```

Returns database connectivity and system status.

---

## Support

For issues or questions:
1. Check the API documentation at `/docs` (Swagger UI)
2. Review logs for error details
3. Contact the development team
