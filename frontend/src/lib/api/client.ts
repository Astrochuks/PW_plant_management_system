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

// Request interceptor - adds auth token to requests
apiClient.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
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

function hardLogout(): void {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem('access_token');
    sessionStorage.removeItem('refresh_token');
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('token_expires_at');
    if (!isRedirecting && !window.location.pathname.includes('/login')) {
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
      const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

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
    if (status === 401) return 'Invalid email or password';
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
