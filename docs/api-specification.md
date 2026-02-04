# API Specification

## Base URL
```
Production: https://api.pwplants.com/api/v1
Development: http://localhost:8000/api/v1
```

---

## Authentication

All endpoints require JWT Bearer token (except login/register).

```
Authorization: Bearer <jwt_token>
```

---

## Endpoints

### 1. Reports

#### POST `/reports/upload`
Upload a weekly report Excel file.

**Request:**
```
Content-Type: multipart/form-data

file: <weekly_report.xlsx>        (required)
location_id: <uuid>               (optional - override auto-detected location)
```

**Response (202 Accepted):**
```json
{
    "success": true,
    "data": {
        "submission_id": "uuid-here",
        "status": "processing",
        "message": "File uploaded, processing started"
    }
}
```

**Response (400 Bad Request):**
```json
{
    "success": false,
    "error": {
        "code": "INVALID_FILE",
        "message": "File must be an Excel file (.xlsx)"
    }
}
```

---

#### GET `/reports/status/{submission_id}`
Check upload processing status.

**Response (200 OK):**
```json
{
    "success": true,
    "data": {
        "submission_id": "uuid-here",
        "filename": "ABUJA WEEK 5.xlsx",
        "status": "completed",
        "location": {
            "id": "uuid",
            "name": "ABUJA"
        },
        "week_ending_date": "2026-02-01",
        "year": 2026,
        "week_number": 5,
        "stats": {
            "plants_processed": 661,
            "plants_created": 3,
            "plants_updated": 658,
            "plants_migrated": 0,
            "location_changes": 5
        },
        "started_at": "2026-02-01T10:00:00Z",
        "completed_at": "2026-02-01T10:00:12Z",
        "processing_time_seconds": 12
    }
}
```

**Status Values:**
| Status | Description |
|--------|-------------|
| pending | Queued for processing |
| processing | Currently being processed |
| completed | Successfully processed |
| failed | Error occurred |

---

#### GET `/reports/submissions`
List all report submissions.

**Query Parameters:**
```
location_id: uuid     (optional - filter by location)
status: string        (optional - pending, processing, completed, failed)
year: integer         (optional)
week_number: integer  (optional)
page: integer         (default: 1)
limit: integer        (default: 20, max: 100)
```

**Response (200 OK):**
```json
{
    "success": true,
    "data": {
        "submissions": [
            {
                "id": "uuid",
                "filename": "ABUJA WEEK 5.xlsx",
                "location": {
                    "id": "uuid",
                    "name": "ABUJA"
                },
                "status": "completed",
                "week_ending_date": "2026-02-01",
                "plants_processed": 661,
                "uploaded_by": {
                    "id": "uuid",
                    "name": "John Doe"
                },
                "created_at": "2026-02-01T10:00:00Z"
            }
        ],
        "pagination": {
            "page": 1,
            "limit": 20,
            "total": 45,
            "total_pages": 3
        }
    }
}
```

---

### 2. Plants

#### GET `/plants`
List all plants with filtering.

**Query Parameters:**
```
location_id: uuid       (optional)
status: string          (optional - working, standby, breakdown, etc.)
fleet_type: string      (optional)
search: string          (optional - search fleet_number, description)
verified: boolean       (optional - physical_verification status)
page: integer           (default: 1)
limit: integer          (default: 50, max: 200)
sort_by: string         (default: fleet_number)
sort_order: string      (default: asc)
```

**Response (200 OK):**
```json
{
    "success": true,
    "data": {
        "plants": [
            {
                "id": "uuid",
                "fleet_number": "T100",
                "description": "WATER TANKER",
                "fleet_type": "TRUCKS",
                "make": "MAN",
                "model": "TGS",
                "location": {
                    "id": "uuid",
                    "name": "ABUJA"
                },
                "status": "working",
                "status_remarks": "Keyword 'working' found in remarks",
                "physical_verification": true,
                "last_verified_date": "2026-02-01",
                "last_verified_week": 5,
                "remarks": "Working, serviced"
            }
        ],
        "pagination": {
            "page": 1,
            "limit": 50,
            "total": 1599,
            "total_pages": 32
        }
    }
}
```

---

#### GET `/plants/{fleet_number}`
Get single plant details.

**Response (200 OK):**
```json
{
    "success": true,
    "data": {
        "plant": {
            "id": "uuid",
            "fleet_number": "T100",
            "description": "WATER TANKER",
            "fleet_type": "TRUCKS",
            "make": "MAN",
            "model": "TGS",
            "chassis_number": "ABC123",
            "year_of_manufacture": 2018,
            "purchase_cost": 25000000.00,
            "serial_m": null,
            "serial_e": null,
            "location": {
                "id": "uuid",
                "name": "ABUJA"
            },
            "status": "working",
            "status_remarks": "Keyword 'working' found in remarks",
            "physical_verification": true,
            "last_verified_date": "2026-02-01",
            "last_verified_week": 5,
            "remarks": "Working, serviced",
            "created_at": "2026-01-25T00:00:00Z",
            "updated_at": "2026-02-01T10:00:00Z"
        }
    }
}
```

---

#### GET `/plants/{fleet_number}/history`
Get plant location history.

**Response (200 OK):**
```json
{
    "success": true,
    "data": {
        "fleet_number": "T100",
        "current_location": "ABUJA",
        "history": [
            {
                "location": {
                    "id": "uuid",
                    "name": "ABUJA"
                },
                "start_date": "2026-02-01",
                "end_date": null,
                "is_current": true,
                "duration_days": 3
            },
            {
                "location": {
                    "id": "uuid",
                    "name": "JOS, ZARIA RD"
                },
                "start_date": "2026-01-25",
                "end_date": "2026-02-01",
                "is_current": false,
                "duration_days": 7
            }
        ]
    }
}
```

---

#### GET `/plants/{fleet_number}/weekly`
Get plant weekly records.

**Query Parameters:**
```
year: integer     (optional - default current year)
limit: integer    (optional - default 10)
```

**Response (200 OK):**
```json
{
    "success": true,
    "data": {
        "fleet_number": "T100",
        "records": [
            {
                "year": 2026,
                "week_number": 5,
                "week_ending_date": "2026-02-01",
                "location": {
                    "id": "uuid",
                    "name": "ABUJA"
                },
                "physical_verification": true,
                "remarks": "Working, serviced",
                "hours_worked": 45.5,
                "standby_hours": 0,
                "breakdown_hours": 0,
                "off_hire": false
            },
            {
                "year": 2026,
                "week_number": 4,
                "week_ending_date": "2026-01-25",
                "location": {
                    "id": "uuid",
                    "name": "JOS, ZARIA RD"
                },
                "physical_verification": true,
                "remarks": "Working",
                "hours_worked": 52.0,
                "standby_hours": 0,
                "breakdown_hours": 0,
                "off_hire": false
            }
        ]
    }
}
```

---

### 3. Locations

#### GET `/locations`
List all locations.

**Response (200 OK):**
```json
{
    "success": true,
    "data": {
        "locations": [
            {
                "id": "uuid",
                "name": "ABUJA",
                "plant_count": 649,
                "created_at": "2026-01-25T00:00:00Z"
            },
            {
                "id": "uuid",
                "name": "JOS, ZARIA RD",
                "plant_count": 93,
                "created_at": "2026-01-25T00:00:00Z"
            }
        ],
        "total": 27
    }
}
```

---

#### GET `/locations/{location_id}/plants`
Get plants at a specific location.

**Query Parameters:**
```
status: string     (optional)
fleet_type: string (optional)
page: integer      (default: 1)
limit: integer     (default: 50)
```

**Response (200 OK):**
```json
{
    "success": true,
    "data": {
        "location": {
            "id": "uuid",
            "name": "ABUJA"
        },
        "summary": {
            "total": 649,
            "by_status": {
                "working": 450,
                "standby": 100,
                "breakdown": 30,
                "faulty": 40,
                "missing": 20,
                "scrap": 9
            },
            "verification_rate": 85.2
        },
        "plants": [
            {
                "fleet_number": "T100",
                "fleet_type": "TRUCKS",
                "status": "working",
                "physical_verification": true,
                "last_verified_date": "2026-02-01"
            }
        ],
        "pagination": {
            "page": 1,
            "limit": 50,
            "total": 649,
            "total_pages": 13
        }
    }
}
```

---

### 4. Fleet Types

#### GET `/fleet-types`
List all fleet types with counts.

**Response (200 OK):**
```json
{
    "success": true,
    "data": {
        "fleet_types": [
            {
                "prefix": "T",
                "fleet_type": "TRUCKS",
                "plant_count": 276,
                "example": "T100"
            },
            {
                "prefix": "WP",
                "fleet_type": "WATER PUMP",
                "plant_count": 260,
                "example": "WP50"
            },
            {
                "prefix": "EG",
                "fleet_type": "ELECTRIC GENERATOR",
                "plant_count": 151,
                "example": "EG100"
            }
        ],
        "total": 78
    }
}
```

---

### 5. Dashboard / Analytics

#### GET `/dashboard/summary`
Get dashboard summary statistics.

**Response (200 OK):**
```json
{
    "success": true,
    "data": {
        "total_plants": 1599,
        "total_locations": 27,
        "status_summary": {
            "working": 784,
            "standby": 232,
            "missing": 185,
            "unverified": 145,
            "faulty": 133,
            "scrap": 70,
            "breakdown": 48,
            "in_transit": 1,
            "stolen": 1
        },
        "verification_rate": 78.5,
        "latest_week": {
            "year": 2026,
            "week_number": 5,
            "week_ending_date": "2026-02-01",
            "reports_submitted": 27,
            "plants_verified": 1450
        },
        "top_locations": [
            {"name": "ABUJA", "plant_count": 649},
            {"name": "JOS, ZARIA RD", "plant_count": 93},
            {"name": "BUA CEMENT-OKPELLA", "plant_count": 95}
        ]
    }
}
```

---

#### GET `/dashboard/trends`
Get trend data for charts.

**Query Parameters:**
```
metric: string       (required - plants, status, verification)
period: string       (optional - week, month, quarter; default: week)
weeks: integer       (optional - number of weeks to include; default: 12)
location_id: uuid    (optional - filter by location)
```

**Response (200 OK):**
```json
{
    "success": true,
    "data": {
        "metric": "status",
        "period": "week",
        "data": [
            {
                "year": 2026,
                "week": 5,
                "week_ending": "2026-02-01",
                "working": 784,
                "standby": 232,
                "breakdown": 48,
                "verification_rate": 78.5
            },
            {
                "year": 2026,
                "week": 4,
                "week_ending": "2026-01-25",
                "working": 750,
                "standby": 220,
                "breakdown": 55,
                "verification_rate": 75.2
            }
        ]
    }
}
```

---

## Error Response Format

All errors follow this format:

```json
{
    "success": false,
    "error": {
        "code": "ERROR_CODE",
        "message": "Human readable message",
        "details": {}  // Optional additional info
    }
}
```

**Common Error Codes:**
| Code | HTTP Status | Description |
|------|-------------|-------------|
| UNAUTHORIZED | 401 | Invalid or missing token |
| FORBIDDEN | 403 | Insufficient permissions |
| NOT_FOUND | 404 | Resource not found |
| VALIDATION_ERROR | 422 | Invalid input data |
| INVALID_FILE | 400 | Invalid file upload |
| PROCESSING_ERROR | 500 | ETL processing failed |
| RATE_LIMITED | 429 | Too many requests |

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| POST /reports/upload | 10 per minute |
| GET endpoints | 100 per minute |
| Dashboard endpoints | 30 per minute |

---

## Websocket (Real-time Updates)

### Connection
```
wss://api.pwplants.com/ws?token=<jwt_token>
```

### Events

**Upload Progress:**
```json
{
    "event": "upload_progress",
    "data": {
        "submission_id": "uuid",
        "status": "processing",
        "progress": 45,
        "plants_processed": 300,
        "total_plants": 661
    }
}
```

**Upload Complete:**
```json
{
    "event": "upload_complete",
    "data": {
        "submission_id": "uuid",
        "status": "completed",
        "stats": {
            "plants_processed": 661,
            "plants_created": 3,
            "plants_updated": 658
        }
    }
}
```
