# FRONTEND IMPLEMENTATION ROADMAP

## Complete Guide: Connecting 90+ Backend Endpoints to Frontend Pages

---

## PART 0: ROLE-BASED ACCESS CONTROL (CRITICAL)

### System Roles

The system has **TWO roles**:

#### **ADMIN Role**
- Full access: create, read, update, delete all resources
- User management: create/update/deactivate users, reset passwords
- Upload management: process weekly reports, generate tokens
- Audit access: view all audit logs, login events, security events
- System admin: manage states, settings, configurations
- **CANNOT**: Perform operations that fail backend permission checks

#### **MANAGEMENT Role**
- **READ-ONLY** access: view plants, locations, spare parts, suppliers, reports, transfers
- Cannot access: user management, audit logs, upload tokens, settings
- Cannot perform: create, update, delete ANY resource
- Can only: view reports, search, filter, export data
- **CANNOT**: Create plants, edit plants, delete plants, create spare parts, edit anything, access admin pages

### Role-Based Page Access

| Module | Page | Admin | Management | Notes |
|--------|------|-------|-----------|-------|
| **Users** | `/admin/users` | ✅ | ❌ | Admin-only |
| **Users** | `/admin/users/create` | ✅ | ❌ | Admin-only |
| **Users** | `/admin/users/[id]/edit` | ✅ | ❌ | Admin-only |
| **Plants** | `/plants` | ✅ | ✅ | Both can view (list, filter, search) |
| **Plants** | `/plants/create` | ✅ | ❌ | Admin-only |
| **Plants** | `/plants/[id]` | ✅ | ✅ | Both can view detail |
| **Plants** | `/plants/[id]/edit` | ✅ | ❌ | Admin-only |
| **Locations** | `/locations` | ✅ | ✅ | Both can view |
| **Locations** | `/locations/create` | ✅ | ❌ | Admin-only |
| **Locations** | `/locations/[id]/edit` | ✅ | ❌ | Admin-only |
| **Transfers** | `/admin/transfers` | ✅ | ❌ | Admin-only |
| **Transfers** | `/admin/transfers/[id]` | ✅ | ❌ | Admin-only |
| **Spare Parts** | `/spare-parts` | ✅ | ✅ | Both can view |
| **Spare Parts** | `/spare-parts/create` | ✅ | ❌ | Admin-only |
| **Spare Parts** | `/spare-parts/bulk-upload` | ✅ | ❌ | Admin-only |
| **Spare Parts** | `/spare-parts/[po_number]` | ✅ | ✅ | Both can view PO details |
| **Spare Parts** | `/spare-parts/analytics` | ✅ | ✅ | Both can view analytics |
| **Suppliers** | `/suppliers` | ✅ | ✅ | Both can view |
| **Suppliers** | `/suppliers/create` | ✅ | ❌ | Admin-only |
| **Reports** | `/reports/*` | ✅ | ✅ | Both can view all reports |
| **Uploads** | `/uploads` | ✅ | ❌ | Admin-only weekly report upload |
| **Uploads** | `/uploads/submissions` | ✅ | ❌ | Admin-only |
| **Audit** | `/admin/audit` | ✅ | ❌ | Admin-only audit logs |
| **States** | `/admin/states` | ✅ | ❌ | Admin-only |
| **Settings** | `/admin/settings` | ✅ | ❌ | Admin-only |
| **Notifications** | `/notifications` | ✅ | ✅ | Both can view |

### Implementation Details

**Frontend Route Protection:**
```typescript
// ProtectedRoute component (needs to be created)
<ProtectedRoute
  requiredRole="admin"  // 'admin' or 'management'
  fallback={<AccessDenied />}
>
  <UsersPage />
</ProtectedRoute>

// Or conditional rendering in layout
{user?.role === 'admin' && (
  <NavigationItem href="/admin/users" label="Users" />
)}
```

**API Enforces Permissions:**
- Backend uses `@require_admin` decorator on admin-only endpoints
- Backend uses `@require_management_or_admin` for shared endpoints
- Frontend API calls will fail with 403 if role doesn't match
- Frontend should catch 403 and show "Access Denied" message

**What to implement:**
1. ✅ Conditional navigation: Hide admin menu items from management users
2. ✅ Route guards: Prevent direct URL access to admin pages
3. ✅ API error handling: Catch 403 Forbidden and show friendly error
4. ⚠️ Form field restrictions: Some fields might be admin-only (future refinement)

---

## PART 1: ARCHITECTURE OVERVIEW

### Technology Stack (Already Chosen)
```
Framework: Next.js 16 + React 19
Styling: Tailwind CSS 4 + shadcn/ui
State: Zustand (auth, theme) + React Query (server state)
Forms: React Hook Form + Zod
HTTP: Axios with JWT interceptor
Theme: next-themes (light/dark)
Charts: ECharts
Icons: Lucide React
Notifications: Sonner (Toast)
```

### Brand Identity (Already Established)
```
Primary Gold: #ffbf36          (Buttons, accents, brand)
Dark/Black: #101415            (Text, backgrounds)
White: #ffffff                 (Surfaces)
Success: #22c55e / #10b981    (Green - working, success)
Danger: #ef4444               (Red - breakdown, errors)
Warning: #f59e0b              (Amber - pending, attention)
Info: #3b82f6                 (Blue - info, secondary)
Border: #e4e4e7               (Light gray lines)
```

### Design System Principles
- **Minimalist but functional** - Respect admin's time (600+ plant uploads)
- **Data-first** - Numbers and status are the focus
- **Accessible** - WCAG AA contrast, keyboard navigation, screen readers
- **Responsive** - Desktop-first (main use on computer), mobile fallbacks
- **Consistent** - Same patterns across all CRUD operations
- **Role-Aware** - Hide admin-only features from management users

### Navigation Structure (Role-Based Sidebar)

```
MANAGEMENT USER MENU (READ-ONLY):
├── 📋 Dashboard
├── 🌱 Plants (View Only)
├── 📍 Locations (View Only)
├── 🔧 Spare Parts (View Only)
│  └─ Analytics
├── 👥 Suppliers (View Only)
├── 📊 Reports (All)
│  ├─ Dashboard
│  ├─ Fleet Summary
│  ├─ Maintenance Costs
│  ├─ Verification Status
│  ├─ Trends
│  ├─ Unverified Plants
│  └─ Export
└── 🔔 Notifications

ADMIN USER MENU (FULL ACCESS):
├── 📋 Dashboard
├── 🌱 Plants (Create, Edit, Delete)
├── 📍 Locations (Create, Edit, Delete)
├── 🔧 Spare Parts (Create, Edit, Delete)
│  ├─ Bulk Upload
│  ├─ Direct Entry
│  └─ Analytics
├── 👥 Suppliers (Create, Edit, Delete)
├── 📊 Reports (All)
├── 🔔 Notifications
├── ⬆️ Upload Reports (ADMIN ONLY)
│  ├─ Upload Weekly Report
│  └─ Submissions
├── 🔄 Transfers (ADMIN ONLY)
├── 👤 Users (ADMIN ONLY)
├── 🔐 Audit Logs (ADMIN ONLY)
├── 📋 States (ADMIN ONLY)
└── ⚙️ Settings (ADMIN ONLY)
   ├─ General Settings
   └─ Integrations
```

**Implementation Notes:**
- Conditional rendering: `{user?.role === 'admin' && <AdminNavItems />}`
- Route guards: ProtectedRoute component with role check
- API errors: 403 Forbidden caught by global error handler
- Sidebar dynamically generated based on user role

---

## PART 2: FEATURE MODULES & IMPLEMENTATION PHASES

### Phase 1: Core Admin Features (Weeks 1-2) - CRITICAL PATH
Build the most important admin workflows first. These unlock the core business value.

#### Module 1A: User Management (🔒 ADMIN ONLY)
**Access:** Admin role only | Management role: ❌ Blocked

**Route Structure:**
```
/admin/users                    # List page (admin only)
/admin/users/create            # Create form (admin only)
/admin/users/{id}/edit         # Edit form (admin only)
```

**Endpoints Used:**
- `POST /api/v1/auth/users` - Create user
- `GET /api/v1/auth/users` - List users (with filters: role, active)
- `GET /api/v1/auth/users/{user_id}` - Get details
- `PATCH /api/v1/auth/users/{user_id}` - Update
- `POST /api/v1/auth/users/{user_id}/reset-password` - Force reset
- `DELETE /api/v1/auth/users/{user_id}` - Deactivate

**Components Needed:**
```
pages/(dashboard)/admin/users/
├── page.tsx                          # List view
├── create/page.tsx                   # Create form
├── [id]/edit/page.tsx                # Edit form
components/admin/
├── users-table.tsx                   # Main table
├── users-filters.tsx                 # Filter controls
├── user-form.tsx                     # Create/Edit form
├── user-actions.tsx                  # Bulk actions menu
├── password-reset-dialog.tsx         # Reset password modal
lib/api/
├── admin.ts                          # Admin endpoints wrapper
hooks/
├── use-users.ts                      # useUsers, useCreateUser, etc.
```

**Data Flow:**
```
[Users List Page]
    ↓
[Load: GET /users?role=X&active=true]
    ↓
[Display in table with Name, Email, Role, Last Login]
    ↓
[Click Create] → [Create Form]
    ↓
[Submit: POST /users with email, name, role]
    ↓
[Success: Toast, redirect to list, refetch]
```

---

#### Module 1B: Plant Management - Admin Full CRUD, Management View-Only
**Access:** Admin: Full CRUD | Management: View Only

**Route Structure:**
```
/plants                         # List page
/plants/create                  # Create form
/plants/{id}                    # Detail page
/plants/{id}/edit               # Edit form
/plants/{id}/history            # Location/Transfer history
/plants/{id}/maintenance        # Maintenance records
/plants/{id}/usage              # Weekly usage chart
```

**Endpoints Used:**
- `GET /api/v1/plants` - List (with massive filtering)
- `GET /api/v1/plants/{plant_id}` - Detail
- `POST /api/v1/plants` - Create
- `PATCH /api/v1/plants/{plant_id}` - Update
- `DELETE /api/v1/plants/{plant_id}` - Delete
- `GET /api/v1/plants/{plant_id}/maintenance-history` - Repairs
- `GET /api/v1/plants/{plant_id}/location-history` - Moves
- `GET /api/v1/plants/{plant_id}/weekly-records` - Usage
- `GET /api/v1/plants/{plant_id}/events` - Events for plant
- `POST /api/v1/plants/{plant_id}/transfer` - Initiate transfer
- `GET /api/v1/plants/search/{query}` - Full-text search
- `GET /api/v1/plants/export/excel` - Export

**Components Needed:**
```
pages/(dashboard)/plants/
├── page.tsx                          # ✓ ALREADY BUILT
├── create/page.tsx                   # NEW
├── [id]/page.tsx                     # NEW (detail)
├── [id]/edit/page.tsx                # NEW
components/plants/
├── plants-table.tsx                  # ✓ ALREADY BUILT
├── plants-filters.tsx                # ✓ ALREADY BUILT
├── plant-form.tsx                    # NEW - create/edit
├── plant-detail-tabs.tsx             # NEW
├── plant-detail-header.tsx           # NEW
├── plant-maintenance-table.tsx       # NEW
├── plant-location-history.tsx        # NEW - timeline
├── plant-weekly-usage-chart.tsx      # NEW
├── plant-events-feed.tsx             # NEW
├── transfer-plant-modal.tsx          # NEW
lib/api/
├── plants.ts                         # Already partially done
hooks/
├── use-plants.ts                     # Already partially done
├── use-plant-detail.ts               # NEW
├── use-plant-transfer.ts             # NEW
```

**Key Considerations:**
- **Role-Based UI**:
  - Admin: See Create, Edit, Delete buttons
  - Management: View-only (no edit buttons, no form fields)
- Fleet type auto-resolution (from prefix) - happens on backend
- Search: Implement real-time search as user types (debounced API call)
- Transfer: Opens modal, not separate page (Admin only)
- Detail page: Tab-based for multiple sections
  - **Maintenance tab**: Real-time search for spare parts (debounced 300ms before API call)
    - Search endpoint: `GET /api/v1/spare-parts/plant/{plant_id}/costs`
    - Instant filtering on remarks, description, PO number
    - Shows: part description, cost, supplier, date replaced
- Form validation: Zod schema (Admin only - management sees read-only view)
- Rich error messages from backend

---

#### Module 1C: Location Management - Admin Full CRUD, Management View-Only
**Access:** Admin: Full CRUD | Management: View Only

**Route Structure:**
```
/locations                      # List (cards)
/locations/create               # Create form
/locations/{id}                 # Detail page
/locations/{id}/edit            # Edit form
```

**Endpoints Used:**
- `GET /api/v1/locations` - List with stats
- `GET /api/v1/locations/{location_id}` - Detail
- `POST /api/v1/locations` - Create
- `PATCH /api/v1/locations/{location_id}` - Update
- `DELETE /api/v1/locations/{location_id}` - Delete
- `GET /api/v1/locations/{location_id}/plants` - Plants here
- `GET /api/v1/locations/{location_id}/submissions` - Weekly reports
- `GET /api/v1/locations/{location_id}/usage` - Usage metrics
- `GET /api/v1/states` - For dropdown (parent state)

**Components Needed:**
```
pages/(dashboard)/locations/
├── page.tsx                          # ✓ ALREADY BUILT (cards)
├── create/page.tsx                   # NEW
├── [id]/page.tsx                     # NEW (detail)
├── [id]/edit/page.tsx                # NEW
components/locations/
├── location-card.tsx                 # ✓ ALREADY BUILT
├── location-form.tsx                 # NEW
├── location-detail-tabs.tsx          # NEW
├── location-plants-table.tsx         # NEW
├── location-submissions-table.tsx    # NEW
├── location-usage-chart.tsx          # NEW
```

---

#### Module 1D: Weekly Report Uploads (🔒 ADMIN ONLY - THE NEW FEATURE!)
**Access:** Admin role only | Management role: ❌ Blocked

**Route Structure:**
```
/uploads                        # Upload page (admin only)
/uploads/submissions            # Submissions list (admin only)
/uploads/submissions/{id}       # Submission detail (admin only)
/uploads/tokens                 # Token management (admin) - for future site officers
```

**Endpoints Used:**
- `POST /api/v1/uploads/admin/weekly-report/preview` - Upload Excel & get preview
- `POST /api/v1/uploads/admin/confirm-weekly-report` - Confirm and save validated data
- `GET /api/v1/uploads/submissions/weekly` - List submissions
- `GET /api/v1/uploads/submissions/weekly/{submission_id}` - Detail
- `GET /api/v1/uploads/submissions/weekly/{submission_id}/file` - Download
- `POST /api/v1/uploads/tokens/generate` - Create token (for future - site officers)
- `GET /api/v1/uploads/tokens` - List tokens
- `GET /api/v1/locations` - For location dropdown in upload form

**Components Needed:**
```
pages/(dashboard)/uploads/
├── page.tsx                          # Main upload page
├── submissions/page.tsx              # Submissions list
├── submissions/[id]/page.tsx         # Submission detail
├── tokens/page.tsx                   # Token management (admin)
components/uploads/
├── upload-form.tsx                   # File + location + date
├── preview-table.tsx                 # Virtualized table (600 rows)
├── preview-summary-bar.tsx           # Stats, charts
├── missing-plants-tab.tsx            # Tab content
├── new-plants-tab.tsx                # Tab content
├── transfers-tab.tsx                 # Transfer visualization
├── preview-tabs.tsx                  # Tab manager
├── condition-cell-editable.tsx       # Dropdown for condition
├── transfer-cell-editable.tsx        # Dropdown for transfer
├── confidence-badge.tsx              # Visual indicator
├── confirm-dialog.tsx                # Final confirmation
├── missing-plant-action.tsx          # Action dropdown
├── submission-detail-tabs.tsx        # View submission
├── token-form.tsx                    # Generate token
├── token-list-table.tsx              # Token management
lib/api/
├── uploads.ts                        # All upload endpoints
hooks/
├── use-uploads.ts                    # usePreviewUpload, useConfirmUpload
├── use-submissions.ts                # useSubmissions
├── use-upload-tokens.ts              # useTokens
```

**This is the MOST COMPLEX feature - virtualized table for 600 rows, real-time editing, confidence scoring UI**

---

### Phase 2: Spare Parts & Purchase Orders (Weeks 2-3)

#### Module 2A: Spare Parts Management - Admin Full CRUD, Management View-Only
**Access:** Admin: Full CRUD | Management: View Only

**Route Structure:**
```
/spare-parts                    # List (table) ✓ BUILT
/spare-parts/create             # Create form
/spare-parts/{id}               # Detail
/spare-parts/bulk-upload        # Excel upload
/spare-parts/direct-entry       # Flexible entry form
```

**Endpoints Used (ALL 24):**

**GET Endpoints:**
- `GET /api/v1/spare-parts` - List with filters (plant, location, supplier, date range, time period)
- `GET /api/v1/spare-parts/{part_id}` - Single part detail
- `GET /api/v1/spare-parts/stats` - Summary statistics
- `GET /api/v1/spare-parts/top-suppliers` - Top suppliers by cost
- `GET /api/v1/spare-parts/high-cost-plants` - High maintenance cost plants
- `GET /api/v1/spare-parts/summary` - Overall summary
- `GET /api/v1/spare-parts/analytics/by-period` - Cost trends over time
- `GET /api/v1/spare-parts/analytics/year-over-year` - YoY comparison
- `GET /api/v1/spare-parts/autocomplete/descriptions` - Part description autocomplete
- `GET /api/v1/spare-parts/autocomplete/po-numbers` - PO number autocomplete
- `GET /api/v1/spare-parts/plant/{plant_id}/costs` - Maintenance costs for plant
- `GET /api/v1/spare-parts/plant/{plant_id}/shared-costs` - Shared costs allocated to plant
- `GET /api/v1/spare-parts/location/{location_id}/costs` - Costs by location
- `GET /api/v1/spare-parts/by-po/{po_number}` - All parts in a PO
- `GET /api/v1/spare-parts/by-po/{po_number}/document` - Document for PO
- `GET /api/v1/spare-parts/pos` - List all distinct POs

**POST Endpoints:**
- `POST /api/v1/spare-parts` - Create single part
- `POST /api/v1/spare-parts/bulk` - Bulk create (handles ANY format - multiple fleets, shared costs, flexible dates)
- `POST /api/v1/spare-parts/by-po/{po_number}/document` - Upload document for PO

**PATCH Endpoints:**
- `PATCH /api/v1/spare-parts/{part_id}` - Update single part
- `PATCH /api/v1/spare-parts/by-po/{po_number}` - Update all parts in a PO

**DELETE Endpoints:**
- `DELETE /api/v1/spare-parts/{part_id}` - Delete single part
- `DELETE /api/v1/spare-parts/by-po/{po_number}` - Delete all parts in PO
- `DELETE /api/v1/spare-parts/by-po/{po_number}/document` - Delete PO document

**Supporting:**
- `GET /api/v1/suppliers` - Supplier dropdown

**Components Needed:**
```
pages/(dashboard)/spare-parts/
├── page.tsx                          # ✓ ALREADY BUILT
├── create/page.tsx                   # NEW
├── bulk-upload/page.tsx              # NEW
├── direct-entry/page.tsx             # NEW
├── [po_number]/page.tsx              # NEW (PO detail - all parts in this PO)
├── analytics/page.tsx                # NEW (Cost trends, top suppliers, etc.)
components/spare-parts/
├── spare-parts-table.tsx             # ✓ ALREADY BUILT
├── spare-parts-filters.tsx           # ✓ ALREADY BUILT
├── spare-part-form.tsx               # NEW
├── spare-part-bulk-upload.tsx        # NEW
├── spare-part-direct-entry.tsx       # NEW (flexible format)
├── spare-part-detail-modal.tsx       # NEW
├── spare-parts-stats-cards.tsx       # NEW
├── po-detail-header.tsx              # NEW (PO info, document links)
├── po-parts-table.tsx                # NEW (All parts in this PO)
├── po-document-upload.tsx            # NEW (Upload/download document)
├── po-document-viewer.tsx            # NEW (View embedded document)
├── spare-parts-analytics-chart.tsx   # NEW (Cost trends over time)
├── top-suppliers-chart.tsx           # NEW (Top suppliers by cost)
lib/api/
├── spare-parts.ts                    # Already done
hooks/
├── use-spare-parts.ts                # Already done
├── use-spare-parts-stats.ts          # NEW
├── use-po-detail.ts                  # NEW
├── use-spare-parts-search.ts         # NEW (real-time search with debounce)
```

**PO Detail Page (`/spare-parts/[po_number]`) - NEW:**
- Show all parts belonging to a specific purchase order
- Header: PO number, date, supplier, total cost, status
- Tabs:
  - **Parts**: Table of all parts in this PO with fleet, description, cost, date
  - **Document**: Upload/download PO document (PDF, Excel, etc.)
  - **Analysis**: Cost breakdown by fleet, by plant
- Actions: Edit PO (PATCH to update all parts), Delete entire PO, Download as Excel
- Endpoint: `GET /api/v1/spare-parts/by-po/{po_number}` with parts detail
- Document: `GET /api/v1/spare-parts/by-po/{po_number}/document` (retrieve)

**Analytics Page (`/spare-parts/analytics`) - NEW:**
- Cost trends over time (line chart, selectable date range)
- Top suppliers by total cost (bar chart, expandable to see parts)
- Top plants by maintenance cost (table, sortable)
- Cost breakdown by fleet type (pie chart)
- Monthly/yearly spending trends
- Filters: Date range, plant, supplier, location
- Export: Download report as Excel/CSV
- Endpoints used:
  - `GET /api/v1/spare-parts/analytics/by-period` (trends)
  - `GET /api/v1/spare-parts/analytics/year-over-year` (YoY)
  - `GET /api/v1/spare-parts/top-suppliers` (suppliers)
  - `GET /api/v1/spare-parts/high-cost-plants` (plants)
  - `GET /api/v1/spare-parts/summary` (overall stats)

---

#### Module 2B: Suppliers Management - Admin Full CRUD, Management View-Only
**Access:** Admin: Full CRUD | Management: View Only

**Route Structure:**
```
/suppliers                      # List
/suppliers/create               # Create
/suppliers/{id}/edit            # Edit
/suppliers/{id}                 # Detail (with PO history)
```

**Endpoints Used:**
- `GET /api/v1/suppliers` - List with stats
- `GET /api/v1/suppliers/{supplier_id}` - Detail
- `POST /api/v1/suppliers` - Create
- `PATCH /api/v1/suppliers/{supplier_id}` - Update
- `GET /api/v1/suppliers/{supplier_id}/pos` - PO history
- `GET /api/v1/suppliers/autocomplete` - Fuzzy search

**Components Needed:**
```
pages/(dashboard)/suppliers/
├── page.tsx                          # List
├── create/page.tsx                   # Create
├── [id]/edit/page.tsx                # Edit
├── [id]/page.tsx                     # Detail
components/suppliers/
├── suppliers-table.tsx               # List table
├── supplier-form.tsx                 # Create/Edit
├── supplier-detail-tabs.tsx          # Detail tabs
├── supplier-pos-table.tsx            # PO history
lib/api/
├── suppliers.ts                      # Endpoints
hooks/
├── use-suppliers.ts                  # Hooks
```

---

### Phase 3: Reports & Analytics (Weeks 3-4)

#### Module 3A: Reports Pages
**Routes:**
```
/reports/dashboard              # ✓ ALREADY BUILT
/reports/fleet-summary          # Fleet breakdown by type
/reports/maintenance-costs      # Cost analysis
/reports/verification           # Verification status
/reports/submission-compliance  # Weekly submission heatmap
/reports/weekly-trends          # Usage trends over time
/reports/unverified-plants      # Plants needing verification
/reports/export                 # Multiple export options
```

**Endpoints Used:**
- `GET /api/v1/reports/dashboard` - KPIs
- `GET /api/v1/reports/fleet-summary` - Fleet breakdown
- `GET /api/v1/reports/maintenance-costs` - Costs by plant/supplier/location
- `GET /api/v1/reports/verification-status` - Verified %
- `GET /api/v1/reports/submission-compliance` - Weekly reports heatmap
- `GET /api/v1/reports/plant-movement` - Transfer history
- `GET /api/v1/reports/weekly-trend` - Usage over time
- `GET /api/v1/reports/unverified-plants` - List
- `GET /api/v1/reports/export/*` - CSV/Excel

**Components Needed:**
```
pages/(dashboard)/reports/
├── page.tsx                          # ✓ Dashboard (BUILT)
├── fleet-summary/page.tsx            # NEW
├── maintenance-costs/page.tsx        # NEW
├── verification/page.tsx             # NEW
├── compliance/page.tsx               # NEW
├── trends/page.tsx                   # NEW
├── unverified/page.tsx               # NEW
├── export/page.tsx                   # NEW
components/reports/
├── dashboard-kpi-cards.tsx           # ✓ BUILT
├── fleet-summary-chart.tsx           # NEW
├── fleet-summary-table.tsx           # NEW
├── maintenance-costs-table.tsx       # NEW
├── maintenance-costs-chart.tsx       # NEW
├── verification-status-card.tsx      # NEW
├── submission-compliance-heatmap.tsx # NEW
├── weekly-trends-chart.tsx           # NEW
├── unverified-plants-table.tsx       # NEW
├── export-buttons.tsx                # NEW
lib/charts/
├── echarts-helpers.ts                # Reusable chart configs
```

---

### Phase 4: Admin & System Features (Weeks 4-5)

#### Module 4A: Transfers Management (🔒 ADMIN ONLY)
**Access:** Admin role only | Management role: ❌ Blocked

**Routes:**
```
/admin/transfers                # List all transfers
/admin/transfers/pending        # Filter view
/admin/transfers/{id}           # Detail
```

**Endpoints:**
- `GET /api/v1/transfers` - List
- `GET /api/v1/transfers/pending` - Pending only
- `GET /api/v1/transfers/{transfer_id}` - Detail
- `POST /api/v1/transfers/{transfer_id}/confirm` - Confirm
- `POST /api/v1/transfers/{transfer_id}/cancel` - Cancel
- `GET /api/v1/transfers/stats/summary` - Stats

**Components:**
```
pages/(dashboard)/admin/transfers/
├── page.tsx                          # List
├── [id]/page.tsx                     # Detail
components/admin/
├── transfers-table.tsx               # List
├── transfer-detail-card.tsx          # Detail
├── transfer-actions.tsx              # Confirm/Cancel buttons
```

---

#### Module 4B: Audit Logs (🔒 ADMIN ONLY)
**Access:** Admin role only | Management role: ❌ Blocked

**Routes:**
```
/admin/audit                    # Audit log viewer
/admin/audit/record/{id}        # Record history
```

**Endpoints:**
- `GET /api/v1/audit/logs` - List with filters
- `GET /api/v1/audit/logs/{table_name}/{record_id}` - Full history

**Components:**
```
pages/(dashboard)/admin/audit/
├── page.tsx                          # Audit logs
├── [table]/[id]/page.tsx             # Record history
components/admin/
├── audit-logs-table.tsx              # Log viewer
├── audit-record-timeline.tsx         # Changes over time
├── audit-diff-view.tsx               # Before/after values
```

---

#### Module 4C: Upload Tokens Management
**Routes:**
```
/admin/upload-tokens            # Token management
```

**Endpoints:**
- Already covered in Module 1D

**Components:**
- Already covered in Module 1D

---

#### Module 4D: Settings & Configuration (🔒 ADMIN ONLY)
**Access:** Admin role only | Management role: ❌ Blocked

**Routes:**
```
/admin/settings                 # General settings
/admin/settings/integrations    # API info
```

**Components:**
```
pages/(dashboard)/admin/settings/
├── page.tsx                          # Settings page
components/admin/
├── settings-form.tsx                 # General settings
├── integrations-info.tsx             # Supabase info
```

---

### Phase 5: Polish & Integration (Weeks 5-6)

#### Module 5A: Notifications System
**Routes:**
```
/notifications                  # Notifications panel/page
```

**Endpoints:**
- `GET /api/v1/notifications` - List
- `PATCH /api/v1/notifications/{id}/read` - Mark read
- `POST /api/v1/notifications/mark-all-read` - Mark all

**Components:**
```
pages/(dashboard)/notifications/page.tsx
components/
├── notification-bell.tsx             # Header icon + dropdown
├── notification-center.tsx           # Full panel
├── notification-item.tsx             # Single notification
```

---

#### Module 5B: States Management (🔒 ADMIN ONLY)
**Access:** Admin role only | Management role: ❌ Blocked

**Routes:**
```
/admin/states                   # States list
/admin/states/create            # Create
/admin/states/{id}/edit         # Edit
```

**Endpoints:**
- `GET /api/v1/states` - List
- `POST /api/v1/states` - Create
- `PATCH /api/v1/states/{id}` - Update
- `DELETE /api/v1/states/{id}` - Delete

**Components:**
```
pages/(dashboard)/admin/states/
├── page.tsx                          # List
├── create/page.tsx                   # Create
├── [id]/edit/page.tsx                # Edit
components/admin/
├── states-table.tsx                  # List
├── state-form.tsx                    # Form
```

---

## PART 3: DETAILED DATA FLOW DIAGRAMS

**Note:** All data flows respect role-based access:
- Management users cannot see delete buttons or admin-only options
- Admin users see all options and can perform all operations
- API enforces permissions server-side (frontend hides UI for UX)

### Complex Flow 1: Plant Upload → Database

```
┌─────────────────────────────────────────────────────────────┐
│ ADMIN UPLOADS WEEKLY REPORT (600 plants)                    │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ FRONTEND: Upload Form                                       │
│ - File picker (Excel)                                       │
│ - Location: ABUJA (dropdown)                                │
│ - Week Ending: 2025-01-31 (calendar)                        │
│ - Submit button                                             │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ API CALL: POST /uploads/admin/preview-weekly-report        │
│ (multipart/form-data: file, location_id, week_ending_date) │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ BACKEND PROCESSING                                          │
│ 1. Extract Excel → Parse all rows                           │
│ 2. For each plant:                                          │
│    - Fleet# lookup (normalize)                              │
│    - Hours parsing                                          │
│    - Remarks extraction                                     │
│    - Keyword-based condition detection                      │
│    - Transfer detection (from remarks)                      │
│ 3. Compare with previous week:                              │
│    - Find missing plants                                    │
│    - Find new plants                                        │
│ 4. Return preview data (NO SAVE)                            │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ RESPONSE: PreviewResponse                                   │
│ {                                                           │
│   plants: [                                                 │
│     {fleet_number, description, remarks, hours_w/s/b,      │
│      detected_condition, confidence, transfer_to, ...}      │
│   ],                                                        │
│   missing_plants: [                                         │
│     {fleet_number, last_location, action_needed}            │
│   ],                                                        │
│   summary: {total, by_condition, stats}                     │
│ }                                                           │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ FRONTEND: Preview Table (Virtualized, 600 rows)             │
│ - Display all plants with auto-detected values              │
│ - Editable dropdowns for condition (override if needed)     │
│ - Editable dropdowns for transfers                          │
│ - Tabs: All | Missing | New | Transfers                     │
│ - Filters: Condition, Confidence level                      │
│ - Summary stats at top                                      │
│ - Admin reviews and makes corrections                       │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ ADMIN ACTIONS:                                              │
│ 1. Review low-confidence plants                             │
│ 2. Change conditions as needed (dropdown)                   │
│ 3. Mark transfers (from/to location)                        │
│ 4. Handle missing plants (transferred/scrap/unknown)        │
│ 5. All changes stored in React state                        │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ ADMIN CLICKS: "SAVE ALL (600 plants)"                       │
│ - Confirm dialog shows summary                              │
│ - Admin confirms                                            │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ API CALL: POST /uploads/admin/confirm-weekly-report         │
│ {                                                           │
│   location_id, year, week_number,                           │
│   plants_json: [...{fleet_number, condition, transfer...}], │
│   missing_plants_json: [...{fleet_number, action}]          │
│ }                                                           │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ BACKEND: Save Confirmed Data                                │
│ 1. Upsert plants_master (create/update)                     │
│ 2. Insert plant_weekly_records (usage data)                 │
│ 3. Create/confirm plant_transfers                           │
│ 4. Handle missing plant actions (scrap/unknown/transferred) │
│ 5. Update submission status → completed                     │
│ (All in background task - returns submission_id immediately)│
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ RESPONSE: {success: true, submission_id, plants_count}      │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ FRONTEND:                                                   │
│ - Toast: "✓ Upload confirmed! Processing in background"    │
│ - Optional: Poll job status endpoint                        │
│ - Redirect to uploads list or dashboard                     │
└─────────────────────────────────────────────────────────────┘
```

### Complex Flow 2: Plant Detail Page Load

```
Admin clicks on plant row → Fleet# AF25
                           ↓
Frontend: /plants/AF25 page loads
                           ↓
Parallel API Calls:
┌─ GET /plants/by-fleet/AF25
│   → {id, fleet_number, description, condition, location_id...}
│
├─ GET /plants/{id}/maintenance-history
│   → [{part, date, supplier, cost}, ...]
│
├─ GET /plants/{id}/location-history
│   → [{location, start_date, end_date, duration}, ...]
│
├─ GET /plants/{id}/weekly-records
│   → [{year, week, hours_w/s/b, condition}, ...]
│
├─ GET /plants/{id}/events
│   → [{event_type, date, details}, ...]
│
└─ GET /locations  (for transfer dropdown)
    → [{id, name}, ...]
                           ↓
Display in tabs:
├─ Overview: All fields + Edit button
├─ Maintenance: Table of repairs
├─ Location History: Timeline visualization
├─ Weekly Usage: Line chart of usage over time
├─ Events: Feed of events (transfers, missing, etc.)
└─ Actions: Transfer, Edit, Delete buttons
```

---

## PART 5: IMPLEMENTATION SEQUENCE & PRIORITY

### Week 1: Foundation (Users + Plant CRUD)
```
Priority 1 (Monday):
  ✓ Create users API wrapper (lib/api/admin.ts)
  ✓ Create users hook (hooks/use-users.ts)
  ✓ Create users table component
  ✓ Create users list page
  ✓ Create user form component
  ✓ Create/edit user modals
  Est: 6 hours

Priority 2 (Tuesday):
  ✓ Create plant form component (reuse for create + edit)
  ✓ Create plant detail page (tabs: Overview, Maintenance, Location History, Usage, Events)
  ✓ Create plant maintenance table component
  ✓ Create plant location history timeline component
  ✓ Create plant weekly usage chart component
  ✓ Create transfer plant modal
  Est: 8 hours

Priority 3 (Wednesday):
  ✓ Add API integration to plants page (filter, sort, pagination)
  ✓ Add create/edit navigation from list
  ✓ Test all plant CRUD operations
  Est: 4 hours

Buffer: Thursday - Testing & refinement
```

### Week 2: Locations + Weekly Reports (The Big Feature)
```
Priority 1 (Monday-Tuesday):
  ✓ Complete location management (create, edit, detail pages)
  ✓ Test location CRUD
  Est: 4 hours

Priority 2 (Tuesday-Thursday):
  ✓ Upload form (file picker, location dropdown, date picker)
  ✓ Preview table component (CRITICAL - handle 600 rows with virtualization)
  ✓ Preview tabs (Missing, New, Transfers)
  ✓ Condition dropdown (inline editing)
  ✓ Transfer dropdown (inline editing)
  ✓ Confidence badge (visual indicator)
  ✓ Summary bar (stats, breakdown chart)
  ✓ Confirm dialog
  Est: 20 hours (most complex feature)

Priority 3 (Friday):
  ✓ Test preview/confirm flow end-to-end
  ✓ Test virtualized table with 600 rows
  ✓ Performance optimization
  Est: 4 hours
```

### Week 3: Spare Parts + Suppliers
```
Priority 1:
  ✓ Create spare part form (single entry)
  ✓ Bulk upload modal (Excel preview)
  ✓ Direct entry form (flexible format)
  ✓ Test all spare parts CRUD
  Est: 8 hours

Priority 2:
  ✓ Suppliers management (full CRUD)
  ✓ Supplier detail with PO history
  Est: 4 hours

Priority 3:
  ✓ Spare parts analytics cards & charts
  Est: 3 hours

Buffer: Integration & testing
```

### Week 4: Reports & Analytics
```
Priority 1:
  ✓ Fleet summary report (chart + table)
  ✓ Maintenance costs report (table + chart with time period filters)
  ✓ Verification status report
  ✓ Submission compliance heatmap (Location × Week)
  ✓ Weekly trends chart
  Est: 12 hours

Priority 2:
  ✓ Unverified plants report
  ✓ Export functionality (multiple formats)
  Est: 4 hours

Buffer: Charts & responsive design
```

### Week 5: Admin Features
```
Priority 1:
  ✓ Transfers management (list, detail, confirm/cancel)
  ✓ Audit logs viewer
  ✓ Upload tokens management
  Est: 8 hours

Priority 2:
  ✓ States management (CRUD)
  ✓ Settings page
  ✓ Notifications system
  Est: 6 hours

Buffer: Admin UI polish
```

### Week 6: Polish & Integration
```
Priority 1:
  ✓ Full API integration testing
  ✓ Error handling & edge cases
  ✓ Loading states & skeletons
  ✓ Empty states
  Est: 8 hours

Priority 2:
  ✓ Responsive design (mobile/tablet)
  ✓ Accessibility audit (keyboard nav, aria labels)
  ✓ Performance optimization (code splitting, lazy loading)
  Est: 6 hours

Priority 3:
  ✓ Dark mode polish
  ✓ Theme customization
  ✓ Documentation
  Est: 4 hours
```

---

## PART 8: COMPONENT REUSABILITY PATTERNS

### Data Table Pattern (Used in 15+ places)
```tsx
// Reusable component
<DataTable
  columns={[
    {key: 'fleet_number', label: 'Fleet #', sortable: true},
    {key: 'description', label: 'Description'},
    {key: 'location_name', label: 'Location', filterable: true},
    {key: 'condition', label: 'Condition', filterable: true},
  ]}
  data={plants}
  isLoading={isLoading}
  pagination={{page, limit, total}}
  onPageChange={setPage}
  onSort={handleSort}
  onFilter={handleFilter}
  rowActions={[
    {label: 'View', onClick: handleView},
    {label: 'Edit', onClick: handleEdit, icon: 'Edit'},
    {label: 'Delete', onClick: handleDelete, icon: 'Trash'},
  ]}
/>
```

### Form Pattern (Used in 10+ places)
```tsx
// Reusable form hook
const {
  register,
  control,
  handleSubmit,
  errors,
  isSubmitting,
} = useForm({
  resolver: zodResolver(plantSchema),
  defaultValues: plant,
})

<Form onSubmit={handleSubmit(onSubmit)}>
  <FormField name="fleet_number" label="Fleet #" required />
  <FormField name="description" label="Description" />
  <FormField name="location_id" label="Location" type="select" options={locations} />
  <SubmitButton isLoading={isSubmitting} />
</Form>
```

### Modal Pattern (Used in 20+ places)
```tsx
<Modal
  isOpen={isOpen}
  title="Create Plant"
  onClose={onClose}
  size="lg"
>
  <PlantForm onSuccess={handleSuccess} onCancel={onClose} />
</Modal>
```

### Detail Page Tabs Pattern (Used in 5+ places)
```tsx
<DetailPageLayout>
  <DetailHeader title={plant.fleet_number} subtitle={plant.description} />
  <DetailTabs>
    <Tab label="Overview">
      <OverviewContent plant={plant} />
    </Tab>
    <Tab label="Maintenance">
      <MaintenanceTable data={maintenanceHistory} />
    </Tab>
    <Tab label="Location History">
      <LocationTimeline data={locationHistory} />
    </Tab>
    <Tab label="Usage">
      <UsageChart data={weeklyRecords} />
    </Tab>
  </DetailTabs>
</DetailPageLayout>
```

---

## PART 6: ROLE-BASED ACCESS IMPLEMENTATION CHECKLIST

### Step 1: ProtectedRoute Component (Must Create)
```typescript
// components/protected-route.tsx
interface ProtectedRouteProps {
  requiredRole: 'admin' | 'management' | 'both'
  children: React.ReactNode
  fallback?: React.ReactNode
}

export function ProtectedRoute({
  requiredRole,
  children,
  fallback = <AccessDeniedPage />,
}: ProtectedRouteProps) {
  const { user } = useAuth()

  if (!user) return <LoginPage /> // Not authenticated

  if (requiredRole === 'admin' && user.role !== 'admin') {
    return fallback
  }

  return <>{children}</>
}

// Usage in page:
<ProtectedRoute requiredRole="admin">
  <UsersPage />
</ProtectedRoute>
```

### Step 2: Conditional Navigation & UI Elements (Update Sidebar + Detail Pages)

**Sidebar Navigation:**
```typescript
// components/layout/sidebar.tsx
const isAdmin = user?.role === 'admin'

const menuItems = [
  { label: 'Dashboard', href: '/dashboard', visibleTo: 'both' },
  { label: 'Plants', href: '/plants', visibleTo: 'both' },
  { label: 'Users', href: '/admin/users', visibleTo: 'admin' },
  { label: 'Uploads', href: '/uploads', visibleTo: 'admin' },
  { label: 'Settings', href: '/admin/settings', visibleTo: 'admin' },
]

{menuItems
  .filter(item => item.visibleTo === 'both' || item.visibleTo === user.role)
  .map(item => <NavigationLink key={item.href} {...item} />)}
```

**Detail Page - Conditional Action Buttons:**
```typescript
// Management: view-only, Admin: edit/delete available
const isAdmin = user?.role === 'admin'

{isAdmin && (
  <ActionBar>
    <Button href={`/plants/${id}/edit`}>Edit</Button>
    <Button variant="danger">Delete</Button>
  </ActionBar>
)}
```

**List Page - Conditional Action Column:**
```typescript
// Only show edit/delete actions to admin
const columns = [
  ...(isAdmin ? [{
    key: 'actions',
    render: (row) => (
      <>
        <Button href={`/plants/${row.id}/edit`}>Edit</Button>
        <Button variant="danger">Delete</Button>
      </>
    )
  }] : [])
]
```

### Step 3: Global Error Handler (403 Handling)
```typescript
// lib/api/client.ts
axiosInstance.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 403) {
      // User authenticated but lacks permission
      toast.error('Access Denied: You do not have permission to access this resource')
      return Promise.reject(error)
    }
    // ... other error handling
  }
)
```

### Step 4: AccessDenied Error Page
```typescript
// app/(dashboard)/access-denied/page.tsx
// Show friendly message when user tries unauthorized page
// Button to go back or return to dashboard
```

---

## PART 7: API INTEGRATION CHECKLIST

### Step 1: API Wrappers (Done First)
```
lib/api/
├── auth.ts              ✓ DONE (login, logout, me, change-password)
├── plants.ts            ~ PARTIAL (list, detail - add create, update, delete, transfer)
├── locations.ts         ~ PARTIAL (list - add create, update, delete, detail)
├── states.ts            ~ NEW (create, list, update, delete)
├── spare-parts.ts       ~ PARTIAL (list, stats - add create, bulk, direct entry)
├── suppliers.ts         ~ PARTIAL (list - add create, update, detail)
├── uploads.ts           ~ NEW (preview, confirm, submissions, tokens)
├── transfers.ts         ~ NEW (list, confirm, cancel, stats)
├── reports.ts           ~ PARTIAL (dashboard - add fleet-summary, costs, verification, etc.)
├── audit.ts             ~ NEW (list logs, record history)
├── admin.ts             ~ NEW (users CRUD, settings)
├── notifications.ts     ~ NEW (list, mark-read, delete)
└── client.ts            ✓ DONE (Axios instance with JWT interceptor)
```

### Step 2: React Query Hooks (For Each API Module)
```
hooks/
├── use-auth.ts                ✓ DONE (login, logout, me)
├── use-users.ts               ~ NEW
├── use-plants.ts              ~ PARTIAL (add detail, transfer)
├── use-locations.ts           ~ PARTIAL (add create, update)
├── use-states.ts              ~ NEW
├── use-spare-parts.ts         ~ PARTIAL (add create, bulk, stats)
├── use-suppliers.ts           ~ PARTIAL (add create, detail)
├── use-uploads.ts             ~ NEW (preview, confirm, submissions, tokens)
├── use-transfers.ts           ~ NEW
├── use-reports.ts             ~ PARTIAL (add all reports)
├── use-audit.ts               ~ NEW
├── use-notifications.ts       ~ NEW
└── use-debounce.ts            ✓ DONE (debounce hook)
```

### Step 3: Component Integration
- Each page/component imports from `lib/api/*` for data
- Each page/component uses hook from `hooks/use-*.ts`
- Loading states: Use Skeleton components during fetch
- Error states: Display error toast + retry button
- Empty states: Friendly message + call-to-action button

### Step 4: Error Handling
```typescript
// Global error handler (already in client.ts)
// Handles:
// - 401 → Redirect to login
// - 403 → Show "Access Denied" toast
// - 500 → Show error toast with retry
// - Network error → Show offline message

// Per-component error handling:
try {
  await mutate(data)
  toast.success('Success!')
  // refetch or navigate
} catch (error) {
  if (error.response?.status === 400) {
    setErrors(error.response.data.details)
  } else {
    toast.error('Something went wrong')
  }
}
```

---

## PART 9: PERFORMANCE TARGETS

### Frontend Performance
```
Page Load Time:        < 2s (including API call)
Table Render (600 rows): < 200ms (virtualized)
Filter/Search Response: < 300ms (debounced - CRITICAL)
  → Admin types in search → 300ms delay → API call → Results
  → Applies to: Plant search, Spare parts search, Plant maintenance search
Modal Open:            < 100ms
Form Submission:       < 1s (including API call)
```

**Search Debounce Strategy:**
- Plant detail page (Maintenance tab): Real-time search for spare parts → 300ms debounce
- Plant list: Full-text search → 300ms debounce
- Spare parts list: Filter by description, PO, supplier → 300ms debounce
- Use `use-debounce.ts` hook with value, delay=300, callback to API

### Backend Performance (Already Optimized)
```
Preview (600 plants):  < 2s (no AI delays!)
Confirm/Save:          Async background task
API Response:          < 100ms (query optimized)
```

### Key Optimizations
1. **Virtualized Tables**: Use `react-window` for 600+ rows
2. **Code Splitting**: Lazy load report pages, admin pages
3. **API Caching**: React Query with 5-10 min stale times
4. **Debounced Search**: 300ms delay before API call
5. **Image Optimization**: Lazy load images, convert to WebP
6. **Bundle Analysis**: Use `next/bundle-analyzer`

---

## PART 10: TESTING STRATEGY

### Unit Tests (Per Component)
- Form validation (Zod schemas)
- Component rendering with different props
- User interactions (click, type, select)

### Integration Tests (Per Page)
- Load data → Display correctly
- User action → API call → Update UI
- Error scenarios → Show error message

### E2E Tests (Critical Flows)
- Login → Dashboard → Plant Create → View Detail
- Upload → Preview → Confirm → View Submissions
- Plant CRUD full workflow

### Manual Testing Checklist
- [ ] All API calls working
- [ ] All filters working
- [ ] Responsive design (mobile/tablet/desktop)
- [ ] Dark mode looks good
- [ ] Keyboard navigation (tab through form)
- [ ] Screen reader announces properly
- [ ] Error messages helpful
- [ ] Loading states show
- [ ] Empty states show

---

## PART 11: DEPLOYMENT CONSIDERATIONS

### Environment Variables
```env
NEXT_PUBLIC_API_URL=http://localhost:8000  # Dev
NEXT_PUBLIC_API_URL=https://api.prod.com   # Prod
NEXT_PUBLIC_SITE_URL=http://localhost:3000 # Dev
NEXT_PUBLIC_SITE_URL=https://app.prod.com  # Prod
```

### Build Optimization
```bash
# Build analysis
npm run build -- --analyze

# Page size reduction
# - Remove unused dependencies
# - Tree-shake dead code
# - Compress images
# - Code splitting strategy
```

### Browser Support
- Chrome/Edge (latest 2 versions)
- Firefox (latest 2 versions)
- Safari 12+
- Mobile: iOS 12+, Android 10+

---

## SUMMARY: COMPLETE FEATURE CHECKLIST

### PHASE 1 (Week 1-2): Critical Path ✓ MUST DO
- [ ] Users Management (CRUD)
- [ ] Plant Management (Full CRUD + Detail page)
- [ ] Location Management (Full CRUD + Detail page)
- [ ] Weekly Report Upload (The new system!)
- [ ] All API integrations for above

### PHASE 2 (Week 2-3): Core Business
- [ ] Spare Parts Management (CRUD + Bulk + Direct Entry)
- [ ] Suppliers Management (Full CRUD)
- [ ] All analytics/stats for above

### PHASE 3 (Week 3-4): Reporting
- [ ] Fleet Summary Report
- [ ] Maintenance Costs Report
- [ ] Verification Status Report
- [ ] Submission Compliance Heatmap
- [ ] Weekly Trends Report
- [ ] Unverified Plants Report
- [ ] Export functionality

### PHASE 4 (Week 4-5): Administration
- [ ] Transfers Management (List, Detail, Confirm, Cancel)
- [ ] Audit Logs Viewer
- [ ] Upload Tokens Management
- [ ] States Management (CRUD)
- [ ] Settings Page
- [ ] Notifications System

### PHASE 5 (Week 5-6): Polish
- [ ] Full API integration & testing
- [ ] Error handling edge cases
- [ ] Responsive design
- [ ] Accessibility (WCAG AA)
- [ ] Performance optimization
- [ ] Dark mode polish
- [ ] Documentation

### TOTAL WORK
- **90+ endpoints** to integrate
- **40+ pages** to build
- **60+ components** to create
- **Estimated 6 weeks** for one developer
- **Could be 3 weeks** with 2 developers (parallel on features)

---

## FILES TO CREATE/MODIFY

### New API Wrappers
```
lib/api/admin.ts (users CRUD)
lib/api/states.ts
lib/api/uploads.ts (preview, confirm, submissions, tokens)
lib/api/transfers.ts
lib/api/audit.ts
lib/api/notifications.ts
```

### New Hooks
```
hooks/use-users.ts
hooks/use-states.ts
hooks/use-uploads.ts
hooks/use-submissions.ts
hooks/use-upload-tokens.ts
hooks/use-transfers.ts
hooks/use-audit.ts
hooks/use-notifications.ts
hooks/use-reports.ts (enhanced)
```

### New Pages (40 total)
```
# Admin
app/(dashboard)/admin/users/page.tsx
app/(dashboard)/admin/users/create/page.tsx
app/(dashboard)/admin/users/[id]/edit/page.tsx
app/(dashboard)/admin/transfers/page.tsx
app/(dashboard)/admin/transfers/[id]/page.tsx
app/(dashboard)/admin/audit/page.tsx
app/(dashboard)/admin/audit/[table]/[id]/page.tsx
app/(dashboard)/admin/upload-tokens/page.tsx
app/(dashboard)/admin/states/page.tsx
app/(dashboard)/admin/states/create/page.tsx
app/(dashboard)/admin/states/[id]/edit/page.tsx
app/(dashboard)/admin/settings/page.tsx

# Plants
app/(dashboard)/plants/create/page.tsx
app/(dashboard)/plants/[id]/page.tsx
app/(dashboard)/plants/[id]/edit/page.tsx

# Locations
app/(dashboard)/locations/create/page.tsx
app/(dashboard)/locations/[id]/page.tsx
app/(dashboard)/locations/[id]/edit/page.tsx

# Spare Parts
app/(dashboard)/spare-parts/create/page.tsx
app/(dashboard)/spare-parts/bulk-upload/page.tsx
app/(dashboard)/spare-parts/direct-entry/page.tsx
app/(dashboard)/spare-parts/[id]/page.tsx

# Suppliers
app/(dashboard)/suppliers/page.tsx
app/(dashboard)/suppliers/create/page.tsx
app/(dashboard)/suppliers/[id]/page.tsx
app/(dashboard)/suppliers/[id]/edit/page.tsx

# Uploads
app/(dashboard)/uploads/page.tsx
app/(dashboard)/uploads/submissions/page.tsx
app/(dashboard)/uploads/submissions/[id]/page.tsx
app/(dashboard)/uploads/tokens/page.tsx

# Reports
app/(dashboard)/reports/fleet-summary/page.tsx
app/(dashboard)/reports/maintenance-costs/page.tsx
app/(dashboard)/reports/verification/page.tsx
app/(dashboard)/reports/compliance/page.tsx
app/(dashboard)/reports/trends/page.tsx
app/(dashboard)/reports/unverified/page.tsx
app/(dashboard)/reports/export/page.tsx

# Notifications
app/(dashboard)/notifications/page.tsx
```

### New Components (60+ total)
- Forms (users, plants, locations, spare-parts, suppliers, states)
- Tables (transfers, audit logs, tokens)
- Detail page tabs
- Charts & Analytics
- Modals (transfer, confirm, etc.)
- Filters & Search
- Loading skeletons
- Empty states

---

## NEXT STEPS FOR IMPLEMENTATION

1. **Start with Phase 1**: Users + Plant CRUD (most critical)
2. **Test each component** as you build it
3. **API integration first**: Wire up hooks before UI polish
4. **Performance**: Use virtualization for large tables
5. **Error handling**: Consistent error messages
6. **Accessibility**: Test with keyboard navigation
7. **Responsive**: Mobile design from day 1
8. **Documentation**: Keep docs updated as you build

---

**This roadmap covers every single backend endpoint and shows exactly which frontend pages/components need to be built to consume them. You now have a complete blueprint for the entire remaining frontend work.**
