/**
 * API Client for PW Plant Management System
 * Handles all HTTP requests to the FastAPI backend
 */

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';

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
// Guard against multiple concurrent refresh attempts
let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;

// Request interceptor - adds auth token to requests
apiClient.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('access_token');
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
 * Attempt to refresh the access token using the stored refresh token.
 * Returns the new access token on success, or null on failure.
 */
async function tryRefreshToken(): Promise<string | null> {
  // Coalesce concurrent refresh attempts into one
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  const storedRefreshToken = localStorage.getItem('refresh_token');
  if (!storedRefreshToken) return null;

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      // Use raw axios to avoid interceptors triggering recursion
      const response = await axios.post(
        `${API_BASE_URL}/api/v1/auth/refresh`,
        { refresh_token: storedRefreshToken },
        { timeout: 15000 }
      );

      const data = response.data;
      const newToken = data.access_token;
      if (newToken) {
        localStorage.setItem('access_token', newToken);
        if (data.refresh_token) {
          localStorage.setItem('refresh_token', data.refresh_token);
        }
        if (data.expires_in) {
          const expiresAt = Date.now() + data.expires_in * 1000;
          localStorage.setItem('token_expires_at', String(expiresAt));
        }
        if (data.user) {
          localStorage.setItem('user', JSON.stringify(data.user));
        }
        return newToken;
      }
      return null;
    } catch {
      return null;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

function hardLogout(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    localStorage.removeItem('token_expires_at');
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
