# Backend Assessment & Development Roadmap

## Executive Summary

**Current State**: The backend has a solid foundation with 68 endpoints across 9 modules, JWT authentication, role-based access control, and comprehensive database schema. However, several areas need hardening for production use.

**Key Gaps Identified**:
1. Authentication needs security hardening (rate limiting, audit logging)
2. No audit trail for admin CRUD operations
3. Manual data entry endpoints incomplete
4. AI integration not implemented
5. Missing input validation on some endpoints
6. No automated testing

---

## 1. Current Inventory

### 1.1 Database Tables (13 tables)

| Table | Rows | Purpose | RLS |
|-------|------|---------|-----|
| `plants_master` | 1,601 | Current plant state (live data) | ✅ |
| `archived_plants` | 478 | Legacy plants not yet in reports | ✅ |
| `plant_weekly_records` | 1,732 | Immutable weekly snapshots | ✅ |
| `plant_location_history` | 1,587 | Movement tracking | ✅ |
| `plant_events` | 0 | Movement/missing/new events | ✅ |
| `spare_parts` | 458 | Maintenance cost tracking | ✅ |
| `locations` | 27 | Site locations | ✅ |
| `fleet_number_prefixes` | 79 | Prefix → fleet type mapping | ✅ |
| `users` | 2 | System users | ✅ |
| `notifications` | 0 | In-app alerts | ✅ |
| `upload_tokens` | 0 | Site officer access tokens | ✅ |
| `weekly_report_submissions` | 0 | Upload tracking | ✅ |
| `purchase_order_submissions` | 0 | PO upload tracking | ✅ |

### 1.2 API Endpoints (68 total)

| Module | Endpoints | Auth Required | Admin Only |
|--------|-----------|---------------|------------|
| Auth | 12 | Partial | 6 |
| Health | 4 | No | 0 |
| Plants | 13 | Yes | 4 |
| Uploads | 6 | Token-based | 2 |
| Locations | 6 | Yes | 2 |
| Fleet Types | 3 | Yes | 0 |
| Spare Parts | 8 | Yes | 3 |
| Reports | 11 | Yes | 0 |
| Notifications | 5 | Yes | 0 |

### 1.3 Authentication Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│  FastAPI    │────▶│  Supabase   │
│             │     │  Backend    │     │    Auth     │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       │  1. Login         │  2. Verify JWT    │
       │  (email/pass)     │  with Supabase    │
       │                   │                   │
       │  3. Return        │  4. Check user    │
       │  tokens           │  in users table   │
       │                   │                   │
       ▼                   ▼                   ▼
   Store tokens      Extract role        Validate token
   in client         from users          signature
```

**Current Auth Features**:
- JWT-based authentication via Supabase Auth
- Access token + Refresh token pattern
- Role-based access (admin, management)
- User deactivation support
- Password change enforcement

**Missing Auth Features**:
- ❌ Rate limiting (configured but not enforced)
- ❌ Login attempt tracking
- ❌ Account lockout after failed attempts
- ❌ Session management (active sessions list)
- ❌ Audit logging for auth events

---

## 2. Gap Analysis

### 2.1 Authentication Gaps

| Gap | Risk | Priority |
|-----|------|----------|
| No rate limiting on login | Brute force attacks | HIGH |
| No login audit trail | Can't detect breaches | HIGH |
| No account lockout | Unlimited attempts | MEDIUM |
| No session listing | Can't revoke sessions | LOW |

### 2.2 Audit Trail Gaps

| Operation | Currently Audited? | Needed? |
|-----------|-------------------|---------|
| User login/logout | ❌ No | ✅ Yes |
| Plant create/update/delete | ❌ No | ✅ Yes |
| Spare part create/update/delete | ❌ No | ✅ Yes |
| Location create/update | ❌ No | ✅ Yes |
| User management | ❌ No | ✅ Yes |
| Report uploads | ✅ Partial (submissions table) | ✅ Yes |
| Token generation | ❌ No | ✅ Yes |

### 2.3 Manual Data Entry Gaps

**Weekly Reports**:
| Feature | Status |
|---------|--------|
| File upload via token | ✅ Exists |
| File upload via admin | ✅ Exists |
| Manual entry form | ❌ Missing |
| Link submission (email/WhatsApp) | ❌ Missing |

**Purchase Orders/Spare Parts**:
| Feature | Status |
|---------|--------|
| File upload via token | ✅ Exists |
| Single spare part entry | ✅ Exists |
| Bulk spare parts entry | ❌ Missing |
| PO form with line items | ❌ Missing |

### 2.4 AI Integration Opportunities

| Use Case | Value | Complexity |
|----------|-------|------------|
| Status extraction from remarks | HIGH - Automates classification | LOW |
| Anomaly detection (spending patterns) | HIGH - Fraud prevention | MEDIUM |
| Predictive maintenance | MEDIUM - Plan ahead | HIGH |
| Natural language queries | MEDIUM - User convenience | MEDIUM |
| Report summarization | LOW - Nice to have | LOW |

**Recommended AI Priority**:
1. **Status extraction** - Already partially implemented with keywords, AI can handle edge cases
2. **Anomaly detection** - Flag suspicious spending (missing plant has parts, high spend on unverified)
3. **Report summarization** - Weekly digest of key events

---

## 3. Data Input Methods

### 3.1 Current Methods

```
┌─────────────────────────────────────────────────────────────┐
│                     DATA INPUT METHODS                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ File Upload  │    │ Token Upload │    │ Manual Entry │  │
│  │ (Admin)      │    │ (Site Officer)│   │ (Admin)      │  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘  │
│         │                   │                   │           │
│         ▼                   ▼                   ▼           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                   ETL PIPELINE                        │  │
│  │  - Column mapping (20+ variations)                    │  │
│  │  - Data normalization                                 │  │
│  │  - Status extraction                                  │  │
│  │  - Duplicate handling                                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                           │                                  │
│                           ▼                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                   DATABASE                            │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Proposed Additional Methods

```
┌─────────────────────────────────────────────────────────────┐
│                  PROPOSED INPUT METHODS                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ Link Submit  │    │ Email Inbox  │    │ WhatsApp Bot │  │
│  │ (Shareable)  │    │ (Automated)  │    │ (Future)     │  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘  │
│         │                   │                   │           │
│         ▼                   ▼                   ▼           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              UNIFIED INGESTION QUEUE                  │  │
│  │  - Source tracking (upload/email/whatsapp/manual)    │  │
│  │  - Validation before processing                       │  │
│  │  - Duplicate detection                                │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Development Phases

### Phase 1: Authentication Hardening (Priority: HIGH)
- [ ] Implement rate limiting on login endpoint
- [ ] Add login attempt tracking
- [ ] Implement account lockout (5 failed attempts = 15 min lockout)
- [ ] Create audit log table for auth events
- [ ] Log all login/logout events
- [ ] Test authentication edge cases

### Phase 2: Audit Trail System (Priority: HIGH)
- [ ] Create `audit_logs` table
- [ ] Implement audit middleware/decorator
- [ ] Log all admin CRUD operations
- [ ] Add "changed_by" tracking to key tables
- [ ] Create audit log viewer endpoint

### Phase 3: Manual Data Entry (Priority: MEDIUM)
- [ ] Weekly report manual entry endpoint
- [ ] Purchase order form with line items
- [ ] Bulk spare parts entry
- [ ] Shareable upload links (no token required, time-limited)

### Phase 4: AI Integration (Priority: MEDIUM)
- [ ] Enhanced status extraction with AI fallback
- [ ] Spending anomaly detection
- [ ] Weekly digest generation

### Phase 5: Testing & Optimization (Priority: HIGH)
- [ ] Unit tests for all endpoints
- [ ] Integration tests for workflows
- [ ] Load testing
- [ ] Query optimization
- [ ] Response time benchmarking

---

## 5. Detailed Phase 1: Authentication

### 5.1 Current Auth Endpoints

```python
# Existing endpoints
POST /api/v1/auth/login          # Login with email/password
POST /api/v1/auth/refresh        # Refresh access token
POST /api/v1/auth/logout         # Logout
GET  /api/v1/auth/me             # Get current user
PATCH /api/v1/auth/me            # Update profile
POST /api/v1/auth/change-password # Change password

# Admin endpoints
POST /api/v1/auth/users          # Create user
GET  /api/v1/auth/users          # List users
GET  /api/v1/auth/users/{id}     # Get user
PATCH /api/v1/auth/users/{id}    # Update user
POST /api/v1/auth/users/{id}/reset-password  # Reset password
DELETE /api/v1/auth/users/{id}   # Deactivate user
```

### 5.2 Proposed Auth Improvements

**New Table: `auth_events`**
```sql
CREATE TABLE auth_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    event_type VARCHAR(50) NOT NULL,  -- login_success, login_failed, logout, password_changed, etc.
    ip_address INET,
    user_agent TEXT,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_auth_events_user_id ON auth_events(user_id);
CREATE INDEX idx_auth_events_created_at ON auth_events(created_at);
CREATE INDEX idx_auth_events_type ON auth_events(event_type);
```

**New Table: `login_attempts`**
```sql
CREATE TABLE login_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    ip_address INET,
    success BOOLEAN NOT NULL,
    failure_reason VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_login_attempts_email ON login_attempts(email);
CREATE INDEX idx_login_attempts_ip ON login_attempts(ip_address);
CREATE INDEX idx_login_attempts_created_at ON login_attempts(created_at);
```

**Rate Limiting Logic**:
```python
async def check_rate_limit(email: str, ip: str) -> tuple[bool, str]:
    """
    Check if login should be allowed.

    Rules:
    - Max 5 failed attempts per email in 15 minutes
    - Max 20 failed attempts per IP in 15 minutes
    - After lockout, must wait 15 minutes

    Returns: (allowed: bool, reason: str)
    """
```

### 5.3 Testing Checklist

| Test Case | Expected Result |
|-----------|-----------------|
| Valid login | Returns tokens, logs success |
| Invalid password | Returns 401, logs failure |
| 5 failed attempts | Account locked for 15 min |
| Locked account login | Returns 429 with unlock time |
| Login after lockout expires | Allowed |
| Refresh with valid token | Returns new access token |
| Refresh with expired token | Returns 401 |
| Access protected route without token | Returns 401 |
| Access admin route as management | Returns 403 |
| Deactivated user login | Returns 401 |

---

## 6. Questions to Discuss

### 6.1 Authentication
1. Should we support password-less login (magic links)?
2. Should we support 2FA for admin accounts?
3. What should the lockout duration be? (Currently proposing 15 min)

### 6.2 Audit Trail
1. How long should audit logs be retained?
2. Should audit logs be in same DB or separate?
3. Who can view audit logs? (Admin only?)

### 6.3 Data Input
1. For shareable links - should they be time-limited? (e.g., 24 hours)
2. For email ingestion - do you have a dedicated email address?
3. Should manual entry allow backdating? (Enter data for past weeks)

### 6.4 AI Integration
1. Which AI provider? (Claude API, OpenAI, local model)
2. Should AI run on every record or only ambiguous ones?
3. Budget for AI API calls?

---

## 7. Performance Measurements

### Phase 1: Authentication (Measured 2026-02-04)

**Endpoint Response Times:**
| Endpoint | Target | Measured | Status |
|----------|--------|----------|--------|
| Health check | <50ms | 6ms | OK |
| Login (invalid) | <2000ms | 1156ms | OK |
| Login (with rate check) | <2000ms | ~1200ms | OK |

**Database Query Performance:**
| Query | Target | Measured | Status |
|-------|--------|----------|--------|
| Users list | <500ms | 337ms | OK |
| Plants list (20) | <300ms | 217ms | OK |
| Plants + location join | <300ms | 265ms | OK |
| Plant by fleet_number | <300ms | 223ms | OK |
| Locations list | <300ms | 197ms | OK |
| Spare parts (20) | <300ms | 203ms | OK |
| Weekly records (20) | <300ms | 236ms | OK |

**Auth Security RPC Performance:**
| Function | Measured |
|----------|----------|
| record_auth_event | 205ms |
| record_login_attempt | 202ms |
| is_account_locked | 195ms |
| count_failed_attempts | 276ms |

**Note:** Response times include network latency to Supabase. Production deployment with edge functions may be faster.

---

## 8. Implementation Progress

### Phase 1: Authentication Hardening - COMPLETED

**Date:** 2026-02-04

**New Database Tables:**
- `auth_events` - Audit trail for all authentication events (kept forever)
- `login_attempts` - Rate limiting tracking
- `account_lockouts` - Active lockout management

**New RPC Functions:**
- `record_auth_event()` - Log auth events to audit trail
- `record_login_attempt()` - Record login attempt for rate limiting
- `is_account_locked()` - Check if account/IP is locked
- `count_failed_attempts()` - Count recent failures
- `create_account_lockout()` - Create lockout record

**New Backend Components:**
- `app/services/auth_service.py` - Auth service with rate limiting and audit logging

**New API Endpoints:**
- `GET /api/v1/auth/events` - View auth events (admin only)
- `GET /api/v1/auth/login-attempts` - View login attempts (admin only)
- `GET /api/v1/auth/lockouts` - View active lockouts (admin only)
- `POST /api/v1/auth/lockouts/{id}/unlock` - Manually unlock account (admin only)

**Security Features Implemented:**
- Rate limiting: 5 failed attempts locks account for 15 minutes
- IP validation for INET type compatibility
- All auth events logged to audit trail
- Login success/failure tracking
- User management audit (create, update, deactivate, password reset)

**Test Results:**
- Rate limiting: Working (account locks after 5 failures)
- Audit logging: Working (events recorded to auth_events table)
- IP handling: Working (invalid IPs handled gracefully)

### Phase 1b: Security Hardening - COMPLETED

**Date:** 2026-02-05

**Vulnerability Assessment & Fixes:**

| # | Issue | Severity | Fix Applied |
|---|-------|----------|-------------|
| 1 | Shared singleton client race condition | CRITICAL | `create_auth_client()` — fresh client per login/refresh, no shared session state |
| 2 | Change-password didn't verify current password | CRITICAL | Now calls `sign_in_with_password` to verify before allowing change |
| 3 | X-Forwarded-For header spoofing | HIGH | Only trusts proxy headers when `TRUST_PROXY=true` in settings |
| 4 | No rate limiting on refresh endpoint | HIGH | Moved logging to background tasks for performance |
| 5 | Deactivated user sessions still valid | HIGH | Now calls `admin.sign_out(user_id)` on deactivation to revoke sessions |
| 6 | Error messages leaked exception internals | MEDIUM | All error responses now return generic messages; details logged server-side |
| 7 | CORS used wildcard methods/headers | MEDIUM | Restricted to specific methods (GET/POST/PATCH/DELETE) and headers |
| 8 | No password complexity requirements | MEDIUM | Added: 12+ chars, uppercase, lowercase, number required |

**Files Changed:**
- `app/core/database.py` — Added `create_auth_client()` factory for per-request auth clients
- `app/core/security.py` — Uses admin client for user lookups, removed error string leakage
- `app/api/v1/auth.py` — Fresh clients for auth ops, password verification, password policy
- `app/config.py` — Added `trust_proxy` setting
- `app/main.py` — Fixed error leakage, tightened CORS

**Request Reduction:**
- Login: Uses fresh per-request client (no shared state corruption)
- Change-password: Uses admin API `update_user_by_id` (no session dependency)
- Logout: Uses admin API `sign_out(user_id)` (no shared client mutation)
- Refresh: Uses fresh per-request client (no session race condition)

---

## 9. Next Steps

1. **Phase 2** - Audit trail for CRUD operations (plants, spare parts, locations)
2. **Phase 3** - Manual data entry endpoints
3. **Phase 4** - AI integration (Gemini)
4. **Phase 5** - Comprehensive testing and optimization

---

*Document created: 2026-02-04*
*Last updated: 2026-02-05*
