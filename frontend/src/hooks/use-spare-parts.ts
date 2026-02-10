/**
 * React Query hooks for spare parts
 */

import { useQuery } from '@tanstack/react-query';
import {
  getSpareParts,
  getSparePart,
  getSparePartsStats,
  getTopSuppliers,
  getHighCostPlants,
  type SparePartsListParams,
} from '@/lib/api/spare-parts';

// ============================================================================
// Query Keys
// ============================================================================

export const sparePartsKeys = {
  all: ['spare-parts'] as const,
  list: (params: SparePartsListParams) => [...sparePartsKeys.all, 'list', params] as const,
  detail: (id: string) => [...sparePartsKeys.all, 'detail', id] as const,
  stats: (params?: { year?: number; location_id?: string }) =>
    [...sparePartsKeys.all, 'stats', params] as const,
  topSuppliers: (params?: { limit?: number; year?: number }) =>
    [...sparePartsKeys.all, 'top-suppliers', params] as const,
  highCostPlants: (params?: { limit?: number; year?: number }) =>
    [...sparePartsKeys.all, 'high-cost-plants', params] as const,
};

// ============================================================================
// Hooks
// ============================================================================

/**
 * Fetch spare parts list with filters
 */
export function useSpareParts(params: SparePartsListParams = {}) {
  return useQuery({
    queryKey: sparePartsKeys.list(params),
    queryFn: () => getSpareParts(params),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch a single spare part by ID
 */
export function useSparePart(id: string | null) {
  return useQuery({
    queryKey: sparePartsKeys.detail(id!),
    queryFn: () => getSparePart(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch spare parts statistics
 */
export function useSparePartsStats(params: { year?: number; location_id?: string } = {}) {
  return useQuery({
    queryKey: sparePartsKeys.stats(params),
    queryFn: () => getSparePartsStats(params),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch top suppliers
 */
export function useTopSuppliers(params: { limit?: number; year?: number } = {}) {
  return useQuery({
    queryKey: sparePartsKeys.topSuppliers(params),
    queryFn: () => getTopSuppliers(params),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch high cost plants
 */
export function useHighCostPlants(params: { limit?: number; year?: number } = {}) {
  return useQuery({
    queryKey: sparePartsKeys.highCostPlants(params),
    queryFn: () => getHighCostPlants(params),
    staleTime: 5 * 60 * 1000,
  });
}

// Re-export types
export type {
  SparePart,
  SparePartsListParams,
  SparePartsStats,
  TopSupplier,
  HighCostPlant,
  PaginationMeta,
} from '@/lib/api/spare-parts';
