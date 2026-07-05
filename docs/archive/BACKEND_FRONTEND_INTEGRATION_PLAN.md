# Backend-Frontend Integration Plan

## Overview

This document maps all **new backend endpoints** (from the preview-based upload system) to frontend implementation with detailed request/response structures, UI components needed, and data flow.

---

## NEW BACKEND ENDPOINTS

### 1. Preview Weekly Report Upload
**Endpoint:** `POST /api/v1/uploads/admin/preview-weekly-report`

**Purpose:** Upload Excel file and get preview with auto-detected conditions, transfers, and missing plants (NO save).

**Request:**
```typescript
interface PreviewRequest {
  file: File                          // Excel file
  location_id: UUID                   // Location UUID
  week_ending_date: Date              // ISO date string
}

// Form data:
// - file (multipart)
// - location_id
// - week_ending_date
```

**Response:**
```typescript
interface PreviewResponse {
  success: boolean
  preview_id: string  // e.g., "uuid_2025_4"

  location: {
    id: UUID
    name: string
  }

  week: {
    year: number
    week_number: number
    week_ending_date: string  // ISO date
  }

  // All available options for dropdowns
  available_locations: Array<{id: UUID, name: string}>
  condition_options: string[]  // ["working", "standby", "breakdown", ...]

  // Plants with auto-detected values
  plants: Array<{
    fleet_number: string
    description: string | null
    remarks: string | null
    hours_worked: number
    standby_hours: number
    breakdown_hours: number
    off_hire: boolean
    physical_verification: boolean

    // AUTO-DETECTED (can be overridden by admin)
    detected_condition: string            // "working" | "standby" | "breakdown" | ...
    condition_confidence: string          // "high" | "medium" | "low"
    condition_reason: string              // Why this was detected

    // Transfers auto-detected from remarks
    detected_transfer_from_id: UUID | null
    detected_transfer_from_name: string | null
    detected_transfer_to_id: UUID | null
    detected_transfer_to_name: string | null

    // Status
    is_new: boolean                       // Not in previous week?
    was_in_previous_week: boolean
  }>

  // Plants missing from previous week at this location
  missing_plants: Array<{
    fleet_number: string
    description: string | null
    last_seen_week: number
    last_location_id: UUID
    last_location_name: string
    last_condition: string
  }>

  // Summary stats
  summary: {
    total_in_file: number
    missing_from_previous: number
    new_this_week: number
    high_confidence: number
    medium_confidence: number
    low_confidence: number
    condition_breakdown: {
      working: number
      standby: number
      breakdown: number
      under_repair: number
      off_hire: number
      scrap: number
      missing: number
      gpm_assessment: number
      unverified: number
    }
  }
}
```

**Status Codes:**
- `200 OK` - Preview generated successfully
- `400 Bad Request` - Invalid file or parameters
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not admin
- `500 Internal Server Error` - Processing error

---

### 2. Confirm Weekly Report
**Endpoint:** `POST /api/v1/uploads/admin/confirm-weekly-report`

**Purpose:** Save validated/corrected preview data to database.

**Request:**
```typescript
interface ConfirmRequest {
  location_id: UUID
  year: number
  week_number: number
  week_ending_date: string  // ISO date

  // JSON string of validated plants
  plants_json: string

  // JSON string of missing plant actions (optional)
  missing_plants_json?: string
}

// Where plants_json contains:
interface ValidatedPlant {
  fleet_number: string
  condition: string  // Admin-selected condition
  transfer_from_location_id: UUID | null
  transfer_to_location_id: UUID | null
}

// Where missing_plants_json contains:
interface MissingPlantAction {
  fleet_number: string
  action: "transferred" | "scrap" | "unknown" | "missing"
  transfer_to_location_id?: UUID  // If action = "transferred"
}
```

**Response:**
```typescript
interface ConfirmResponse {
  success: boolean
  submission_id: string  // UUID for tracking
  message: string
  plants_count: number
}
```

**Status Codes:**
- `200 OK` - Data saved, processing in background
- `400 Bad Request` - Invalid JSON or missing data
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not admin
- `500 Internal Server Error` - Save failed

---

## FRONTEND PAGES NEEDED

### NEW PAGE 1: Upload Weekly Report
**Route:** `/(dashboard)/uploads` or `/(dashboard)/weekly-reports/upload`

**Components Needed:**

#### 1. `WeeklyReportUploadPage`
- Main page container
- State management for upload flow

#### 2. `UploadForm` Component
- File picker (Excel only)
- Location selector (dropdown)
- Week ending date picker (calendar)
- Submit button
- Loading state with progress bar

#### 3. `PreviewTable` Component
- Large table with all plant data
- Columns:
  - Fleet Number
  - Description
  - Remarks (text truncated with expand)
  - Hours (W/S/B)
  - **Condition** (Editable dropdown)
  - **Transfer** (Dropdown: None/To:X/From:X)
  - Confidence badge (✓ High / ⚠ Med / ❌ Low)
  - Reason (tooltip on hover)

#### 4. `ConfidenceFilter` Component
- Filter buttons: "All" | "Low Confidence" | "High Confidence"
- Quick scan of plants needing review

#### 5. `MissingPlantsTab` Component
- Tab showing plants missing from previous week
- For each plant: Fleet#, Description, Last Location, Action dropdown
- Actions: "Transferred to [Location]" | "Scrap" | "Unknown" | "Missing"

#### 6. `NewPlantsTab` Component
- Tab showing new plants in this week
- Simple list with auto-detected condition

#### 7. `TransfersTab` Component
- Plants with transfers detected/marked
- Show: From → To location mapping
- Preview of transfer records to be created

#### 8. `SummaryBar` Component
- Summary stats at top/bottom:
  - Total plants
  - High/Medium/Low confidence counts
  - Condition breakdown chart (small pie chart)
  - Missing/New plant counts

#### 9. `ConfirmDialog` Component
- Before saving, confirm:
  - Total plants to save
  - Transfers to create
  - Missing plant actions
  - Option to go back and edit

---

## DATA FLOW

### Step 1: Upload
```
User fills form:
  - File: Excel
  - Location: ABUJA
  - Week Ending: 2025-01-31

Submit → POST /api/v1/uploads/admin/preview-weekly-report
         (multipart form data)

Get back: PreviewResponse
  - plants: [ {fleet_number, detected_condition, ...} ]
  - missing_plants: [ {fleet_number, ...} ]
  - summary: { total_in_file: 45, low_confidence: 5 }

Store in state:
  - previewData: PreviewResponse
  - selectedPlants: {...}  // For edits
```

### Step 2: Review & Edit
```
Admin sees:
  - PreviewTable with auto-detected data
  - Low confidence plants highlighted
  - Dropdowns for condition overrides
  - Transfer dropdowns (None/To:X/From:X)

Admin changes:
  - Plant AF25: standby → working
  - Plant AF29: [To: KADUNA] (already detected)
  - Plant AF30 (missing): action → "Transferred to KADUNA"

All changes stored in local state:
  selectedPlants = {
    AF25: {condition: "working", transfer_to: null, ...},
    AF29: {condition: "operational", transfer_to: "KADUNA_UUID", ...},
    ...
  }
```

### Step 3: Confirm & Save
```
Admin clicks "Save All (45 plants)"

Build confirm request:
{
  location_id: "uuid",
  year: 2025,
  week_number: 4,
  week_ending_date: "2025-01-31",
  plants_json: JSON.stringify([
    {fleet_number: "AF25", condition: "working", ...},
    {fleet_number: "AF29", condition: "working", transfer_to_location_id: "uuid", ...}
  ]),
  missing_plants_json: JSON.stringify([
    {fleet_number: "AF30", action: "transferred", transfer_to_location_id: "uuid"}
  ])
}

POST /api/v1/uploads/admin/confirm-weekly-report

Response:
{
  success: true,
  submission_id: "uuid",
  message: "Processing 45 plants for week 4/2025"
}

Show success toast:
  "✓ Upload confirmed! Processing in background."

Redirect to:
  - /uploads/status/{submission_id}  OR
  - /dashboard (show processing indicator)
```

---

## EXISTING ENDPOINTS TO CONNECT

### Plants Endpoints (Already exist, enhance for transfers)
```
GET    /api/v1/plants?filters
  // Add: transfer_status filter = "pending_outbound" | "pending_inbound" | "confirmed"

GET    /api/v1/plants/{id}
  // Return: pending_transfer_id, condition (now "working" not "operational")

PATCH  /api/v1/plants/{id}
  // Can update: condition (with new "working" value)
```

### New Endpoints to Add (Optional, for monitoring)
```
GET    /api/v1/uploads/submissions/{submission_id}/status
  // Check processing status
  Response: { status: "processing" | "completed" | "failed", ... }

GET    /api/v1/uploads/submissions/{submission_id}/results
  // Get processing results after completion
  Response: { plants_processed, plants_created, transfers_created, errors }
```

---

## EXISTING PAGES TO UPDATE

### Plants List Page
**Changes needed:**
- Update condition filter: "operational" → "working"
- Add new columns:
  - **Condition**: working | standby | breakdown | ...
  - **Transfer Status**:
    - None
    - ⏳ Pending (outbound to X)
    - ✓ Confirmed (at X)
    - ⬅️ Incoming (from X)
- Filter by condition (new)
- Filter by transfer status (new)

### Dashboard Page
**Changes needed:**
- Update condition breakdown chart (show "working" instead of "operational")
- Add "Recent Uploads" card showing:
  - Last upload week/location
  - Plants processed
  - Link to /uploads page

### Sidebar Navigation
**New menu item:**
```
📤 Upload Reports
  ├─ New Upload
  └─ Upload History
```

Or under existing "Reports":
```
📊 Reports
  ├─ Dashboard
  ├─ Maintenance
  ├─ Verification
  ├─ Transfers
  └─ 📤 Upload Weekly (NEW)
```

---

## API INTEGRATION CHECKLIST

### 1. Create API Module
- [ ] Create `/src/lib/api/uploads.ts`
  - `previewWeeklyReport(file, location_id, week_ending_date)`
  - `confirmWeeklyReport(confirmData)`
  - `getUploadStatus(submissionId)`
  - `getUploadResults(submissionId)`

### 2. Create Hooks
- [ ] Create `/src/hooks/use-uploads.ts`
  - `usePreviewUpload()`
  - `useConfirmUpload()`
  - `useUploadStatus(submissionId)`
  - Query keys for caching

### 3. Create Components
- [ ] `weekly-report-upload-form.tsx`
- [ ] `preview-table.tsx`
- [ ] `missing-plants-tab.tsx`
- [ ] `transfers-tab.tsx`
- [ ] `upload-summary.tsx`
- [ ] `confirm-dialog.tsx`

### 4. Create Page
- [ ] `app/(dashboard)/uploads/page.tsx` OR `app/(dashboard)/weekly-reports/upload/page.tsx`

### 5. Update Existing Pages
- [ ] `app/(dashboard)/plants/page.tsx` - Condition filters, transfer columns
- [ ] `app/(dashboard)/page.tsx` - Recent uploads card
- [ ] `components/layout/sidebar.tsx` - Add uploads navigation

### 6. Update Models
- [ ] Update Plant type: condition = "working" (not "operational")
- [ ] Add Transfer types if needed
- [ ] Add Upload types (PreviewResponse, ConfirmRequest, etc)

### 7. Update API Client
- [ ] Ensure `axios` instance is correctly configured
- [ ] Test with preview endpoint

---

## USER FLOW DIAGRAM

```
LOGIN
  ↓
DASHBOARD
  ├─ [Upload Reports] link
  ↓
UPLOAD PAGE
  ├─ Select file
  ├─ Select location (dropdown)
  ├─ Select week ending (calendar)
  ├─ Click "Preview"
  ↓
PREVIEW VIEW
  ├─ Show summary stats
  ├─ Table: All plants with
  │   ├─ Auto-detected condition
  │   ├─ Confidence badge
  │   ├─ Editable condition dropdown
  │   ├─ Editable transfer dropdown
  │   └─ Reason tooltip
  ├─ Tab: Missing Plants
  │   └─ Action dropdown for each
  ├─ Tab: New Plants
  ├─ Tab: Transfers
  ├─ Filter: Low Confidence Only
  ├─ Review & make changes
  ├─ Click "Save All"
  ↓
CONFIRM DIALOG
  ├─ Show what will be saved
  ├─ Option to go back
  ├─ Confirm button
  ↓
BACKGROUND PROCESSING
  ├─ Endpoint: POST /confirm-weekly-report
  ├─ Response: submission_id
  ↓
SUCCESS
  ├─ Toast: "Upload confirmed! Processing in background"
  ├─ Option to view status
  └─ Option to upload another week
```

---

## CONDITION VALUES (UPDATED)

| Value | Display Name | Icon | Color | Use Case |
|-------|--------------|------|-------|----------|
| `working` | Working | ✓ | Green | Plant is actively in use |
| `standby` | Standby | ⏸️ | Blue | Plant is available but idle |
| `under_repair` | Under Repair | 🔧 | Orange | Being repaired or maintained |
| `breakdown` | Breakdown | ❌ | Red | Not working due to fault/damage |
| `scrap` | Scrap | ♻️ | Gray | Decommissioned/written off |
| `missing` | Missing | ❓ | Purple | Cannot be found or verified |
| `off_hire` | Off Hire | ⛔ | Red | Contractually unavailable |
| `gpm_assessment` | GPM Assessment | 📋 | Orange | Needs assessment/review |
| `unverified` | Unverified | ❔ | Gray | Cannot determine status |

---

## TRANSFER DISPLAY

```
No Transfer:       None

Outbound:          → KADUNA (pending)
                   ✓ KADUNA (confirmed at)

Inbound:           ← JOS (from)
                   ✓ From JOS (confirmed)

Both:              ← JOS → KADUNA
```

---

## ERROR HANDLING

### Common Errors

**Invalid File**
```
Error: "Invalid file type. Please upload an Excel file (.xlsx)"
```

**Location Not Found**
```
Error: "Location not found. Please select a valid location."
```

**Preview Fetch Error**
```
Error: "Failed to load preview. Please check your file and try again."
Toast: Shows actual API error message
```

**Confirm Error**
```
Error: "Failed to save data. Please check the errors below and try again."
Toast: "❌ Upload failed"
Shows list of specific errors (if any)
```

---

## PERFORMANCE CONSIDERATIONS

### Frontend
- **File Upload**: Use `FormData` for multipart, show progress
- **Table Rendering**: Virtualize table if > 100 plants (use react-window)
- **Dropdowns**: Lazy load if > 50 options
- **Debounce**: Search/filter inputs

### Backend
- Preview: < 2 seconds (no AI delays!) ⚡
- Confirm: Runs in background task
- Status polling: Every 2-3 seconds until complete

---

## RESPONSIVE DESIGN

### Mobile (< 768px)
- Upload form: Full width with stacked inputs
- Preview table: Horizontal scroll with sticky fleet number
- Tabs: Swipeable or stacked
- Dropdowns: Native select on mobile

### Tablet (768px - 1024px)
- Upload form: 2-column grid
- Preview table: Compact view with mini dropdowns
- Tabs: Full width

### Desktop (> 1024px)
- Upload form: Centered container (400px-600px)
- Preview table: Full width with all columns visible
- Side panel for filters/summary (optional)

---

## NEXT STEPS FOR IMPLEMENTATION

1. **Create API module** (`/src/lib/api/uploads.ts`) - 1 hour
2. **Create hooks** (`/src/hooks/use-uploads.ts`) - 30 min
3. **Build upload form** (`upload-form.tsx`) - 1 hour
4. **Build preview table** (`preview-table.tsx`) - 2-3 hours (most complex)
5. **Build tabs** (missing, new, transfers) - 1 hour
6. **Create upload page** - 30 min
7. **Update existing pages** (plants, dashboard) - 1-2 hours
8. **Testing & bug fixes** - 2-3 hours
9. **Polish & responsive** - 1-2 hours

**Total Estimated Time: 10-14 hours of development**

---

## DESIGN PRINCIPLES

✅ **Fast**: No AI delays, instant preview
✅ **Transparent**: Show why auto-detection was made (confidence + reason)
✅ **Flexible**: Admin can override everything via dropdowns
✅ **Safe**: Review before save (no accidental uploads)
✅ **Smart**: Highlight missing plants and new plants for context
✅ **Clear**: Color-coded confidence, status badges, icons
✅ **Efficient**: Batch save all 600 plants at once
✅ **Trackable**: Track submission ID for future reference
