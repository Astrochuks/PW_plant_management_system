# Plant Management System - API Documentation

> Base URL: `/api/v1`
> Authentication: Bearer token via `Authorization: Bearer <access_token>` header
> All responses follow: `{ "success": bool, "data": ..., "meta"?: ... }`

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Plants](#2-plants)
3. [Common Patterns](#common-patterns)

---

## 1. Authentication

**Prefix:** `/api/v1/auth`

### Roles

| Role | Description |
|------|-------------|
| `admin` | Full access. Can create/update/delete plants, manage users, view audit logs. |
| `management` | Read-only access to plants, reports, and analytics. |

### 1.1 Login

```
POST /auth/login
```

**Auth:** None

**Body:**
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `email` | string (email) | Yes | |
| `password` | string | Yes | Min 8 chars |

**Response:**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "abc123...",
  "token_type": "bearer",
  "expires_in": 3600,
  "user": {
    "id": "ff86ca12-...",
    "email": "user@example.com",
    "role": "admin",
    "full_name": "John Doe",
    "must_change_password": false
  }
}
```

**Notes:**
- Access token expires in 1 hour
- Store `refresh_token` securely for silent refresh
- If `must_change_password` is `true`, redirect to password change screen
- Account locks after 5 failed attempts (admin can unlock)

### 1.2 Refresh Token

```
POST /auth/refresh
```

**Auth:** None

**Body:**
| Field | Type | Required |
|-------|------|----------|
| `refresh_token` | string | Yes |

**Response:** Same as Login

### 1.3 Logout

```
POST /auth/logout
```

**Auth:** Any authenticated user

**Response:** `{ "success": true }`

### 1.4 Get Current User

```
GET /auth/me
```

**Auth:** Any authenticated user

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "ff86ca12-...",
    "email": "user@example.com",
    "role": "admin",
    "full_name": "John Doe",
    "is_admin": true
  }
}
```

### 1.5 Update Profile

```
PATCH /auth/me
```

**Auth:** Any authenticated user

**Body:**
| Field | Type | Required |
|-------|------|----------|
| `full_name` | string | Yes (2-255 chars) |

### 1.6 Change Password

```
POST /auth/change-password
```

**Auth:** Any authenticated user

**Body:**
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `current_password` | string | Yes | |
| `new_password` | string | Yes | Min 12 chars, 1 uppercase, 1 lowercase, 1 digit |

### 1.7 Create User

```
POST /auth/users
```

**Auth:** Admin only | **Status:** 201

**Body:**
| Field | Type | Required | Default |
|-------|------|----------|---------|
| `email` | string (email) | Yes | |
| `password` | string | Yes | Min 12 chars, complexity rules |
| `full_name` | string | Yes | 2-255 chars |
| `role` | string | No | `"management"` |

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "new@example.com",
    "full_name": "New User",
    "role": "management",
    "is_active": true
  }
}
```

### 1.8 List Users

```
GET /auth/users
```

**Auth:** Admin only

**Query params:**
| Param | Type | Notes |
|-------|------|-------|
| `role` | string | `admin` or `management` |
| `is_active` | boolean | |

### 1.9 Get / Update / Deactivate User

```
GET    /auth/users/{user_id}
PATCH  /auth/users/{user_id}          # Body: { full_name?, role?, is_active? }
DELETE /auth/users/{user_id}          # Soft deactivate
POST   /auth/users/{user_id}/reset-password  # Body: { new_password }
```

**Auth:** Admin only

### 1.10 Auth Events (Audit)

```
GET /auth/events
```

**Auth:** Admin only

**Query params:**
| Param | Type | Notes |
|-------|------|-------|
| `user_id` | UUID | |
| `email` | string | Partial match |
| `event_type` | string | `login_success\|login_failed\|logout\|password_changed\|...` |
| `start_date` | string | ISO date |
| `end_date` | string | ISO date |
| `page` | int | Default 1 |
| `limit` | int | Default 50, max 100 |

### 1.11 Login Attempts

```
GET /auth/login-attempts
```

**Auth:** Admin only

**Query params:** `email`, `ip_address`, `success` (bool), `page`, `limit`

### 1.12 Lockouts

```
GET  /auth/lockouts                          # List active lockouts
POST /auth/lockouts/{lockout_id}/unlock      # Unlock account
```

**Auth:** Admin only

---

## 2. Plants

**Prefix:** `/api/v1/plants`

### Status Values

All plant status fields use these values:

```
working | standby | breakdown | faulty | scrap | missing | stolen | unverified | in_transit | off_hire
```

### 2.1 List Plants

```
GET /plants
```

**Auth:** Management or Admin

**Query params:**
| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `page` | int | 1 | Min 1 |
| `limit` | int | 20 | 1-100 |
| `status` | string | - | See status values above |
| `location_id` | UUID | - | Filter by current location |
| `fleet_type` | string | - | Partial match (e.g. `TRUCK`) |
| `search` | string | - | Searches fleet_number + description |
| `verified_only` | bool | false | Only physically verified plants |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "fleet_number": "T385",
      "description": "TRUCKS",
      "fleet_type": "TRUCKS",
      "make": "MERCEDES BENZ",
      "model": "ACTROS",
      "status": "working",
      "physical_verification": true,
      "current_location": "ABUJA",
      "current_location_id": "uuid",
      "total_maintenance_cost": 15000.00,
      "parts_replaced_count": 3,
      "last_maintenance_date": "2025-06-15"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1601,
    "total_pages": 81
  }
}
```

### 2.2 Get Plant by ID

```
GET /plants/{plant_id}
```

**Auth:** Management or Admin

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "fleet_number": "T385",
    "description": "TRUCKS",
    "fleet_type": "TRUCKS",
    "make": "MERCEDES BENZ",
    "model": "ACTROS",
    "chassis_number": "WDB123456",
    "year_of_manufacture": 2018,
    "purchase_cost": 50000.00,
    "serial_m": null,
    "serial_e": null,
    "status": "working",
    "physical_verification": true,
    "current_location_id": "uuid",
    "remarks": null,
    "created_at": "2025-01-01T00:00:00Z",
    "updated_at": "2025-06-15T00:00:00Z"
  }
}
```

### 2.3 Create Plant

```
POST /plants
```

**Auth:** Admin only | **Status:** 201

**Body (PlantCreate):**
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `fleet_number` | string | **Yes** | Unique. Auto-uppercased. |
| `description` | string | No | Max 255 chars |
| `fleet_type` | string | No | **Auto-resolved from fleet number prefix** if not provided (e.g. `AC10` -> `AIR COMPRESSOR`) |
| `make` | string | No | Max 100 |
| `model` | string | No | Max 100 |
| `chassis_number` | string | No | Max 100 |
| `year_of_manufacture` | int | No | 1900-2100 |
| `purchase_cost` | float | No | >= 0 |
| `serial_m` | string | No | M serial number |
| `serial_e` | string | No | E serial number |
| `remarks` | string | No | |
| `current_location_id` | UUID | No | Creates initial location history entry |

**Notes:**
- `fleet_type` is auto-resolved from the fleet number prefix using the `fleet_number_prefixes` lookup table (79 known prefixes). Only set manually if the prefix is unknown.
- If `current_location_id` is provided, an initial `plant_location_history` record is created automatically.

### 2.4 Update Plant

```
PATCH /plants/{plant_id}
```

**Auth:** Admin only

**Body (PlantUpdate):** All fields optional. Only provided fields are updated.
| Field | Type | Notes |
|-------|------|-------|
| `description` | string | |
| `fleet_type` | string | |
| `make` | string | |
| `model` | string | |
| `chassis_number` | string | |
| `year_of_manufacture` | int | 1900-2100 |
| `purchase_cost` | float | >= 0 |
| `serial_m` | string | |
| `serial_e` | string | |
| `remarks` | string | |
| `current_location_id` | UUID | Does NOT create location history. Use transfer endpoint instead. |
| `status` | string | Must be a valid status value |
| `physical_verification` | bool | |

### 2.5 Delete Plant

```
DELETE /plants/{plant_id}
```

**Auth:** Admin only

**Response:** `{ "success": true, "message": "Plant T385 deleted successfully" }`

**Notes:** Full record is captured in audit log before deletion.

### 2.6 Transfer Plant

```
POST /plants/{plant_id}/transfer
```

**Auth:** Admin only

**Body (PlantTransferRequest):**
| Field | Type | Required |
|-------|------|----------|
| `new_location_id` | UUID | Yes |
| `transfer_reason` | string | No |

**Response:**
```json
{
  "success": true,
  "data": {
    "success": true,
    "from_location": "ABUJA",
    "to_location": "LAGOS",
    "transfer_date": "2026-02-05T10:30:00Z"
  }
}
```

**Notes:**
- Closes the current location history record (sets `end_date`)
- Creates a new location history record at the new location
- Creates a `transfer` event in `plant_events`
- Updates `current_location_id` on the plant

### 2.7 Search Plants (Full-text)

```
GET /plants/search/{query}
```

**Auth:** Management or Admin

**Query params:**
| Param | Type | Notes |
|-------|------|-------|
| `status` | string | |
| `location_id` | UUID | |
| `fleet_type` | string | Partial match |
| `limit` | int | Default 20, max 100 |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "fleet_number": "P402",
      "description": "PICK-UPS",
      "fleet_type": "PICK-UPS",
      "make": "TOYOTA",
      "model": "HILUX",
      "status": "working",
      "current_location": "ABUJA",
      "physical_verification": true,
      "total_maintenance_cost": 5000.00,
      "rank": 0.85
    }
  ],
  "meta": { "query": "p402", "count": 1 }
}
```

**Notes:** Uses PostgreSQL full-text search with ILIKE fallback. Results ranked by relevance.

### 2.8 Fleet Utilization

```
GET /plants/utilization
```

**Auth:** Management or Admin

**Query params:**
| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `page` | int | 1 | |
| `limit` | int | 20 | 1-100 |
| `location_id` | UUID | - | |
| `fleet_type` | string | - | Partial match |
| `status` | string | - | |
| `search` | string | - | fleet_number or description |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "fleet_number": "T385",
      "description": "TRUCKS",
      "fleet_type": "TRUCKS",
      "status": "working",
      "current_location": "ABUJA",
      "current_location_id": "uuid",
      "total_hours_worked": 1200.5,
      "total_standby_hours": 300.0,
      "total_breakdown_hours": 50.0,
      "total_maintenance_cost": 15000.00,
      "weeks_tracked": 52
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1601, "total_pages": 81 }
}
```

**Notes:** Data sourced from `v_plant_utilization` view (joins plants_master + plant_weekly_records + spare_parts).

### 2.9 Usage Summary

```
GET /plants/usage/summary
```

**Auth:** Management or Admin

**Query params:**
| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `page` | int | 1 | |
| `limit` | int | 20 | 1-100 |
| `year` | int | - | e.g. 2025 |
| `month` | int | - | 1-12 |
| `week_number` | int | - | 1-53 |
| `location_id` | UUID | - | |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "plant_id": "uuid",
      "fleet_number": "T385",
      "description": "TRUCKS",
      "period_label": "2025-W05",
      "hours_worked": 45.0,
      "standby_hours": 10.0,
      "breakdown_hours": 0.0,
      "utilization_rate": 81.82,
      "weeks_tracked": 1,
      "weeks_breakdown": 0,
      "weeks_off_hire": 0
    }
  ],
  "meta": {
    "page": 1, "limit": 20, "total": 500, "total_pages": 25,
    "year": 2025, "month": null, "week_number": 5
  }
}
```

**Filter combinations:**
| Params | Result |
|--------|--------|
| *(none)* | All time totals per plant |
| `year=2025` | All weeks in 2025 summed per plant |
| `year=2025&month=6` | June 2025 only |
| `year=2025&week_number=5` | Single week snapshot |

### 2.10 Breakdown Report

```
GET /plants/usage/breakdowns
```

**Auth:** Management or Admin

**Query params:** `year`, `week_number` (1-53), `location_id`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "plant_id": "uuid",
      "fleet_number": "E12",
      "description": "EXCAVATOR",
      "location_name": "ABUJA",
      "year": 2025,
      "week_number": 12,
      "week_ending_date": "2025-03-22",
      "breakdown_hours": 24.0,
      "remarks": "Engine failure"
    }
  ]
}
```

**Notes:** Only returns plants with `breakdown_hours > 0`. Empty if no breakdowns recorded.

### 2.11 Plant Events

```
GET /plants/events
```

**Auth:** Management or Admin

**Query params:**
| Param | Type | Notes |
|-------|------|-------|
| `event_type` | string | `movement\|missing\|new\|returned\|verification_failed` |
| `plant_id` | UUID | |
| `location_id` | UUID | |
| `acknowledged` | bool | |
| `page` | int | Default 1 |
| `limit` | int | Default 20, max 100 |

### 2.12 Acknowledge Event

```
PATCH /plants/events/{event_id}/acknowledge
```

**Auth:** Admin only

**Query params:** `remarks` (optional string)

### 2.13 Plant Maintenance History

```
GET /plants/{plant_id}/maintenance-history
```

**Auth:** Management or Admin

**Query params:** `limit` (default 50, max 200)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "replaced_date": "2025-03-15",
      "part_number": "FLT-001",
      "part_description": "OIL FILTER",
      "supplier": "AUTO PARTS LTD",
      "reason_for_change": "Routine replacement",
      "unit_cost": 150.00,
      "quantity": 2,
      "total_cost": 300.00,
      "purchase_order_number": "PO-2025-001",
      "remarks": null
    }
  ]
}
```

### 2.14 Plant Location History

```
GET /plants/{plant_id}/location-history
```

**Auth:** Management or Admin

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "location_id": "uuid",
      "location_name": "LAGOS",
      "start_date": "2025-06-01T00:00:00Z",
      "end_date": null,
      "duration_days": 250,
      "transfer_reason": "Project assignment"
    },
    {
      "id": "uuid",
      "location_id": "uuid",
      "location_name": "ABUJA",
      "start_date": "2025-01-01T00:00:00Z",
      "end_date": "2025-06-01T00:00:00Z",
      "duration_days": 151,
      "transfer_reason": "Initial assignment"
    }
  ]
}
```

**Notes:** Ordered by `start_date DESC` (most recent first). `end_date = null` means the plant is currently at that location.

### 2.15 Plant Weekly Records

```
GET /plants/{plant_id}/weekly-records
```

**Auth:** Management or Admin

**Query params:** `year` (optional), `limit` (default 52, max 200)

### 2.16 Single Plant Events

```
GET /plants/{plant_id}/events
```

**Auth:** Management or Admin

**Query params:** `limit` (default 50, max 200)

### 2.17 Single Plant Usage

```
GET /plants/{plant_id}/usage
```

**Auth:** Management or Admin

**Query params:** `year`, `month` (1-12)

---

## Common Patterns

### Authentication Header

All authenticated requests require:
```
Authorization: Bearer <access_token>
```

If you get `401`, refresh the token using `POST /auth/refresh`.

### Pagination

Paginated endpoints return:
```json
{
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1601,
    "total_pages": 81
  }
}
```

Use `page` and `limit` query params. Page is 1-indexed.

### Error Responses

**401 Unauthorized:**
```json
{
  "success": false,
  "error": { "code": "AUTHENTICATION_ERROR", "message": "Invalid or expired token" }
}
```

**403 Forbidden:**
```json
{
  "success": false,
  "error": { "code": "AUTHORIZATION_ERROR", "message": "Admin access required" }
}
```

**404 Not Found:**
```json
{
  "success": false,
  "error": { "code": "NOT_FOUND", "message": "Plant not found", "resource": "Plant", "resource_id": "uuid" }
}
```

**422 Validation Error:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Plant with this fleet number already exists",
    "details": [{ "field": "fleet_number", "message": "Already exists", "code": "DUPLICATE" }]
  }
}
```

**500 Internal Error:**
```json
{
  "success": false,
  "error": { "code": "INTERNAL_ERROR", "message": "An unexpected error occurred", "request_id": "abc123" }
}
```

### Fleet Number Prefix -> Fleet Type Mapping

When creating a plant, `fleet_type` is auto-resolved from the fleet number prefix. Common mappings:

| Prefix | Fleet Type | Example |
|--------|-----------|---------|
| T | TRUCKS | T385 |
| P | PICK-UPS | P402 |
| E | EXCAVATOR | E12 |
| EG | ELECTRIC GENERATOR | EG55 |
| WP | WATER PUMP | WP399 |
| VPE | VIBRATING POCKER ENGINE | VPE102 |
| AC | AIR COMPRESSOR | AC10 |
| D | DOZERS | D15 |
| G | GRADER | G8 |
| L | PAY-LOADERS | L22 |
| RD | DUMP TRUCKS | RD30 |
| VR | VIBRATING ROLLER | VR45 |
| W | WELDER | W60 |

Full list: 79 prefixes in the `fleet_number_prefixes` table.

---

*This document covers the **Auth** and **Plants** modules. Additional modules (Uploads, Locations, Fleet Types, Spare Parts, Reports, Audit) will be documented as they are tested.*
