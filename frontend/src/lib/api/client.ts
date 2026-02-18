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
  timeout: 30000, // 30 second timeout
});

// Request interceptor - adds auth token to requests
apiClient.interceptors.request.use(
  (config) => {
    // Get token from localStorage (client-side only)
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

// Response interceptor - handles errors globally
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    // Handle specific error cases
    if (error.response) {
      const status = error.response.status;
      
      // Unauthorized - clear token and redirect to login
      if (status === 401) {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('access_token');
          localStorage.removeItem('user');
          // Only redirect if not already on login page
          if (!window.location.pathname.includes('/login')) {
            window.location.href = '/login';
          }
        }
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

    // Friendly fallbacks instead of "Request failed with status code 401"
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
