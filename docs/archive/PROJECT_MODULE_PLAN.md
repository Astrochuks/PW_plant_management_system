# PW Central Reporting System — Project Module Plan

## Overview

Expanding from Plant Management System to a Central Reporting System with two modules:
1. **Plant & Equipment** (existing) — fleet management, maintenance, spare parts, transfers
2. **Projects** (new) — construction project tracking, weekly reports, financials, resource allocation

## Data Sources

| File | Type | Data |
|---|---|---|
| Weekly Progress Reports (16 sheets) | Per-project, per-week | Contract details, works completed, costs, plant utilization, diesel, materials, labour, subcontractors, certificates, payments |
| Individual Site Output | Yearly summary | Monthly output amounts per project site |
| Award Letters & Completion Certs | Project portfolio | All awarded projects by client/state with lifecycle milestones |
| Weekly Plant Reports (existing ETL) | Per-location, per-week | Fleet status, hours, remarks — already in system |

## Bridge Between Modules

Plant Return sheet in Weekly Progress Reports uses same fleet numbers as `plants_master`. This is the join point.

## Frontend Restructure

### Sidebar Navigation
```
OVERVIEW
  Dashboard (unified hub)

PLANT & EQUIPMENT
  Fleet Register (was "Plants")
  Spare Parts
  Purchase Orders
  Transfers
  Plant Analytics

PROJECTS
  Project Registry (replaces Award Letters Excel)
  Weekly Reports (upload + browse)
  Project Analytics

SHARED
  Sites (locations)
  Suppliers
  Reports (combined hub)

ADMINISTRATION
  Upload
  Users & Roles
  States
  Audit Log
```

### New Pages
- `/projects` — registry list, search/filter by client, state, status
- `/projects/[id]` — project dashboard with tabs: Summary, Costs, Plant, Materials, Labour, Subcontractors, Certificates, Weekly Log
- `/projects/[id]/weekly/[week]` — weekly report detail
- `/projects/create` — create from award data
- `/projects/[id]/edit` — edit details/milestones
- `/projects/reports` — upload + browse reports
- `/projects/analytics` — cross-project analytics

### Role Redesign
| Role | Plant Module | Projects Module | Admin |
|---|---|---|---|
| `admin` | Full CRUD | Full CRUD | Full access |
| `plant_manager` | Full access | Hidden | No |
| `project_manager` | Hidden | Full access | No |
| `manager` | Full access | Full access | No |
| `viewer` | Read-only all | Read-only all | No |

## Database — New Tables
- `projects` — registry
- `project_contracts` — amounts, dates, variations
- `project_weekly_reports` — report header
- `project_works_completed` — BEME items per week
- `project_costs` — cost by category per week
- `project_plant_returns` — plant utilization (FK to plants_master)
- `project_diesel_consumption` — daily diesel per plant
- `project_materials` — material stock tracking
- `project_labour` — headcount per department
- `project_subcontractors` — sub work per week
- `project_certificates` — payment certificates
- `project_payments` — received payments
- `project_hired_vehicles` — hired vehicle costs
- `project_milestones` — award, completion, maintenance, retention dates

## New ETL Pipelines
1. Weekly Progress Report Parser — 16-sheet Excel → project tables
2. Award Letters Importer — one-time import + ongoing CRUD

## Key Principle
No existing pages break. Plant module stays as-is. We add alongside.
