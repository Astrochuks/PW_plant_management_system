/**
 * Authentication API functions
 */

import apiClient, { ApiResponse, getErrorMessage } from './client';

// Types
export interface User {
  id: string;
  email: string;
  full_name: string | null;
  role: 'admin' | 'management';
  is_active: boolean;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

// API Functions
export async function login(credentials: LoginCredentials): Promise<LoginResponse> {
  // Backend returns LoginResponse directly (not wrapped in ApiResponse)
  const response = await apiClient.post<LoginResponse>('/auth/login', credentials);
  return response.data;
}

export function logout(): void {
  // Fire-and-forget: tell the server to revoke the session but don't wait for it.
  // The JWT expires naturally; clearing local storage is what actually logs the user out.
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  if (token) {
    apiClient.post('/auth/logout').catch(() => {
      // Server-side revocation is best-effort — not critical for logout UX
    });
  }
  // Clear local storage immediately
  if (typeof window !== 'undefined') {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
  }
}

export async function getCurrentUser(): Promise<User> {
  // Backend returns { success: true, data: User }
  const response = await apiClient.get<ApiResponse<User>>('/auth/me');
  return response.data.data;
}

export async function refreshToken(): Promise<{ access_token: string }> {
  const response = await apiClient.post<ApiResponse<{ access_token: string }>>('/auth/refresh');
  return response.data.data;
}

// Helper to save auth data to localStorage
export function saveAuthData(loginResponse: LoginResponse): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('access_token', loginResponse.access_token);
    localStorage.setItem('user', JSON.stringify(loginResponse.user));
  }
}

// Helper to get saved user from localStorage
export function getSavedUser(): User | null {
  if (typeof window !== 'undefined') {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        return JSON.parse(userStr) as User;
      } catch {
        return null;
      }
    }
  }
  return null;
}

// Helper to check if user is authenticated
export function isAuthenticated(): boolean {
  if (typeof window !== 'undefined') {
    return !!localStorage.getItem('access_token');
  }
  return false;
}
