/**
 * Audit log hooks using React Query
 */

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  getAuditLogs,
  getRecordHistory,
  type AuditLogParams,
} from '@/lib/api/audit';

// Re-export types
export type { AuditLog, AuditLogParams, AuditLogMeta } from '@/lib/api/audit';

// ============================================================================
// Query Keys
// ============================================================================

export const auditKeys = {
  all: ['audit'] as const,
  logs: (params?: AuditLogParams) => [...auditKeys.all, 'logs', params] as const,
  recordHistory: (table: string, id: string) =>
    [...auditKeys.all, 'history', table, id] as const,
};

// ============================================================================
// Hooks
// ============================================================================

/**
 * Fetch audit logs with filtering and pagination
 */
export function useAuditLogs(params: AuditLogParams = {}) {
  return useQuery({
    queryKey: auditKeys.logs(params),
    queryFn: () => getAuditLogs(params),
    staleTime: 30 * 1000, // 30s — audit is time-sensitive
    placeholderData: keepPreviousData,
  });
}

/**
 * Fetch full audit history for a specific record
 */
export function useRecordHistory(tableName: string | null, recordId: string | null) {
  return useQuery({
    queryKey: auditKeys.recordHistory(tableName!, recordId!),
    queryFn: () => getRecordHistory(tableName!, recordId!),
    enabled: !!tableName && !!recordId,
    staleTime: 30 * 1000,
  });
}
