/**
 * Notification API functions
 */

import apiClient from './client';

// ============================================================================
// Types
// ============================================================================

export interface Notification {
  id: string;
  target_role: string | null;
  target_user_id: string | null;
  title: string;
  message: string | null;
  notification_type: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  read: boolean;
  read_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface NotificationParams {
  unread_only?: boolean;
  page?: number;
  limit?: number;
}

export interface NotificationMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  unread_count: number | null;
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Get notifications for the current user
 */
export async function getNotifications(
  params: NotificationParams = {}
): Promise<{ data: Notification[]; meta: NotificationMeta }> {
  const queryParams: Record<string, string | number | boolean> = {};
  if (params.unread_only) queryParams.unread_only = true;
  if (params.page) queryParams.page = params.page;
  if (params.limit) queryParams.limit = params.limit;

  const response = await apiClient.get<{
    success: boolean;
    data: Notification[];
    meta: NotificationMeta;
  }>('/notifications', { params: queryParams });

  return { data: response.data.data, meta: response.data.meta };
}

/**
 * Get count of unread notifications
 */
export async function getUnreadCount(): Promise<number> {
  const response = await apiClient.get<{
    success: boolean;
    data: { unread_count: number };
  }>('/notifications/unread-count');

  return Number(response.data.data.unread_count);
}

/**
 * Mark a single notification as read
 */
export async function markAsRead(id: string): Promise<Notification> {
  const response = await apiClient.patch<{
    success: boolean;
    data: Notification;
  }>(`/notifications/${id}/read`);

  return response.data.data;
}

/**
 * Mark all notifications as read
 */
export async function markAllAsRead(): Promise<number> {
  const response = await apiClient.post<{
    success: boolean;
    data: { marked_read: number };
  }>('/notifications/mark-all-read');

  return Number(response.data.data.marked_read);
}

/**
 * Delete a notification
 */
export async function deleteNotification(id: string): Promise<void> {
  await apiClient.delete(`/notifications/${id}`);
}
