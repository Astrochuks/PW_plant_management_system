/**
 * API Client for PW Plant Management System
 * Handles all HTTP requests to the FastAPI backend
 */

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import { refreshTokenGlobal } from './silent-refresh';

// API base URL - defaults to localhost for development
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Create axios instance with default config
const apiClient: AxiosInstance = axios.create({
  baseURL: `${API_BASE_URL}/api/v1`,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

// Guard against multiple 401 redirects firing simultaneously
let isRedirecting = false;

/**
 * Attempt to refresh the access token using the global mutex.
 * Returns the new access token on success, or null on failure.
 */
async function tryRefreshToken(): Promise<string | null> {
  const tokenBefore = sessionStorage.getItem('access_token');

  try {
    const response = await refreshTokenGlobal();
    if (response) {
      // Save tokens directly (can't import saveAuthData — circular dep)
      sessionStorage.setItem('access_token', response.access_token);
      sessionStorage.setItem('refresh_token', response.refresh_token);
      if (response.user) sessionStorage.setItem('user', JSON.stringify(response.user));
      const expiresAt = Date.now() + (response.expires_in || 3600) * 1000;
      sessionStorage.setItem('token_expires_at', String(expiresAt));
      return response.access_token;
    }
    // Refresh returned null — check if another caller already saved new tokens
    const tokenNow = sessionStorage.getItem('access_token');
    if (tokenNow && tokenNow !== tokenBefore) {
      return tokenNow;
    }
    return null;
  } catch {
    // Network error — check if another caller saved tokens while we waited
    const tokenNow = sessionStorage.getItem('access_token');
    if (tokenNow && tokenNow !== tokenBefore) {
      return tokenNow;
    }
    return null;
  }
}

// Pre-flight refresh: if token expires within 2 minutes, refresh before sending
const PREFLIGHT_BUFFER_MS = 2 * 60 * 1000;
let preflightRefreshPromise: Promise<void> | null = null;

async function ensureFreshToken(): Promise<void> {
  if (typeof window === 'undefined') return;
  const expiresAt = Number(sessionStorage.getItem('token_expires_at') || '0');
  if (!expiresAt || expiresAt - Date.now() > PREFLIGHT_BUFFER_MS) return;

  // Token is about to expire — refresh before sending the request
  if (preflightRefreshPromise) return preflightRefreshPromise;
  preflightRefreshPromise = (async () => {
    try {
      await tryRefreshToken();
    } catch { /* interceptor will handle 401 as fallback */ }
    finally { preflightRefreshPromise = null; }
  })();
  return preflightRefreshPromise;
}

// Request interceptor - refreshes token if needed, then adds auth header
apiClient.interceptors.request.use(
  async (config) => {
    if (typeof window !== 'undefined') {
      // Proactively refresh if token is about to expire
      await ensureFreshToken();
      const token = sessionStorage.getItem('access_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

function hardLogout(): void {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem('access_token');
    sessionStorage.removeItem('refresh_token');
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('token_expires_at');
    // Don't redirect while user is editing uploads — they'll see an error toast
    // and can re-login in a new tab without losing progress
    const isOnUploads = window.location.pathname.startsWith('/uploads');
    if (!isRedirecting && !isOnUploads && !window.location.pathname.includes('/login')) {
      isRedirecting = true;
      window.location.href = '/login';
    }
  }
}

// Response interceptor - handles errors globally
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (error.response) {
      const status = error.response.status;
      const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean; _retryCount?: number };

      // 503 Service Unavailable — DB is down, retry after delay (DON'T logout)
      if (status === 503 && typeof window !== 'undefined') {
        const retryCount = originalRequest._retryCount || 0;
        if (retryCount < 3) {
          originalRequest._retryCount = retryCount + 1;
          const retryAfter = Number(error.response.headers?.['retry-after'] || 3) * 1000;
          await new Promise(resolve => setTimeout(resolve, retryAfter));
          return apiClient(originalRequest);
        }
        // Exhausted retries — let the error propagate (toast, not logout)
        return Promise.reject(error);
      }

      // Unauthorized - try refresh before logging out
      if (status === 401 && typeof window !== 'undefined') {
        // Don't retry refresh or login requests
        const url = originalRequest.url || '';
        if (url.includes('/auth/refresh') || url.includes('/auth/login') || originalRequest._retry) {
          hardLogout();
          return Promise.reject(error);
        }

        // Attempt token refresh
        originalRequest._retry = true;
        const newToken = await tryRefreshToken();
        if (newToken) {
          // Retry the original request with the new token
          originalRequest.headers = {
            ...originalRequest.headers,
            Authorization: `Bearer ${newToken}`,
          };
          return apiClient(originalRequest);
        }

        // Refresh failed — hard logout
        hardLogout();
      }

      // Forbidden
      if (status === 403) {
        console.error('Access forbidden');
      }
    }

    return Promise.reject(error);
  }
);

// API response types
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export interface ApiError {
  detail: string | { message: string; code: string }[];
}

// Helper function to extract error message
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;

    // Our backend format: { success: false, error: { message: "..." } }
    if (data?.error?.message) {
      return data.error.message;
    }

    // FastAPI validation format: { detail: "..." | [...] }
    if (data?.detail) {
      const detail = data.detail;
      if (typeof detail === 'string') {
        return detail;
      }
      if (Array.isArray(detail)) {
        return detail.map((d: { message?: string; msg?: string }) => d.message || d.msg).join(', ');
      }
    }

    // Friendly fallbacks
    const status = error.response?.status;
    if (status === 401) return 'Session expired. Please log in again.';
    if (status === 403) return 'You do not have permission to do this';
    if (status === 404) return 'Resource not found';
    if (status === 429) return 'Too many attempts. Please wait and try again';

    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unexpected error occurred';
}

// Export the client
export default apiClient;
