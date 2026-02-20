/**
 * Audit log API functions
 */

import apiClient from './client';

// ============================================================================
// Types
// ============================================================================

export interface AuditLog {
  id: string;
  user_id: string;
  user_email: string;
  action: 'create' | 'update' | 'delete' | 'transfer' | 'upload';
  table_name: string;
  record_id: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  description: string | null;
  created_at: string;
}

export interface AuditLogParams {
  table_name?: string;
  record_id?: string;
  action?: string;
  user_id?: string;
  start_date?: string;
  end_date?: string;
  page?: number;
  limit?: number;
}

export interface AuditLogMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Get audit logs with filtering and pagination (admin only)
 */
export async function getAuditLogs(
  params: AuditLogParams = {}
): Promise<{ data: AuditLog[]; meta: AuditLogMeta }> {
  const queryParams: Record<string, string | number> = {};
  if (params.table_name) queryParams.table_name = params.table_name;
  if (params.record_id) queryParams.record_id = params.record_id;
  if (params.action) queryParams.action = params.action;
  if (params.user_id) queryParams.user_id = params.user_id;
  if (params.start_date) queryParams.start_date = params.start_date;
  if (params.end_date) queryParams.end_date = params.end_date;
  if (params.page) queryParams.page = params.page;
  if (params.limit) queryParams.limit = params.limit;

  const response = await apiClient.get<{
    success: boolean;
    data: AuditLog[];
    meta: AuditLogMeta;
  }>('/audit/logs', { params: queryParams });

  return { data: response.data.data, meta: response.data.meta };
}

/**
 * Get full audit history for a specific record (admin only)
 */
export async function getRecordHistory(
  tableName: string,
  recordId: string
): Promise<AuditLog[]> {
  const response = await apiClient.get<{
    success: boolean;
    data: AuditLog[];
  }>(`/audit/logs/${tableName}/${recordId}`);

  return response.data.data;
}
