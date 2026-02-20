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
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface ProfileData {
  id: string;
  email: string;
  role: string;
  full_name: string | null;
  is_admin: boolean;
  created_at: string | null;
  last_login_at: string | null;
}

export interface ChangePasswordData {
  current_password: string;
  new_password: string;
}

// API Functions
export async function login(credentials: LoginCredentials): Promise<LoginResponse> {
  const response = await apiClient.post<LoginResponse>('/auth/login', credentials, {
    timeout: 30000,
  });
  return response.data;
}

export function logout(): void {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  if (token) {
    apiClient.post('/auth/logout').catch(() => {});
  }
  if (typeof window !== 'undefined') {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    localStorage.removeItem('token_expires_at');
  }
}

export async function getCurrentUser(): Promise<User> {
  const response = await apiClient.get<ApiResponse<User>>('/auth/me');
  return response.data.data;
}

export async function getProfile(): Promise<ProfileData> {
  const response = await apiClient.get<ApiResponse<ProfileData>>('/auth/me');
  return response.data.data;
}

export async function updateProfile(data: { full_name: string }): Promise<ProfileData> {
  const response = await apiClient.patch<ApiResponse<ProfileData>>('/auth/me', data);
  return response.data.data;
}

export async function changePassword(data: ChangePasswordData): Promise<void> {
  await apiClient.post('/auth/change-password', data);
}

export async function refreshToken(): Promise<LoginResponse> {
  const storedRefreshToken = typeof window !== 'undefined'
    ? localStorage.getItem('refresh_token')
    : null;

  if (!storedRefreshToken) {
    throw new Error('No refresh token available');
  }

  const response = await apiClient.post<LoginResponse>(
    '/auth/refresh',
    { refresh_token: storedRefreshToken },
    { timeout: 15000 },
  );
  return response.data;
}

// Helper to save auth data to localStorage
export function saveAuthData(loginResponse: LoginResponse): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('access_token', loginResponse.access_token);
    localStorage.setItem('refresh_token', loginResponse.refresh_token);
    localStorage.setItem('user', JSON.stringify(loginResponse.user));
    // Store when the token expires (now + expires_in seconds)
    const expiresAt = Date.now() + (loginResponse.expires_in || 3600) * 1000;
    localStorage.setItem('token_expires_at', String(expiresAt));
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

// Helper to get token expiry time
export function getTokenExpiresAt(): number | null {
  if (typeof window !== 'undefined') {
    const val = localStorage.getItem('token_expires_at');
    return val ? Number(val) : null;
  }
  return null;
}
