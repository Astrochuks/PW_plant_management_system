/**
 * React Query hooks for user management
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as adminApi from '@/lib/api/admin'

const USERS_QUERY_KEY = ['users']
const USER_KEY = (id: string) => ['users', id]

/**
 * Fetch all users with optional filters
 */
export function useUsers(filters?: { role?: 'admin' | 'management'; is_active?: boolean }) {
  return useQuery({
    queryKey: [USERS_QUERY_KEY, filters],
    queryFn: () => adminApi.listUsers(filters),
    staleTime: 5 * 60 * 1000, // 5 minutes
    select: (data) => data.data,
  })
}

/**
 * Fetch a specific user by ID
 */
export function useUser(userId: string | null) {
  return useQuery({
    queryKey: userId ? USER_KEY(userId) : ['users', null],
    queryFn: () => (userId ? adminApi.getUser(userId) : Promise.reject(new Error('No user ID'))),
    staleTime: 10 * 60 * 1000, // 10 minutes
    enabled: !!userId,
    select: (data: adminApi.UserResponse) => data.data,
  })
}

/**
 * Create a new user
 */
export function useCreateUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: adminApi.createUser,
    onSuccess: () => {
      // Invalidate users list to refetch
      queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY })
    },
  })
}

/**
 * Update a user
 */
export function useUpdateUser(userId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Parameters<typeof adminApi.updateUser>[1]) =>
      adminApi.updateUser(userId, data),
    onSuccess: (data) => {
      // Update both the specific user and users list
      queryClient.setQueryData(USER_KEY(userId), { data: data.data })
      queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY })
    },
  })
}

/**
 * Reset a user's password
 */
export function useResetUserPassword() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: adminApi.resetUserPassword,
    onSuccess: () => {
      // Invalidate users list
      queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY })
    },
  })
}

/**
 * Deactivate a user
 */
export function useDeactivateUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: adminApi.deactivateUser,
    onSuccess: () => {
      // Invalidate users list
      queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY })
    },
  })
}
