/**
 * Transfers data hooks using React Query
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getTransfers,
  getPendingTransfers,
  getTransferStats,
  confirmTransfer,
  cancelTransfer,
  type TransfersParams,
} from '@/lib/api/transfers';

export type { Transfer, TransferStats, TransfersParams } from '@/lib/api/transfers';

// ============================================================================
// Query Keys
// ============================================================================

export const transfersKeys = {
  all: ['transfers'] as const,
  lists: () => [...transfersKeys.all, 'list'] as const,
  list: (params?: TransfersParams) => [...transfersKeys.lists(), params] as const,
  pending: (locationId?: string) => [...transfersKeys.all, 'pending', locationId] as const,
  stats: () => [...transfersKeys.all, 'stats'] as const,
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
    refetchInterval: 60000, // Refresh every minute
  });
}

export function useTransferStats(since?: string) {
  return useQuery({
    queryKey: [...transfersKeys.stats(), since],
    queryFn: () => getTransferStats(since),
    refetchInterval: 60000,
  });
}

// ============================================================================
// Mutations
// ============================================================================

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
