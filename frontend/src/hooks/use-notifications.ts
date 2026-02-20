/**
 * Notification hooks using React Query
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  type NotificationParams,
} from '@/lib/api/notifications';

// Re-export types
export type { Notification, NotificationParams, NotificationMeta } from '@/lib/api/notifications';

// ============================================================================
// Query Keys
// ============================================================================

export const notificationsKeys = {
  all: ['notifications'] as const,
  list: (params?: NotificationParams) =>
    [...notificationsKeys.all, 'list', params] as const,
  unreadCount: () => [...notificationsKeys.all, 'unread-count'] as const,
};

// ============================================================================
// Hooks
// ============================================================================

/**
 * Fetch paginated notifications
 */
export function useNotifications(params: NotificationParams = {}) {
  return useQuery({
    queryKey: notificationsKeys.list(params),
    queryFn: () => getNotifications(params),
    staleTime: 30 * 1000,
  });
}

/**
 * Fetch unread notification count — polled every 60s
 */
export function useUnreadCount() {
  return useQuery({
    queryKey: notificationsKeys.unreadCount(),
    queryFn: getUnreadCount,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
}

/**
 * Mark a single notification as read
 */
export function useMarkAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: markAsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationsKeys.all });
    },
  });
}

/**
 * Mark all notifications as read
 */
export function useMarkAllAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: markAllAsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationsKeys.all });
    },
  });
}

/**
 * Delete a notification
 */
export function useDeleteNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteNotification,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationsKeys.all });
    },
  });
}
