/**
 * Global token refresh with a mutex + circuit breaker.
 *
 * ALL callers (apiClient interceptor, AuthProvider timer, SSE reconnect)
 * MUST use refreshTokenGlobal() to prevent concurrent refresh attempts.
 * Supabase rotates refresh tokens on each use — concurrent calls cause
 * "Invalid Refresh Token: Already Used" storms and rate-limit lockout.
 *
 * Two failure classes are handled differently:
 *   - TRANSIENT (network error, 5xx, timeout): throw so the caller can retry.
 *   - PERMANENT (400/401 "Invalid Refresh Token: Already Used" / expired): the
 *     refresh-token chain is unrecoverable. We tear the session down ONCE —
 *     clear storage, trip the circuit breaker, and broadcast `auth:session-expired`
 *     — so that no further /auth/refresh calls are ever fired with the dead token.
 *     Without this breaker, the request-interceptor preflight re-fires a refresh
 *     on every outgoing request → an endless 401 storm.
 */

import type { LoginResponse } from './auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Event broadcast when the refresh-token chain is permanently dead, so the
// AuthProvider can drop the user and route to /login (or show a re-login prompt).
export const SESSION_EXPIRED_EVENT = 'auth:session-expired';

// Global mutex — only ONE refresh in flight at any time
let refreshPromise: Promise<LoginResponse | null> | null = null;

// Circuit breaker — once the refresh token is known dead, stop hitting the
// network. Reset to false on a successful login/refresh (markSessionAlive()).
let sessionDead = false;

/** Reset the circuit breaker after a fresh login or successful refresh. */
export function markSessionAlive(): void {
  sessionDead = false;
}

/** True once the refresh-token chain is permanently broken. */
export function isSessionDead(): boolean {
  return sessionDead;
}

function tearDownDeadSession(): void {
  if (sessionDead || typeof window === 'undefined') return;
  sessionDead = true;
  sessionStorage.removeItem('access_token');
  sessionStorage.removeItem('refresh_token');
  sessionStorage.removeItem('user');
  sessionStorage.removeItem('token_expires_at');
  // Notify the app exactly once. Listeners decide how to surface re-login.
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

/**
 * Refresh the token, deduplicating concurrent calls.
 *
 * - If the circuit breaker is tripped, returns null immediately (no network).
 * - If a refresh is already in flight, returns the same promise.
 * - On success, persists the rotated tokens INSIDE the mutex and returns them.
 * - On 400/401: if another caller already saved a newer token, returns null
 *   (benign race); otherwise the chain is dead → tear down the session.
 * - On network/5xx errors, throws so caller can retry later.
 */
export async function refreshTokenGlobal(): Promise<LoginResponse | null> {
  // Circuit breaker: session is already known dead — never touch the network.
  if (sessionDead) return null;

  // Coalesce: if a refresh is in-flight, piggyback on it
  if (refreshPromise) return refreshPromise;

  const refreshToken = typeof window !== 'undefined'
    ? sessionStorage.getItem('refresh_token')
    : null;

  if (!refreshToken) return null;

  // Snapshot the current tokens so we can detect if another path saved newer ones
  const tokenBefore = sessionStorage.getItem('access_token');

  refreshPromise = (async (): Promise<LoginResponse | null> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: AbortSignal.timeout(15000),
      });

      if (response.ok) {
        // Await the body and persist the rotated tokens BEFORE the finally
        // block clears refreshPromise. This is critical: Supabase rotates the
        // refresh token on every use, so the new token must be in sessionStorage
        // before the mutex releases. Otherwise a request arriving in the gap
        // between "mutex released" and "caller saves tokens" would re-send the
        // now-stale refresh token → "Invalid Refresh Token: Already Used" storms.
        const data = (await response.json()) as LoginResponse;
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('access_token', data.access_token);
          sessionStorage.setItem('refresh_token', data.refresh_token);
          if (data.user) sessionStorage.setItem('user', JSON.stringify(data.user));
          const expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
          sessionStorage.setItem('token_expires_at', String(expiresAt));
        }
        sessionDead = false;
        return data;
      }

      // 400/401 — refresh token rejected (rotated/expired/already-used)
      if (response.status === 400 || response.status === 401) {
        // If another caller already saved a newer token, this is a benign race —
        // the session is fine; just return null and let the caller use storage.
        const tokenNow = sessionStorage.getItem('access_token');
        if (tokenNow && tokenNow !== tokenBefore) {
          return null;
        }
        // No newer token → the chain is permanently dead. Trip the breaker so
        // nothing fires another refresh with this token.
        tearDownDeadSession();
        return null;
      }

      // 5xx or other — transient, throw so caller can retry
      throw new Error(`Refresh failed with status ${response.status}`);
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * @deprecated Use refreshTokenGlobal() instead.
 * Kept as alias for backward compatibility.
 */
export const silentRefreshToken = refreshTokenGlobal;
