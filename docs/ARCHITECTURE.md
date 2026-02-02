# Plant Management System - Architecture Blueprint

> **Version:** 1.0 (Draft)
> **Last Updated:** 2026-02-02
> **Status:** Under Review

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Goals & Requirements](#2-system-goals--requirements)
3. [High-Level Architecture](#3-high-level-architecture)
4. [Data Architecture](#4-data-architecture)
5. [Backend Architecture](#5-backend-architecture)
6. [Frontend Architecture](#6-frontend-architecture)
7. [ETL & Data Pipeline](#7-etl--data-pipeline)
8. [Security Architecture](#8-security-architecture)
9. [Observability & Monitoring](#9-observability--monitoring)
10. [Scalability Strategy](#10-scalability-strategy)
11. [Failure Handling & Resilience](#11-failure-handling--resilience)
12. [AI Integration Strategy](#12-ai-integration-strategy)
13. [Technology Stack](#13-technology-stack)
14. [Trade-offs & Alternatives](#14-trade-offs--alternatives)
15. [Risks & Mitigations](#15-risks--mitigations)
16. [Implementation Roadmap](#16-implementation-roadmap)

---

## 1. Executive Summary

### What We're Building

A comprehensive **Plant Management System** for tracking, maintaining, and analyzing industrial plant equipment across multiple locations. The system will:

- **Store** asset data securely with full audit trails
- **Track** equipment locations, maintenance history, and spare parts
- **Analyze** operational data for business intelligence
- **Predict** maintenance needs using AI/ML
- **Automate** reporting and data pipelines
- **Scale** to handle growing data volumes and users

### Design Principles

| Principle | Description |
|-----------|-------------|
| **Sustainability** | System must run without constant manual intervention |
| **Automation** | Repeatable processes, CI/CD, scheduled jobs |
| **Observability** | Know what's happening at all times |
| **Security** | Defense in depth, least privilege |
| **Simplicity** | Avoid over-engineering; complexity only when justified |
| **Evolvability** | Easy to change, extend, and maintain |

---

## 2. System Goals & Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-01 | CRUD operations for plants, spare parts, locations | Must Have |
| FR-02 | Track plant location history over time | Must Have |
| FR-03 | Role-based access control (Admin, Management) | Must Have |
| FR-04 | Import data from Excel files (ETL) | Must Have |
| FR-05 | Generate reports (PDF, Excel exports) | Must Have |
| FR-06 | Real-time dashboard with key metrics | Should Have |
| FR-07 | Search and filter across all entities | Must Have |
| FR-08 | Audit log for all data changes | Should Have |
| FR-09 | Predictive maintenance alerts (AI) | Nice to Have |
| FR-10 | Natural language queries (AI) | Nice to Have |

### Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-01 | Availability | 99.5% uptime |
| NFR-02 | Response Time | < 200ms for 95th percentile API calls |
| NFR-03 | Data Retention | 7 years for audit/compliance |
| NFR-04 | Concurrent Users | Support 50+ simultaneous users |
| NFR-05 | Data Volume | Handle 100K+ plants, 1M+ spare parts |
| NFR-06 | Recovery Time | < 1 hour RPO, < 4 hours RTO |
| NFR-07 | Security | SOC 2 Type II compliance ready |

---

## 3. High-Level Architecture

### Architecture Pattern: **Hybrid Backend (FastAPI + Supabase)**

We choose a **hybrid architecture** combining FastAPI (Python) with Supabase because:
- **Single language (Python)** for ETL, API, and AI - no context switching
- **Native data science tools** - pandas, numpy, scikit-learn for analytics
- **AI/ML first-class support** - langchain, anthropic SDK, embeddings
- **Full control** over complex business logic (Excel processing, email parsing)
- **Supabase strengths** retained - auth, real-time, storage, PostgreSQL
- Team already proficient in Python from ETL development

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PRESENTATION LAYER                              │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐  │
│  │   Web Application   │  │   Upload Portal     │  │   Mobile (Future)   │  │
│  │   (Next.js/React)   │  │  (File Ingestion)   │  │   (React Native)    │  │
│  └──────────┬──────────┘  └──────────┬──────────┘  └──────────┬──────────┘  │
└─────────────┼────────────────────────┼────────────────────────┼─────────────┘
              │                        │                        │
              ▼                        ▼                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                 API LAYER                                    │
│                                                                              │
│  ┌────────────────────────────────┐  ┌────────────────────────────────┐    │
│  │         FASTAPI (Python)       │  │      SUPABASE (BaaS)           │    │
│  │  ┌──────────────────────────┐  │  │  ┌──────────────────────────┐  │    │
│  │  │ • File Processing        │  │  │  │ • Authentication (JWT)   │  │    │
│  │  │ • Excel/Email Parsing    │  │  │  │ • Real-time Subscriptions│  │    │
│  │  │ • ETL Orchestration      │  │  │  │ • File Storage (S3)      │  │    │
│  │  │ • AI/ML Processing       │  │  │  │ • Simple CRUD (backup)   │  │    │
│  │  │ • Complex Business Logic │  │  │  │ • Row-Level Security     │  │    │
│  │  │ • Report Generation      │  │  │  └──────────────────────────┘  │    │
│  │  │ • Analytics Queries      │  │  │                                │    │
│  │  │ • Webhooks (Email/WA)    │  │  │  Used for:                     │    │
│  │  └──────────────────────────┘  │  │  • User login/logout           │    │
│  │                                │  │  • Real-time dashboard updates │    │
│  │  Deployed on: Railway/Render   │  │  • File upload storage         │    │
│  └────────────────────────────────┘  └────────────────────────────────┘    │
│                     │                              │                        │
│                     └──────────────┬───────────────┘                        │
│                                    │                                        │
└────────────────────────────────────┼────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BUSINESS LOGIC LAYER                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     FastAPI Application (Python)                     │   │
│  │                                                                       │   │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐        │   │
│  │  │  Plants   │  │   Parts   │  │  Reports  │  │    AI     │        │   │
│  │  │  Service  │  │  Service  │  │  Service  │  │  Service  │        │   │
│  │  └───────────┘  └───────────┘  └───────────┘  └───────────┘        │   │
│  │                                                                       │   │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐        │   │
│  │  │ Ingestion │  │    ETL    │  │ Analytics │  │  Notify   │        │   │
│  │  │  Service  │  │  Pipeline │  │  Engine   │  │  Service  │        │   │
│  │  └───────────┘  └───────────┘  └───────────┘  └───────────┘        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                               DATA LAYER                                     │
│                                                                              │
│  ┌─────────────────────────────┐    ┌─────────────────────────────┐        │
│  │     OPERATIONAL DATABASE    │    │      DATA WAREHOUSE         │        │
│  │      (OLTP - Supabase)      │    │    (OLAP - Analytics)       │        │
│  │  ┌───────────────────────┐  │    │  ┌───────────────────────┐  │        │
│  │  │   public schema       │  │    │  │   analytics schema    │  │        │
│  │  │   - plants            │  │    │  │   - fact_maintenance  │  │        │
│  │  │   - spare_parts       │  │    │  │   - fact_transfers    │  │        │
│  │  │   - locations         │  │    │  │   - dim_plants        │  │        │
│  │  │   - users             │  │    │  │   - dim_locations     │  │        │
│  │  │   - audit_logs        │  │    │  │   - dim_time          │  │        │
│  │  └───────────────────────┘  │    │  └───────────────────────┘  │        │
│  └─────────────────────────────┘    └─────────────────────────────┘        │
│                │                                  ▲                         │
│                │              ETL                 │                         │
│                └──────────────────────────────────┘                         │
│                                                                              │
│  ┌─────────────────────────────┐    ┌─────────────────────────────┐        │
│  │       VECTOR STORE          │    │         CACHE               │        │
│  │    (pgvector extension)     │    │   (Supabase/Redis Future)   │        │
│  │   - document_embeddings     │    │   - session cache           │        │
│  │   - query_cache             │    │   - query results           │        │
│  └─────────────────────────────┘    └─────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL INTEGRATIONS                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   ETL Jobs   │  │   AI/LLM     │  │    Email     │  │   Storage    │    │
│  │   (Python)   │  │   (Claude)   │  │  (Resend)    │  │  (Supabase)  │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Technology |
|-----------|---------------|------------|
| Web App | User interface, forms, dashboards | Next.js 14 (App Router) |
| API Gateway | Auth, rate limiting, routing | Supabase Gateway |
| REST API | Auto-generated CRUD endpoints | PostgREST |
| GraphQL API | Flexible queries, relationships | pg_graphql |
| Edge Functions | Custom business logic, webhooks | Deno (Supabase Edge) |
| OLTP Database | Transactional data, real-time | PostgreSQL (Supabase) |
| OLAP Database | Analytics, reporting | PostgreSQL (same instance, different schema) |
| Vector Store | AI embeddings, semantic search | pgvector |
| ETL Pipeline | Data ingestion, transformation | Python (existing) |

---

## 4. Data Architecture

### 4.1 Database Schema Strategy

We use **schema separation** to organize different concerns:

```
PostgreSQL Database
├── public          # Core application tables (OLTP)
├── analytics       # Data warehouse tables (OLAP)
├── audit           # Audit logs and change tracking
├── monitoring      # Performance metrics (existing)
└── ai              # Vector embeddings and AI cache
```

### 4.2 OLTP Schema (public) - Current + Enhancements

```sql
-- EXISTING TABLES (Enhanced)
plants                    -- Master equipment registry
├── id (PK)
├── fleet_number (UNIQUE)
├── description
├── fleet_type_id (FK)
├── make, model, chassis_number
├── year_of_manufacture
├── purchase_cost
├── status (active/archived/disposed)
├── physical_verification
├── current_location_id (FK)
├── created_at, updated_at
└── [NEW] deleted_at      -- Soft delete support

spare_parts               -- Maintenance history
├── id (PK)
├── plant_id (FK)
├── replaced_date
├── part_number, part_description
├── supplier, reason_for_change
├── unit_cost, quantity
├── vat_percentage, discount_percentage
├── other_costs, total_cost (computed)
└── created_by (FK), created_at

plant_location_history    -- Location tracking
├── id (PK)
├── plant_id (FK)
├── location_id (FK)
├── start_date, end_date
├── transfer_reason
└── created_by (FK), created_at

locations                 -- Physical sites
├── id (PK)
├── name (UNIQUE)
├── [NEW] address
├── [NEW] coordinates (PostGIS point)
└── created_at

fleet_types               -- Equipment categories
├── id (PK)
├── name (UNIQUE)
├── description
└── created_at

users                     -- System users
├── id (PK)
├── email (UNIQUE)
├── password_hash
├── full_name
├── role (admin/management)
├── is_active
├── must_change_password
├── last_login_at
└── created_at, updated_at

-- NEW TABLES
audit_logs                -- Change tracking
├── id (PK)
├── table_name
├── record_id
├── action (INSERT/UPDATE/DELETE)
├── old_values (JSONB)
├── new_values (JSONB)
├── user_id (FK)
├── ip_address
└── created_at

attachments               -- File storage metadata
├── id (PK)
├── entity_type (plant/spare_part)
├── entity_id
├── file_name
├── file_path (Supabase Storage)
├── file_size
├── mime_type
├── uploaded_by (FK)
└── created_at

notifications             -- User notifications
├── id (PK)
├── user_id (FK)
├── type (alert/info/warning)
├── title, message
├── read_at
├── action_url
└── created_at
```

### 4.3 OLAP Schema (analytics) - Data Warehouse

Using **Star Schema** for optimal query performance:

```sql
-- DIMENSION TABLES
dim_plants                -- Slowly Changing Dimension Type 2
├── plant_key (PK, surrogate)
├── plant_id (natural key)
├── fleet_number
├── description
├── fleet_type_name
├── make, model
├── year_of_manufacture
├── purchase_cost
├── valid_from, valid_to  -- SCD Type 2
├── is_current
└── row_hash              -- Change detection

dim_locations
├── location_key (PK, surrogate)
├── location_id (natural key)
├── name
├── region                -- Derived/enriched
├── is_current
└── valid_from, valid_to

dim_time                  -- Pre-populated date dimension
├── date_key (PK, YYYYMMDD integer)
├── full_date
├── day, month, year
├── quarter
├── day_of_week, day_name
├── week_of_year
├── is_weekend
├── is_holiday
└── fiscal_year, fiscal_quarter

dim_suppliers
├── supplier_key (PK)
├── supplier_name
├── first_seen_date
└── is_active

-- FACT TABLES
fact_maintenance          -- Grain: one row per spare part replacement
├── maintenance_key (PK)
├── plant_key (FK)
├── location_key (FK)
├── supplier_key (FK)
├── date_key (FK)
├── part_number
├── part_description
├── quantity
├── unit_cost
├── total_cost
├── reason_for_change
└── created_at

fact_plant_snapshots      -- Grain: one row per plant per month
├── snapshot_key (PK)
├── plant_key (FK)
├── location_key (FK)
├── date_key (FK)
├── status
├── physical_verification
├── cumulative_maintenance_cost
├── parts_replaced_count
└── months_at_location

fact_transfers            -- Grain: one row per location change
├── transfer_key (PK)
├── plant_key (FK)
├── from_location_key (FK)
├── to_location_key (FK)
├── date_key (FK)
├── transfer_reason
└── days_at_previous_location
```

### 4.4 Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           DATA SOURCES                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │  Excel   │  │   Web    │  │   API    │  │  Manual  │               │
│  │  Files   │  │   Forms  │  │  Imports │  │  Entry   │               │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘               │
└───────┼─────────────┼─────────────┼─────────────┼───────────────────────┘
        │             │             │             │
        ▼             ▼             ▼             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         INGESTION LAYER                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    ETL Pipeline (Python)                         │   │
│  │   Extract → Clean → Validate → Transform → Load                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                          │
│                              ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Change Data Capture                           │   │
│  │   PostgreSQL Triggers → audit_logs table                         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        STORAGE LAYER                                     │
│  ┌──────────────────────┐         ┌──────────────────────┐             │
│  │   OLTP (public)      │ ──ETL──▶│   OLAP (analytics)   │             │
│  │   Normalized         │         │   Denormalized       │             │
│  │   Real-time          │         │   Optimized for BI   │             │
│  └──────────────────────┘         └──────────────────────┘             │
│                                              │                          │
│                                              ▼                          │
│                                   ┌──────────────────────┐             │
│                                   │   Materialized Views │             │
│                                   │   Pre-aggregated     │             │
│                                   └──────────────────────┘             │
└─────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      CONSUMPTION LAYER                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │   API    │  │ Reports  │  │Dashboards│  │    AI    │               │
│  │ Queries  │  │  (PDF)   │  │  (BI)    │  │ Analysis │               │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Backend Architecture

### 5.1 API Strategy: Hybrid Approach

We use a **hybrid API strategy** leveraging Supabase's built-in capabilities:

| API Type | Use Case | Implementation |
|----------|----------|----------------|
| REST (PostgREST) | Simple CRUD, filtering, pagination | Auto-generated from schema |
| GraphQL | Complex queries, relationships, mobile apps | pg_graphql extension |
| Edge Functions | Custom logic, webhooks, external APIs | Deno runtime |
| RPC Functions | Complex business logic, transactions | PostgreSQL functions |

### 5.2 API Layer Design

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          API ENDPOINTS                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  REST API (Auto-generated via PostgREST)                                │
│  ────────────────────────────────────────                               │
│  GET    /rest/v1/plants              - List plants (with filters)       │
│  GET    /rest/v1/plants?id=eq.{id}   - Get single plant                 │
│  POST   /rest/v1/plants              - Create plant                     │
│  PATCH  /rest/v1/plants?id=eq.{id}   - Update plant                     │
│  DELETE /rest/v1/plants?id=eq.{id}   - Delete plant (soft)              │
│                                                                          │
│  GET    /rest/v1/spare_parts?plant_id=eq.{id}  - Parts for plant       │
│  GET    /rest/v1/plant_location_history?...    - Location history       │
│                                                                          │
│  GraphQL API (via pg_graphql)                                           │
│  ─────────────────────────────                                          │
│  POST   /graphql/v1                                                     │
│  │                                                                       │
│  │  query {                                                             │
│  │    plants(filter: { status: { eq: "active" } }) {                   │
│  │      fleetNumber                                                     │
│  │      description                                                     │
│  │      currentLocation { name }                                        │
│  │      spareParts(first: 10) { partDescription, totalCost }           │
│  │    }                                                                 │
│  │  }                                                                   │
│                                                                          │
│  Edge Functions (Custom Logic)                                          │
│  ─────────────────────────────                                          │
│  POST   /functions/v1/run-etl        - Trigger ETL pipeline            │
│  POST   /functions/v1/generate-report - Generate PDF/Excel report      │
│  POST   /functions/v1/ai-query       - Natural language query          │
│  POST   /functions/v1/predict-maintenance - AI predictions             │
│  POST   /functions/v1/bulk-import    - Bulk data import                │
│  POST   /functions/v1/send-notification - Send email/push              │
│                                                                          │
│  RPC Functions (Database Functions)                                     │
│  ──────────────────────────────────                                     │
│  POST   /rest/v1/rpc/transfer_plant  - Transfer plant to location      │
│  POST   /rest/v1/rpc/get_plant_summary - Complex aggregation           │
│  POST   /rest/v1/rpc/search_plants   - Full-text search                │
│  POST   /rest/v1/rpc/get_dashboard_stats - Dashboard metrics           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Business Logic Placement

| Logic Type | Location | Rationale |
|------------|----------|-----------|
| Validation | Database (CHECK constraints) + Edge Functions | Defense in depth |
| Authorization | RLS Policies + Edge Functions | Row-level security |
| Simple Queries | PostgREST / GraphQL | No custom code needed |
| Complex Queries | Database Functions (RPC) | Performance, atomicity |
| Workflows | Edge Functions | Orchestration, external calls |
| Scheduled Jobs | pg_cron + Edge Functions | Automation |

### 5.4 Database Functions (RPC)

```sql
-- Example: Transfer plant to new location (atomic transaction)
CREATE OR REPLACE FUNCTION transfer_plant(
  p_plant_id UUID,
  p_new_location_id UUID,
  p_transfer_reason TEXT,
  p_user_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_old_location_id UUID;
  v_result JSONB;
BEGIN
  -- Get current location
  SELECT current_location_id INTO v_old_location_id
  FROM plants WHERE id = p_plant_id;

  -- Close previous location history
  UPDATE plant_location_history
  SET end_date = NOW()
  WHERE plant_id = p_plant_id AND end_date IS NULL;

  -- Create new location history
  INSERT INTO plant_location_history
    (plant_id, location_id, start_date, transfer_reason, created_by)
  VALUES
    (p_plant_id, p_new_location_id, NOW(), p_transfer_reason, p_user_id);

  -- Update plant's current location
  UPDATE plants
  SET current_location_id = p_new_location_id, updated_at = NOW()
  WHERE id = p_plant_id;

  -- Return result
  v_result := jsonb_build_object(
    'success', true,
    'plant_id', p_plant_id,
    'from_location', v_old_location_id,
    'to_location', p_new_location_id
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## 6. Frontend Architecture

### 6.1 Technology Choice: Next.js 14 (App Router)

**Why Next.js?**
- Server-side rendering for SEO and performance
- API routes for BFF (Backend for Frontend) pattern
- React Server Components reduce client bundle
- Built-in optimization (images, fonts, scripts)
- TypeScript first-class support
- Excellent Supabase integration

### 6.2 Frontend Structure

```
frontend/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # Auth group (login, register)
│   │   ├── login/page.tsx
│   │   └── layout.tsx
│   ├── (dashboard)/              # Protected routes
│   │   ├── layout.tsx            # Dashboard layout with sidebar
│   │   ├── page.tsx              # Dashboard home
│   │   ├── plants/
│   │   │   ├── page.tsx          # Plants list
│   │   │   ├── [id]/page.tsx     # Plant detail
│   │   │   └── new/page.tsx      # Create plant
│   │   ├── spare-parts/
│   │   ├── locations/
│   │   ├── reports/
│   │   ├── analytics/
│   │   └── settings/
│   ├── api/                      # API routes (BFF)
│   │   ├── reports/route.ts
│   │   └── ai/route.ts
│   ├── layout.tsx                # Root layout
│   └── globals.css
├── components/
│   ├── ui/                       # Base UI components (shadcn/ui)
│   ├── forms/                    # Form components
│   ├── tables/                   # Data tables
│   ├── charts/                   # Chart components
│   └── layouts/                  # Layout components
├── lib/
│   ├── supabase/
│   │   ├── client.ts             # Browser client
│   │   ├── server.ts             # Server client
│   │   └── middleware.ts         # Auth middleware
│   ├── utils.ts
│   └── validations.ts            # Zod schemas
├── hooks/                        # Custom React hooks
├── types/                        # TypeScript types (generated)
└── public/
```

### 6.3 State Management Strategy

| State Type | Solution | Rationale |
|------------|----------|-----------|
| Server State | TanStack Query | Caching, background refetch, optimistic updates |
| URL State | nuqs (URL search params) | Shareable, bookmarkable filters |
| Form State | React Hook Form + Zod | Validation, performance |
| UI State | Zustand (minimal) | Only for truly global UI state |
| Real-time | Supabase Realtime | WebSocket subscriptions |

### 6.4 Key UI Features

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ┌─────┐                    Plant Management System              👤 Ram │
│  │ ≡   │  Dashboard   Plants   Parts   Locations   Reports   Analytics │
├──┴─────┴────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │  📊 Dashboard                                                        │ │
│ │                                                                      │ │
│ │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │ │
│ │  │  2,007   │  │    458   │  │    23    │  │  ₦45.2M  │            │ │
│ │  │  Plants  │  │  Parts   │  │ Locations│  │ Maint.   │            │ │
│ │  └──────────┘  └──────────┘  └──────────┘  └──────────┘            │ │
│ │                                                                      │ │
│ │  ┌────────────────────────────┐  ┌────────────────────────────┐    │ │
│ │  │  Maintenance Costs (YTD)   │  │  Plants by Location        │    │ │
│ │  │  ▁▂▃▄▅▆▇█▇▅▄▃▂▁           │  │  [PIE CHART]               │    │ │
│ │  │  Jan Feb Mar Apr May Jun   │  │                            │    │ │
│ │  └────────────────────────────┘  └────────────────────────────┘    │ │
│ │                                                                      │ │
│ │  ┌──────────────────────────────────────────────────────────────┐  │ │
│ │  │  Recent Activity                                              │  │ │
│ │  │  • PT169 transferred to LAGOS AIRPORT                         │  │ │
│ │  │  • AC10 maintenance: ₦125,000                                 │  │ │
│ │  │  • New plant added: T450                                      │  │ │
│ │  └──────────────────────────────────────────────────────────────┘  │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Data Ingestion Workflow

### 7.1 Current Problem

```
CURRENT STATE (Manual, Error-Prone):

Site Officers                     Plant Officer                    Analysis
   │                                   │                               │
   │  1. Create Excel report           │                               │
   │  2. Email to plant officer ──────▶│  3. Open each email           │
   │     (weekly)                      │  4. Download attachment       │
   │                                   │  5. Manually copy data ──────▶│  6. Another Excel
   │                                   │  6. Repeat for all sites      │  7. Manual analysis
   │                                   │  (HOURS of work!)             │
   │                                   │                               │

Problems:
• Hours wasted on manual data entry
• Human errors in transcription
• No real-time visibility
• Data scattered across emails
• Hard to track what's processed
• Reports often late or missing
```

### 7.2 New Automated Workflow

```
NEW STATE (Automated):

┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATA INGESTION OPTIONS                               │
│                                                                              │
│  OPTION 1: Upload Portal (PRIMARY)                                          │
│  ─────────────────────────────────                                          │
│  Site Officer ──▶ upload.yourcompany.com ──▶ Drag & drop Excel             │
│                                              ──▶ Instant validation         │
│                                              ──▶ Confirmation message       │
│                                                                              │
│  OPTION 2: Email Forwarding (CONVENIENCE)                                   │
│  ────────────────────────────────────────                                   │
│  Site Officer ──▶ Email with attachment                                     │
│                   CC: reports@yourcompany.com ──▶ Auto-extract attachment  │
│                                                 ──▶ Process automatically   │
│                                                                              │
│  OPTION 3: WhatsApp (FUTURE - MOBILE)                                       │
│  ────────────────────────────────────                                       │
│  Site Officer ──▶ Send file to WhatsApp Business ──▶ Auto-acknowledge      │
│                                                     ──▶ Process             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PROCESSING PIPELINE                                  │
│                                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │  RECEIVE    │───▶│   PARSE     │───▶│  VALIDATE   │───▶│    LOAD     │  │
│  │             │    │             │    │             │    │             │  │
│  │ • Store file│    │ • Extract   │    │ • Required  │    │ • Upsert to │  │
│  │ • Log job   │    │   week date │    │   fields    │    │   database  │  │
│  │ • Queue     │    │ • Detect    │    │ • Fleet #   │    │ • Update    │  │
│  │             │    │   location  │    │   format    │    │   calendar  │  │
│  │             │    │ • Parse     │    │ • Duplicates│    │ • Trigger   │  │
│  │             │    │   plants    │    │ • Anomalies │    │   refresh   │  │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘  │
│                                                                   │         │
│                                                                   ▼         │
│                                                          ┌─────────────┐   │
│                                                          │   NOTIFY    │   │
│                                                          │             │   │
│                                                          │ • Success   │   │
│                                                          │   message   │   │
│                                                          │ • Error     │   │
│                                                          │   alerts    │   │
│                                                          │ • Dashboard │   │
│                                                          │   update    │   │
│                                                          └─────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CLEAN DATA AVAILABLE                                 │
│                                                                              │
│  • Plant Officer sees real-time dashboard (no more manual entry!)           │
│  • Management gets weekly summaries automatically                           │
│  • Missing reports flagged immediately                                       │
│  • Analytics updated in real-time                                           │
│  • AI can query the data                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.3 Weekly Report Calendar Structure

```sql
-- New table to track weekly report submissions
CREATE TABLE weekly_report_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    year INTEGER NOT NULL,
    week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 53),
    week_ending_date DATE NOT NULL,
    location_id UUID REFERENCES locations(id),

    -- Submission tracking
    submitted_at TIMESTAMPTZ,
    submitted_by TEXT,  -- Email or name of submitter
    source_type TEXT CHECK (source_type IN ('upload', 'email', 'whatsapp', 'manual')),
    source_file_path TEXT,  -- Supabase storage path

    -- Processing status
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    processed_at TIMESTAMPTZ,
    plants_count INTEGER,
    errors JSONB,

    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(year, week_number, location_id)
);

-- View: Which sites are missing reports this week?
CREATE VIEW missing_weekly_reports AS
SELECT
    l.name as location,
    EXTRACT(YEAR FROM CURRENT_DATE) as year,
    EXTRACT(WEEK FROM CURRENT_DATE) as current_week
FROM locations l
WHERE NOT EXISTS (
    SELECT 1 FROM weekly_report_submissions w
    WHERE w.location_id = l.id
    AND w.year = EXTRACT(YEAR FROM CURRENT_DATE)
    AND w.week_number = EXTRACT(WEEK FROM CURRENT_DATE)
);
```

### 7.4 Implementation: Upload Portal

```python
# FastAPI endpoint for file upload
from fastapi import FastAPI, UploadFile, HTTPException, Depends
from supabase import create_client

app = FastAPI()

@app.post("/api/v1/reports/upload")
async def upload_weekly_report(
    file: UploadFile,
    location_id: str,
    week_ending_date: str,
    current_user = Depends(get_current_user)  # From Supabase auth
):
    """
    Upload a weekly report Excel file.

    1. Validate file type (.xlsx, .xls)
    2. Store in Supabase Storage
    3. Create processing job
    4. Return job ID for status tracking
    """
    # Validate file type
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(400, "Only Excel files accepted")

    # Store file in Supabase Storage
    storage_path = f"weekly-reports/{location_id}/{week_ending_date}/{file.filename}"
    supabase.storage.from_("reports").upload(storage_path, file.file.read())

    # Create processing job
    job = supabase.table("weekly_report_submissions").insert({
        "location_id": location_id,
        "week_ending_date": week_ending_date,
        "year": parse_year(week_ending_date),
        "week_number": parse_week(week_ending_date),
        "source_type": "upload",
        "source_file_path": storage_path,
        "submitted_by": current_user.email,
        "status": "pending"
    }).execute()

    # Trigger async processing
    background_tasks.add_task(process_weekly_report, job.data[0]["id"])

    return {"job_id": job.data[0]["id"], "status": "processing"}
```

---

## 8. ETL & Data Pipeline

### 7.1 Current Pipeline (Preserved & Enhanced)

The existing Python ETL pipeline is well-designed and will be kept with enhancements:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        ETL PIPELINE ARCHITECTURE                         │
│                                                                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                 │
│  │   SOURCE    │    │   STAGING   │    │   TARGET    │                 │
│  │   FILES     │───▶│   (Clean)   │───▶│  (Supabase) │                 │
│  └─────────────┘    └─────────────┘    └─────────────┘                 │
│        │                  │                   │                         │
│        ▼                  ▼                   ▼                         │
│  ┌──────────┐      ┌──────────┐       ┌──────────┐                     │
│  │ Extractors│     │ Cleaners │       │ Loaders  │                     │
│  │ - Weekly │      │ - Fleet# │       │ - Plants │                     │
│  │ - Legacy │      │ - Dates  │       │ - Parts  │                     │
│  │ - Parts  │      │ - Costs  │       │ - History│                     │
│  └──────────┘      └──────────┘       └──────────┘                     │
│        │                  │                   │                         │
│        └──────────────────┼───────────────────┘                         │
│                           ▼                                             │
│                    ┌──────────────┐                                     │
│                    │  Validators  │                                     │
│                    │  - Required  │                                     │
│                    │  - Ranges    │                                     │
│                    │  - Duplicates│                                     │
│                    └──────────────┘                                     │
│                           │                                             │
│                           ▼                                             │
│                    ┌──────────────┐                                     │
│                    │   Pipeline   │                                     │
│                    │ Orchestrator │                                     │
│                    └──────────────┘                                     │
└─────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Enhanced Pipeline Features

| Feature | Current | Enhanced |
|---------|---------|----------|
| Execution | Manual CLI | Scheduled (pg_cron) + Manual + API trigger |
| Monitoring | Basic logging | Structured logs + metrics + alerts |
| Error Handling | Log and continue | Retry with backoff + dead letter queue |
| Idempotency | Partial | Full idempotency with checksums |
| Incremental | No | Delta detection, only process changes |
| Lineage | No | Track source → target mappings |

### 7.3 OLTP → OLAP ETL

Separate pipeline to populate data warehouse:

```python
# Scheduled nightly via pg_cron
# 1. Extract changes from OLTP since last run
# 2. Transform to star schema format
# 3. Load to analytics schema
# 4. Refresh materialized views
```

---

## 8. Security Architecture

### 8.1 Authentication & Authorization

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SECURITY LAYERS                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Layer 1: Network Security                                              │
│  ─────────────────────────                                              │
│  • HTTPS/TLS 1.3 only                                                   │
│  • Supabase network firewall                                            │
│  • API rate limiting (100 req/min per user)                             │
│                                                                          │
│  Layer 2: Authentication                                                │
│  ───────────────────────                                                │
│  • Supabase Auth (JWT-based)                                            │
│  • Email/password with email verification                               │
│  • Password requirements: min 12 chars, complexity                      │
│  • Session management: 1 hour access token, 7 day refresh               │
│  • Invite-only registration (no public signup)                          │
│                                                                          │
│  Layer 3: Authorization (RBAC)                                          │
│  ─────────────────────────────                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Role        │ Plants │ Parts │ Users │ Reports │ Settings      │  │
│  ├──────────────┼────────┼───────┼───────┼─────────┼───────────────┤  │
│  │  admin       │ CRUD   │ CRUD  │ CRUD  │ CRUD    │ CRUD          │  │
│  │  management  │ R      │ R     │ -     │ R       │ R             │  │
│  │  operator*   │ RU     │ CRU   │ -     │ R       │ -             │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│  * Future role                                                          │
│                                                                          │
│  Layer 4: Row-Level Security (RLS)                                      │
│  ─────────────────────────────────                                      │
│  • All tables have RLS enabled                                          │
│  • Policies based on auth.uid() and user role                          │
│  • Example: Management can only see active plants                       │
│                                                                          │
│  Layer 5: Data Protection                                               │
│  ────────────────────────                                               │
│  • Encryption at rest (Supabase default)                                │
│  • Encryption in transit (TLS)                                          │
│  • No PII stored (equipment data only)                                  │
│  • Audit logging for all changes                                        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8.2 RLS Policy Examples

```sql
-- Enable RLS on plants table
ALTER TABLE plants ENABLE ROW LEVEL SECURITY;

-- Admin: full access
CREATE POLICY "admin_all_plants" ON plants
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Management: read active plants only
CREATE POLICY "management_read_active_plants" ON plants
  FOR SELECT
  TO authenticated
  USING (
    status = 'active'
    AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'management'
    )
  );
```

### 8.3 Audit Trail

```sql
-- Automatic audit logging via trigger
CREATE OR REPLACE FUNCTION audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit.logs (
    table_name,
    record_id,
    action,
    old_values,
    new_values,
    user_id,
    ip_address
  ) VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END,
    auth.uid(),
    current_setting('request.headers', true)::json->>'x-forwarded-for'
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## 9. Observability & Monitoring

### 9.1 Three Pillars of Observability

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        OBSERVABILITY STACK                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────┐ │
│  │       LOGS          │  │       METRICS       │  │      TRACES     │ │
│  ├─────────────────────┤  ├─────────────────────┤  ├─────────────────┤ │
│  │                     │  │                     │  │                 │ │
│  │ • Application logs  │  │ • Request latency   │  │ • Request flow  │ │
│  │ • ETL pipeline logs │  │ • Error rates       │  │ • DB queries    │ │
│  │ • Database logs     │  │ • DB connections    │  │ • External APIs │ │
│  │ • Auth events       │  │ • Cache hit ratio   │  │                 │ │
│  │                     │  │ • ETL run stats     │  │                 │ │
│  │                     │  │                     │  │                 │ │
│  │ Storage:            │  │ Storage:            │  │ Storage:        │ │
│  │ Supabase Logs +     │  │ PostgreSQL +        │  │ (Future)        │ │
│  │ structured JSON     │  │ monitoring schema   │  │                 │ │
│  │                     │  │                     │  │                 │ │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────┘ │
│           │                        │                        │           │
│           └────────────────────────┼────────────────────────┘           │
│                                    ▼                                    │
│                         ┌─────────────────────┐                         │
│                         │    DASHBOARDS       │                         │
│                         │  • Health overview  │                         │
│                         │  • ETL status       │                         │
│                         │  • Error tracking   │                         │
│                         │  • Performance      │                         │
│                         └─────────────────────┘                         │
│                                    │                                    │
│                                    ▼                                    │
│                         ┌─────────────────────┐                         │
│                         │      ALERTS         │                         │
│                         │  • Error spike      │                         │
│                         │  • ETL failure      │                         │
│                         │  • High latency     │                         │
│                         │  • Low disk space   │                         │
│                         └─────────────────────┘                         │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 9.2 Key Metrics to Monitor

| Category | Metric | Warning | Critical |
|----------|--------|---------|----------|
| **Database** | Connection count | > 80% max | > 95% max |
| | Cache hit ratio | < 95% | < 90% |
| | Dead tuples % | > 10% | > 20% |
| | Query latency (p95) | > 500ms | > 2000ms |
| **API** | Error rate | > 1% | > 5% |
| | Latency (p95) | > 500ms | > 2000ms |
| | 5xx responses | Any | Sustained |
| **ETL** | Run duration | > 10 min | > 30 min |
| | Records failed | > 1% | > 5% |
| | Run status | Warning | Failed |
| **Storage** | Database size | > 80% quota | > 95% quota |
| | File storage | > 80% quota | > 95% quota |

### 9.3 Alerting Strategy

```yaml
alerts:
  - name: database_connection_high
    condition: connections > 0.8 * max_connections
    severity: warning
    channels: [slack, email]

  - name: etl_pipeline_failed
    condition: etl_status = 'failed'
    severity: critical
    channels: [slack, email, pagerduty]

  - name: error_rate_spike
    condition: error_rate > 0.05 for 5 minutes
    severity: critical
    channels: [slack, email]
```

---

## 10. Scalability Strategy

### 10.1 Current Scale & Growth Projections

| Metric | Current | Year 1 | Year 3 | Year 5 |
|--------|---------|--------|--------|--------|
| Plants | 2,007 | 5,000 | 15,000 | 50,000 |
| Spare Parts | 458 | 10,000 | 100,000 | 500,000 |
| Users | 0 | 20 | 50 | 200 |
| Locations | 23 | 50 | 100 | 250 |
| API Requests/day | - | 10K | 100K | 1M |
| Database Size | ~50MB | 500MB | 5GB | 50GB |

### 10.2 Scaling Strategy by Phase

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SCALING PHASES                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  PHASE 1: Vertical Scaling (Current → Year 1)                           │
│  ────────────────────────────────────────────                           │
│  • Supabase Pro plan (8GB RAM, 2 CPU)                                   │
│  • Connection pooling (PgBouncer built-in)                              │
│  • Query optimization with indexes                                       │
│  • Materialized views for dashboards                                    │
│  ✓ Handles: 5K plants, 20 users, 10K req/day                           │
│                                                                          │
│  PHASE 2: Optimization (Year 1 → Year 3)                                │
│  ────────────────────────────────────────                               │
│  • Table partitioning (spare_parts by date)                             │
│  • Read replicas for analytics queries                                  │
│  • CDN for static assets                                                │
│  • Client-side caching (TanStack Query)                                 │
│  • API response caching                                                 │
│  ✓ Handles: 15K plants, 50 users, 100K req/day                         │
│                                                                          │
│  PHASE 3: Horizontal Scaling (Year 3+)                                  │
│  ─────────────────────────────────────                                  │
│  • Dedicated PostgreSQL cluster (if needed)                             │
│  • Separate OLTP and OLAP databases                                     │
│  • Redis for session/query caching                                      │
│  • Multiple Edge Function instances                                     │
│  ✓ Handles: 50K+ plants, 200+ users, 1M+ req/day                       │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 10.3 Database Optimization Techniques

```sql
-- 1. Indexes (already partially implemented)
CREATE INDEX CONCURRENTLY idx_plants_fleet_number ON plants(fleet_number);
CREATE INDEX CONCURRENTLY idx_plants_location ON plants(current_location_id);
CREATE INDEX CONCURRENTLY idx_spare_parts_plant ON spare_parts(plant_id);
CREATE INDEX CONCURRENTLY idx_spare_parts_date ON spare_parts(replaced_date);

-- 2. Partial indexes for common queries
CREATE INDEX CONCURRENTLY idx_active_plants
  ON plants(fleet_number) WHERE status = 'active';

-- 3. Table partitioning for spare_parts (when needed)
-- Partition by year for historical data
CREATE TABLE spare_parts_y2026 PARTITION OF spare_parts
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

-- 4. Materialized views for dashboards
CREATE MATERIALIZED VIEW mv_dashboard_stats AS
SELECT
  COUNT(*) FILTER (WHERE status = 'active') as active_plants,
  COUNT(*) FILTER (WHERE physical_verification) as verified_plants,
  (SELECT COUNT(*) FROM spare_parts) as total_parts,
  (SELECT COALESCE(SUM(total_cost), 0) FROM spare_parts) as total_maintenance_cost
FROM plants;

-- Refresh nightly via pg_cron
SELECT cron.schedule('refresh-dashboard', '0 3 * * *',
  'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_stats');
```

---

## 11. Failure Handling & Resilience

### 11.1 Failure Modes & Mitigations

| Failure Mode | Impact | Detection | Mitigation | Recovery |
|--------------|--------|-----------|------------|----------|
| Database down | Complete outage | Health check fails | Supabase auto-recovery | Wait for Supabase |
| API errors | Partial outage | Error rate spike | Retry with backoff | Circuit breaker |
| ETL failure | Stale data | Pipeline status | Alert, manual retry | Idempotent re-run |
| Auth service down | No login | Auth health check | Cached sessions | Wait for recovery |
| Network timeout | Slow/failed requests | Latency metrics | Timeout + retry | Exponential backoff |
| Data corruption | Incorrect data | Validation failures | Backup restore | Point-in-time recovery |

### 11.2 Resilience Patterns

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      RESILIENCE PATTERNS                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. RETRY WITH EXPONENTIAL BACKOFF                                      │
│  ─────────────────────────────────                                      │
│  Attempt 1: Immediate                                                   │
│  Attempt 2: Wait 1s                                                     │
│  Attempt 3: Wait 2s                                                     │
│  Attempt 4: Wait 4s                                                     │
│  Attempt 5: Wait 8s → Give up, alert                                    │
│                                                                          │
│  2. CIRCUIT BREAKER                                                     │
│  ───────────────────                                                    │
│  ┌────────┐     5 failures     ┌────────┐     30s timeout   ┌────────┐ │
│  │ CLOSED │ ─────────────────▶ │  OPEN  │ ─────────────────▶│  HALF  │ │
│  │        │                    │        │                    │  OPEN  │ │
│  └────────┘ ◀───────────────── └────────┘ ◀───────────────── └────────┘ │
│              success                         failure                     │
│                                                                          │
│  3. GRACEFUL DEGRADATION                                                │
│  ───────────────────────                                                │
│  • Analytics down → Show cached data with "stale" indicator             │
│  • AI service down → Disable AI features, show basic search             │
│  • Real-time down → Fall back to polling                                │
│                                                                          │
│  4. IDEMPOTENCY                                                         │
│  ─────────────                                                          │
│  • All mutations have idempotency keys                                  │
│  • ETL pipeline can be safely re-run                                    │
│  • Duplicate requests return same result                                │
│                                                                          │
│  5. BULKHEAD PATTERN                                                    │
│  ───────────────────                                                    │
│  • Separate connection pools for OLTP vs OLAP                           │
│  • Analytics queries can't starve operational queries                   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 11.3 Backup & Disaster Recovery

| Component | Backup Frequency | Retention | RPO | RTO |
|-----------|------------------|-----------|-----|-----|
| Database | Daily (Supabase) | 7 days | 24 hours | 1 hour |
| Point-in-time | Continuous (WAL) | 7 days | Minutes | 1 hour |
| File storage | Daily snapshot | 30 days | 24 hours | 4 hours |
| Configuration | Git (real-time) | Forever | 0 | 15 min |
| Secrets | Vault backup | Daily | 24 hours | 1 hour |

### 11.4 Incident Response

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    INCIDENT RESPONSE RUNBOOK                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  SEVERITY LEVELS                                                        │
│  ───────────────                                                        │
│  P1 (Critical): System down, data loss risk    → Response: 15 min      │
│  P2 (High):     Major feature broken           → Response: 1 hour      │
│  P3 (Medium):   Minor feature broken           → Response: 4 hours     │
│  P4 (Low):      Cosmetic/non-urgent            → Response: Next day    │
│                                                                          │
│  INCIDENT PROCESS                                                       │
│  ────────────────                                                       │
│  1. DETECT    → Automated alert or user report                         │
│  2. TRIAGE    → Assign severity, notify team                           │
│  3. DIAGNOSE  → Check logs, metrics, recent changes                    │
│  4. MITIGATE  → Apply quick fix or rollback                            │
│  5. RESOLVE   → Permanent fix                                          │
│  6. REVIEW    → Post-mortem, update runbooks                           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 12. AI Integration Strategy

### 12.1 AI Use Cases (Prioritized for Your Workflow)

| Use Case | Priority | Complexity | Business Value |
|----------|----------|------------|----------------|
| **Natural Language Queries** | 🔴 High | Medium | Management asks questions in plain English |
| **Intelligent Data Extraction** | 🔴 High | Medium | Handle messy Excel files automatically |
| **Automated Weekly Insights** | 🔴 High | Low | AI-generated summary for management |
| **Anomaly Detection** | 🟡 Medium | Medium | Flag unusual costs, patterns, missing reports |
| **Predictive Maintenance** | 🟡 Medium | High | Predict when parts will need replacement |
| **Report Summarization** | 🟢 Low | Low | Natural language report narratives |

### 12.2 AI Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AI INTEGRATION                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Vector Store (pgvector)                       │   │
│  │  ┌──────────────────────────────────────────────────────────┐   │   │
│  │  │  ai.document_embeddings                                   │   │   │
│  │  │  - id, content_type, content_id                          │   │   │
│  │  │  - content_text, embedding (vector 1536)                 │   │   │
│  │  │  - metadata (JSONB)                                      │   │   │
│  │  └──────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│                                    ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    AI Pipeline                                   │   │
│  │                                                                  │   │
│  │  1. Data Ingestion                                              │   │
│  │     Plant/Part created → Generate embedding → Store in pgvector │   │
│  │                                                                  │   │
│  │  2. Semantic Search                                             │   │
│  │     User query → Embed query → Cosine similarity search         │   │
│  │                                                                  │   │
│  │  3. RAG (Retrieval Augmented Generation)                        │   │
│  │     Query → Retrieve relevant docs → Generate response (LLM)    │   │
│  │                                                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│                                    ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    LLM Integration (Claude)                      │   │
│  │                                                                  │   │
│  │  Edge Function: /functions/v1/ai-query                          │   │
│  │  ┌──────────────────────────────────────────────────────────┐   │   │
│  │  │  1. Parse user query                                      │   │   │
│  │  │  2. Retrieve relevant context from pgvector               │   │   │
│  │  │  3. Build prompt with context                             │   │   │
│  │  │  4. Call Claude API                                       │   │   │
│  │  │  5. Parse response, execute actions                       │   │   │
│  │  │  6. Return results to user                                │   │   │
│  │  └──────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 12.3 Example AI Queries

```
User: "Show me all compressors that haven't been serviced in 6 months"

AI Processing:
1. Parse intent: filter plants, type=compressor, maintenance_date < 6 months ago
2. Generate SQL or use semantic search
3. Return results with explanation

User: "Which plants are likely to need maintenance soon?"

AI Processing:
1. Retrieve maintenance history patterns
2. Apply predictive model (parts lifecycle, usage patterns)
3. Rank by probability
4. Return predictions with confidence scores
```

---

## 13. Technology Stack

### 13.1 Complete Technology Stack

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        TECHNOLOGY STACK                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  FRONTEND                                                               │
│  ─────────                                                              │
│  Framework:     Next.js 14 (App Router)                                 │
│  Language:      TypeScript 5.x                                          │
│  Styling:       Tailwind CSS + shadcn/ui                                │
│  State:         TanStack Query + Zustand (minimal)                      │
│  Forms:         React Hook Form + Zod                                   │
│  Charts:        Recharts or Tremor                                      │
│  Tables:        TanStack Table                                          │
│                                                                          │
│  BACKEND                                                                │
│  ───────                                                                │
│  Platform:      Supabase                                                │
│  Database:      PostgreSQL 15                                           │
│  REST API:      PostgREST (auto-generated)                              │
│  GraphQL:       pg_graphql                                              │
│  Functions:     Supabase Edge Functions (Deno)                          │
│  Auth:          Supabase Auth (GoTrue)                                  │
│  Storage:       Supabase Storage (S3-compatible)                        │
│  Realtime:      Supabase Realtime (WebSockets)                          │
│                                                                          │
│  DATA PIPELINE                                                          │
│  ─────────────                                                          │
│  Language:      Python 3.11+                                            │
│  Framework:     Custom (existing ETL)                                   │
│  Data:          pandas, openpyxl                                        │
│  Scheduling:    pg_cron                                                 │
│                                                                          │
│  AI/ML                                                                  │
│  ─────                                                                  │
│  Vector DB:     pgvector                                                │
│  LLM:           Claude (Anthropic API)                                  │
│  Embeddings:    OpenAI or Voyage AI                                     │
│                                                                          │
│  INFRASTRUCTURE                                                         │
│  ──────────────                                                         │
│  Hosting:       Vercel (frontend) + Supabase (backend)                  │
│  CDN:           Vercel Edge Network                                     │
│  DNS:           Cloudflare (optional)                                   │
│  CI/CD:         GitHub Actions                                          │
│  Version Control: Git + GitHub                                          │
│                                                                          │
│  OBSERVABILITY                                                          │
│  ─────────────                                                          │
│  Logging:       Supabase Logs + structured JSON                         │
│  Metrics:       pg_stat_statements + custom monitoring schema           │
│  Dashboards:    Custom dashboard (existing) + Supabase Dashboard        │
│  Alerts:        Email + Slack (via Edge Functions)                      │
│                                                                          │
│  DEVELOPMENT                                                            │
│  ───────────                                                            │
│  IDE:           VS Code + Cursor                                        │
│  Linting:       ESLint, Prettier, ruff (Python)                         │
│  Testing:       Vitest (frontend), pytest (Python)                      │
│  API Testing:   Thunder Client / Postman                                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 13.2 Why This Stack?

| Choice | Alternatives Considered | Why We Chose This |
|--------|------------------------|-------------------|
| **Supabase** | Firebase, AWS, self-hosted PG | PostgreSQL flexibility, RLS, real-time, generous free tier |
| **Next.js** | Remix, SvelteKit, Vue/Nuxt | Best React ecosystem, Vercel integration, Server Components |
| **TypeScript** | JavaScript | Type safety, better DX, catch errors early |
| **Tailwind** | CSS-in-JS, plain CSS | Utility-first, fast development, consistent design |
| **shadcn/ui** | Material UI, Chakra | Customizable, accessible, copy-paste components |
| **TanStack Query** | SWR, Apollo | Best-in-class caching, devtools, optimistic updates |
| **pgvector** | Pinecone, Weaviate | Same database, no extra service, cost-effective |

---

## 14. Trade-offs & Alternatives

### 14.1 Architecture Trade-offs

| Decision | Trade-off | Why We Accept It |
|----------|-----------|------------------|
| **Modular monolith** | Less isolation than microservices | Simpler ops, can extract later |
| **Supabase** | Vendor lock-in | Postgres is portable, saves ops effort |
| **Same DB for OLTP/OLAP** | Potential resource contention | Scale is small, separate schemas help |
| **Edge Functions** | Cold starts, limited runtime | Good enough for our scale, simple deployment |
| **JWT auth** | Token revocation complexity | Supabase handles refresh, short expiry mitigates |

### 14.2 Alternatives for Future Consideration

```
IF we outgrow current architecture:

Database:
  Current: Single Supabase instance
  Future:  Read replicas → Separate OLAP cluster → Timescale for time-series

Backend:
  Current: Supabase Edge Functions
  Future:  Dedicated Node.js/Go service on Fly.io/Railway

Caching:
  Current: PostgreSQL materialized views
  Future:  Redis/Upstash for session and query caching

Search:
  Current: PostgreSQL full-text + pgvector
  Future:  Typesense/Meilisearch for advanced search

Monitoring:
  Current: Custom dashboard + Supabase
  Future:  Grafana + Prometheus + Loki stack
```

---

## 15. Risks & Mitigations

### 15.1 Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Supabase outage | Low | High | Accept (SLA 99.9%), have manual backup procedure |
| Data loss | Very Low | Critical | Point-in-time recovery, daily backups, audit trail |
| Security breach | Low | Critical | RLS, encryption, audit logs, penetration testing |
| Performance degradation | Medium | Medium | Monitoring, query optimization, scaling plan |
| AI hallucinations | Medium | Low | Human review, confidence scores, guardrails |

### 15.2 Operational Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Key person dependency | High | High | Documentation, runbooks, knowledge sharing |
| Scope creep | Medium | Medium | Clear requirements, phased approach |
| Technical debt | Medium | Medium | Regular refactoring, code reviews |
| Cost overrun | Low | Medium | Monitor usage, optimize queries, set budgets |

### 15.3 Risk Response Matrix

```
┌───────────────┬────────────────────────────────────────────────────────┐
│   Risk Level  │                    Response Strategy                    │
├───────────────┼────────────────────────────────────────────────────────┤
│   CRITICAL    │  Immediate action, escalate, consider rollback         │
│   HIGH        │  Address within 24 hours, notify stakeholders          │
│   MEDIUM      │  Plan mitigation, address in next sprint               │
│   LOW         │  Monitor, add to backlog                               │
└───────────────┴────────────────────────────────────────────────────────┘
```

---

## 16. Implementation Roadmap

### 16.1 Phased Approach

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      IMPLEMENTATION ROADMAP                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  PHASE 1: FOUNDATION (Weeks 1-2)                                        │
│  ───────────────────────────────                                        │
│  □ Enable RLS on all tables                                             │
│  □ Create audit logging infrastructure                                  │
│  □ Set up analytics schema (OLAP)                                       │
│  □ Configure proper indexes                                             │
│  □ Set up CI/CD pipeline                                                │
│  □ Create development branch workflow                                   │
│  Deliverable: Secure, optimized database                                │
│                                                                          │
│  PHASE 2: BACKEND APIs (Weeks 3-4)                                      │
│  ─────────────────────────────────                                      │
│  □ Define RPC functions for complex operations                          │
│  □ Create Edge Functions for business logic                             │
│  □ Set up authentication flow                                           │
│  □ Implement API documentation                                          │
│  □ Add API rate limiting                                                │
│  Deliverable: Working API layer                                         │
│                                                                          │
│  PHASE 3: FRONTEND MVP (Weeks 5-8)                                      │
│  ─────────────────────────────────                                      │
│  □ Set up Next.js project structure                                     │
│  □ Implement authentication UI                                          │
│  □ Build dashboard with key metrics                                     │
│  □ Create plants CRUD interface                                         │
│  □ Create spare parts management                                        │
│  □ Build location tracking views                                        │
│  □ Implement search and filtering                                       │
│  Deliverable: Usable web application                                    │
│                                                                          │
│  PHASE 4: DATA WAREHOUSE (Weeks 9-10)                                   │
│  ─────────────────────────────────────                                  │
│  □ Create star schema tables                                            │
│  □ Build OLTP → OLAP ETL pipeline                                       │
│  □ Create materialized views                                            │
│  □ Schedule automated refreshes                                         │
│  Deliverable: Analytics-ready data warehouse                            │
│                                                                          │
│  PHASE 5: REPORTING & ANALYTICS (Weeks 11-12)                           │
│  ─────────────────────────────────────────────                          │
│  □ Build analytics dashboard                                            │
│  □ Create report generation (PDF/Excel)                                 │
│  □ Implement scheduled reports                                          │
│  □ Add export functionality                                             │
│  Deliverable: Business intelligence capabilities                        │
│                                                                          │
│  PHASE 6: AI INTEGRATION (Weeks 13-16)                                  │
│  ─────────────────────────────────────                                  │
│  □ Enable pgvector extension                                            │
│  □ Build embedding pipeline                                             │
│  □ Implement semantic search                                            │
│  □ Create AI query interface                                            │
│  □ Add predictive maintenance (v1)                                      │
│  Deliverable: AI-powered features                                       │
│                                                                          │
│  PHASE 7: HARDENING (Weeks 17-18)                                       │
│  ─────────────────────────────────                                      │
│  □ Performance optimization                                             │
│  □ Security audit                                                       │
│  □ Load testing                                                         │
│  □ Documentation completion                                             │
│  □ Runbook creation                                                     │
│  Deliverable: Production-ready system                                   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 16.2 Success Criteria

| Phase | Success Criteria |
|-------|------------------|
| Phase 1 | All tables have RLS, audit logs capture all changes |
| Phase 2 | API response time < 200ms p95, auth working |
| Phase 3 | Users can perform all CRUD operations via UI |
| Phase 4 | Analytics queries run < 5s, data fresh within 24h |
| Phase 5 | Reports generate correctly, scheduled delivery works |
| Phase 6 | AI search returns relevant results, predictions > 70% accurate |
| Phase 7 | Pass security audit, handle 50 concurrent users |

---

## Appendix A: Decision Log

| Date | Decision | Rationale | Alternatives Rejected |
|------|----------|-----------|----------------------|
| 2026-02-02 | Hybrid backend (FastAPI + Supabase) | Single language (Python) for ETL, API, AI | Supabase-only (TypeScript for Edge Functions) |
| 2026-02-02 | Supabase for DB/Auth/Storage | Postgres + managed services | Self-hosted (ops overhead) |
| 2026-02-02 | Next.js | React ecosystem, SSR, Vercel | Remix, SvelteKit |
| 2026-02-02 | Same DB for OLTP/OLAP | Scale is small, simpler | Separate DW (premature) |
| 2026-02-02 | Upload portal with passcode | Simple for site officers, no accounts needed | Full user accounts (over-engineered) |
| 2026-02-02 | In-app notifications | Plant officer workflow, always in dashboard | Email (may miss), SMS (cost) |
| 2026-02-02 | Keep historical report files | Audit trail, reprocessing capability | Discard after extraction |
| 2026-02-02 | Railway for deployment | Simple, good free tier, Python support | Render, Fly.io, self-hosted |

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| OLTP | Online Transaction Processing - optimized for writes |
| OLAP | Online Analytical Processing - optimized for reads |
| RLS | Row-Level Security - database access control |
| CDC | Change Data Capture - tracking data changes |
| SCD | Slowly Changing Dimension - dimension versioning |
| RPO | Recovery Point Objective - max acceptable data loss |
| RTO | Recovery Time Objective - max acceptable downtime |
| ETL | Extract, Transform, Load - data pipeline pattern |
| RAG | Retrieval Augmented Generation - AI pattern |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-02 | Claude + Ram | Initial draft |

---

**Next Steps:**
1. Review this architecture with stakeholders
2. Validate assumptions and requirements
3. Prioritize features for Phase 1
4. Begin implementation

