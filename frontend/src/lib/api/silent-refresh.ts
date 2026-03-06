/**
 * Global token refresh with a mutex.
 *
 * ALL callers (apiClient interceptor, AuthProvider timer, SSE reconnect)
 * MUST use refreshTokenGlobal() to prevent concurrent refresh attempts.
 * Supabase rotates refresh tokens on each use — concurrent calls cause
 * "Invalid Refresh Token: Already Used" storms and rate-limit lockout.
 */

import type { LoginResponse } from './auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Global mutex — only ONE refresh in flight at any time
let refreshPromise: Promise<LoginResponse | null> | null = null;

/**
 * Refresh the token, deduplicating concurrent calls.
 *
 * - If a refresh is already in flight, returns the same promise.
 * - On success, returns LoginResponse (caller saves tokens).
 * - On 400/401 ("Already Used"), checks if sessionStorage was updated
 *   by the winning caller and returns null (not an error).
 * - On network/5xx errors, throws so caller can retry later.
 */
export async function refreshTokenGlobal(): Promise<LoginResponse | null> {
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
        return response.json() as Promise<LoginResponse>;
      }

      // 400/401 — token was already rotated by another caller
      if (response.status === 400 || response.status === 401) {
        // Check if someone else already saved a new token
        const tokenNow = sessionStorage.getItem('access_token');
        if (tokenNow && tokenNow !== tokenBefore) {
          // Another caller won the race — return null (not an error)
          return null;
        }
        // No new token → genuinely expired/invalid
        return null;
      }

      // 5xx or other — throw so caller can retry
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
