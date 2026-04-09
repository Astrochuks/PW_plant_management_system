# Pending Items — To Revisit

## Render Deployment
- Deploy to Render (free tier, Frankfurt)
- Connect GitHub repo for auto-deploy (Settings → Build & Deploy → Auto-Deploy ON)
- Set environment variables in Render dashboard (SUPABASE_URL, DATABASE_URL, etc.)
- User needs to share Render build logs if deploy fails — check Events tab
- Dockerfile optimized (commit 80c8484): healthcheck start-period=120s, workers=1

## Login Performance (5-9 seconds)
- Root cause: Supabase Auth `sign_in_with_password()` is a sync network call (2-4s)
- Dashboard loads 4 parallel API calls after redirect (1-2s)
- asyncpg queries are fast (2-5ms) — bottleneck is Supabase Auth API
- Options to improve:
  - Lazy-load non-critical dashboard charts (fleet summary, map, recent purchases)
  - Consider local JWT auth to bypass Supabase Auth API
  - Accept that auth is network-bound (~3s minimum)

## System Audit Fixes Still Pending
- See `docs/SYSTEM_AUDIT_2026_03_31.md` for full list
- No Error Boundaries in frontend (white screen on crash)
- No success toasts on create/update mutations
- No unsaved form warning on navigation
- Inconsistent loading states across pages
- No tests (backend or frontend)
- Previous week remarks carryover not flagged as stale
- Physical verification defaults to true (inflated rates)
- Unresolved transfer locations stuck forever
- Float for financial fields instead of Decimal
