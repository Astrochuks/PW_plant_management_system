/**
 * Transfers data hooks using React Query
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getTransfers,
  getPendingTransfers,
  getTransferStats,
  getSiteTransferRequests,
  createTransfer,
  confirmTransfer,
  cancelTransfer,
  adminRejectTransfer,
  type TransfersParams,
  type CreateTransferPayload,
} from '@/lib/api/transfers';

export type { Transfer, TransferStats, TransfersParams, CreateTransferPayload, SiteTransferRequest } from '@/lib/api/transfers';

// ============================================================================
// Query Keys
// ============================================================================

export const transfersKeys = {
  all: ['transfers'] as const,
  lists: () => [...transfersKeys.all, 'list'] as const,
  list: (params?: TransfersParams) => [...transfersKeys.lists(), params] as const,
  pending: (locationId?: string) => [...transfersKeys.all, 'pending', locationId] as const,
  stats: () => [...transfersKeys.all, 'stats'] as const,
  siteRequests: (status?: string) => [...transfersKeys.all, 'site-requests', status] as const,
};

// ============================================================================
// Queries
// ============================================================================

export function useTransfers(params?: TransfersParams) {
  return useQuery({
    queryKey: transfersKeys.list(params),
    queryFn: () => getTransfers(params),
  });
}

export function usePendingTransfers(locationId?: string) {
  return useQuery({
    queryKey: transfersKeys.pending(locationId),
    queryFn: () => getPendingTransfers(locationId),
    refetchInterval: 60000,
    refetchIntervalInBackground: false, // Stop polling when tab is hidden
  });
}

export function useTransferStats(since?: string) {
  return useQuery({
    queryKey: [...transfersKeys.stats(), since],
    queryFn: () => getTransferStats(since),
    refetchInterval: 60000,
    refetchIntervalInBackground: false, // Stop polling when tab is hidden
  });
}

// ============================================================================
// Mutations
// ============================================================================

export function useCreateTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateTransferPayload) => createTransfer(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transfersKeys.all });
    },
  });
}

export function useConfirmTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: confirmTransfer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transfersKeys.all });
    },
  });
}

export function useCancelTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (transferId: string) => cancelTransfer(transferId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transfersKeys.all });
    },
  });
}

// ============================================================================
// Admin — site transfer request management
// ============================================================================

export function useAdminSiteTransferRequests(status = 'pending') {
  return useQuery({
    queryKey: transfersKeys.siteRequests(status),
    queryFn: () => getSiteTransferRequests(status),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
  });
}

export function useAdminConfirmSiteTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (transferId: string) => confirmTransfer(transferId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transfersKeys.all });
    },
  });
}

export function useAdminRejectSiteTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (transferId: string) => adminRejectTransfer(transferId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transfersKeys.all });
    },
  });
}
