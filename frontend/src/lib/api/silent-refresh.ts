/**
 * Silent token refresh that bypasses the apiClient interceptors.
 *
 * This is critical: the proactive refresh scheduled by AuthProvider must NOT
 * go through apiClient, because if Supabase's refresh-token rotation causes
 * the call to fail (another concurrent refresh already rotated the token),
 * the 401 response interceptor would call hardLogout() and kick the user out.
 *
 * By using raw fetch we avoid that entirely.
 */

import type { LoginResponse } from './auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/**
 * Attempt to refresh the token silently (no interceptors).
 * Returns the new LoginResponse on success, or null if the token was
 * already rotated (another refresh won the race).
 * Throws on network errors so the caller can retry.
 */
export async function silentRefreshToken(): Promise<LoginResponse | null> {
  const refreshToken = typeof window !== 'undefined'
    ? localStorage.getItem('refresh_token')
    : null;

  if (!refreshToken) return null;

  const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (response.ok) {
    return response.json() as Promise<LoginResponse>;
  }

  // 400/401 from Supabase means the refresh token was already rotated
  // by another concurrent refresh (the interceptor in client.ts).
  // This is NOT an error — the interceptor already saved the new tokens.
  if (response.status === 400 || response.status === 401) {
    return null;
  }

  // Anything else (5xx, network) — throw so caller retries
  throw new Error(`Refresh failed with status ${response.status}`);
}
