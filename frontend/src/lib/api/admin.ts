/**
 * Admin API endpoints - User management, settings, configuration
 */

import apiClient from './client'

export interface User {
  id: string
  email: string
  full_name: string
  role: 'admin' | 'management'
  is_active: boolean
  must_change_password: boolean
  last_login_at: string | null
  created_at: string
  updated_at?: string
}

export interface CreateUserRequest {
  email: string
  password: string
  full_name: string
  role: 'admin' | 'management'
}

export interface UpdateUserRequest {
  full_name?: string
  role?: 'admin' | 'management'
  is_active?: boolean
}

export interface ResetPasswordRequest {
  new_password: string
}

export interface UserListResponse {
  success: boolean
  data: User[]
}

export interface UserResponse {
  success: boolean
  data: User
  message: string
}

/**
 * Create a new user (Admin only)
 */
export async function createUser(data: CreateUserRequest): Promise<UserResponse> {
  const response = await apiClient.post<UserResponse>('/auth/users', data)
  return response.data
}

/**
 * Get all users with optional filters (Admin only)
 */
export async function listUsers(
  filters?: {
    role?: 'admin' | 'management'
    is_active?: boolean
  }
): Promise<UserListResponse> {
  const params = new URLSearchParams()
  if (filters?.role) params.append('role', filters.role)
  if (filters?.is_active !== undefined) params.append('is_active', String(filters.is_active))

  const response = await apiClient.get<UserListResponse>('/auth/users', {
    params: Object.fromEntries(params),
  })
  return response.data
}

/**
 * Get a specific user by ID (Admin only)
 */
export async function getUser(userId: string): Promise<UserResponse> {
  const response = await apiClient.get<UserResponse>(`/auth/users/${userId}`)
  return response.data
}

/**
 * Update a user (Admin only)
 */
export async function updateUser(userId: string, data: UpdateUserRequest): Promise<UserResponse> {
  const response = await apiClient.patch<UserResponse>(`/auth/users/${userId}`, data)
  return response.data
}

/**
 * Reset a user's password (Admin only, sends temporary password)
 */
export async function resetUserPassword(userId: string): Promise<UserResponse> {
  const response = await apiClient.post<UserResponse>(`/auth/users/${userId}/reset-password`, {})
  return response.data
}

/**
 * Deactivate a user (Admin only)
 */
export async function deactivateUser(userId: string): Promise<UserResponse> {
  const response = await apiClient.post<UserResponse>(`/auth/users/${userId}/deactivate`, {})
  return response.data
}
