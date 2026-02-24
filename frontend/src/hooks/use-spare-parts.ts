/**
 * React Query hooks for spare parts
 */

import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  getSpareParts,
  getSparePart,
  getSparePartsStats,
  getTopSuppliers,
  getHighCostPlants,
  createSparePart,
  deleteSparePart,
  getPartsByPO,
  deletePartsByPO,
  getPurchaseOrders,
  bulkCreateSpareParts,
  updatePO,
  uploadPODocument,
  deletePODocument,
  getPlantCosts,
  getCostsByPeriod,
  getSparePartsSummary,
  getLocationCosts,
  autocompleteDescriptions,
  autocompletePONumbers,
  updateSparePart,
  getPlantSharedCosts,
  getYearOverYear,
  type SparePartsListParams,
  type CreateSparePartRequest,
  type POListParams,
  type BulkCreateRequest,
  type UpdatePORequest,
  type UpdateSparePartRequest,
} from '@/lib/api/spare-parts';

// ============================================================================
// Query Keys
// ============================================================================

export const sparePartsKeys = {
  all: ['spare-parts'] as const,
  lists: () => [...sparePartsKeys.all, 'list'] as const,
  list: (params: SparePartsListParams) => [...sparePartsKeys.lists(), params] as const,
  detail: (id: string) => [...sparePartsKeys.all, 'detail', id] as const,
  stats: (params?: { year?: number; month?: number; week?: number; quarter?: number; location_id?: string; supplier_id?: string }) =>
    [...sparePartsKeys.all, 'stats', params] as const,
  topSuppliers: (params?: { limit?: number; year?: number; month?: number; quarter?: number; location_id?: string }) =>
    [...sparePartsKeys.all, 'top-suppliers', params] as const,
  highCostPlants: (params?: { limit?: number; year?: number }) =>
    [...sparePartsKeys.all, 'high-cost-plants', params] as const,
  byPO: (poNumber: string) => [...sparePartsKeys.all, 'po', poNumber] as const,
  poDocument: (poNumber: string) => [...sparePartsKeys.all, 'po-doc', poNumber] as const,
  purchaseOrders: () => [...sparePartsKeys.all, 'purchase-orders'] as const,
  purchaseOrderList: (params: POListParams) => [...sparePartsKeys.purchaseOrders(), params] as const,
  autocompleteDescriptions: (q: string) => [...sparePartsKeys.all, 'autocomplete-desc', q] as const,
  autocompletePONumbers: (q: string) => [...sparePartsKeys.all, 'autocomplete-po', q] as const,
  plantSharedCosts: (plantId: string) => [...sparePartsKeys.all, 'plant-shared-costs', plantId] as const,
  yearOverYear: (params: Record<string, unknown>) => [...sparePartsKeys.all, 'year-over-year', params] as const,
};

// ============================================================================
// Hooks
// ============================================================================

/**
 * Fetch spare parts list with filters.
 */
export function useSpareParts(params: SparePartsListParams = {}) {
  return useQuery({
    queryKey: sparePartsKeys.list(params),
    queryFn: () => getSpareParts(params),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
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
export function useSparePartsStats(params: {
  year?: number;
  month?: number;
  week?: number;
  quarter?: number;
  location_id?: string;
  supplier_id?: string;
} = {}) {
  return useQuery({
    queryKey: sparePartsKeys.stats(params),
    queryFn: () => getSparePartsStats(params),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Fetch top suppliers
 */
export function useTopSuppliers(params: { limit?: number; year?: number; month?: number; quarter?: number; location_id?: string } = {}) {
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

/**
 * Fetch all parts for a specific PO number (returns data + meta)
 */
export function usePartsByPO(poNumber: string | null) {
  return useQuery({
    queryKey: sparePartsKeys.byPO(poNumber!),
    queryFn: () => getPartsByPO(poNumber!),
    enabled: !!poNumber,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Create a spare part (admin only)
 */
export function useCreateSparePart() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateSparePartRequest) => createSparePart(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sparePartsKeys.lists() });
      queryClient.invalidateQueries({ queryKey: sparePartsKeys.stats() });
    },
  });
}

/**
 * Delete a spare part (admin only)
 */
export function useDeleteSparePart() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteSparePart,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sparePartsKeys.lists() });
      queryClient.invalidateQueries({ queryKey: sparePartsKeys.stats() });
    },
  });
}

/**
 * List purchase orders with filters
 */
export function usePurchaseOrders(params: POListParams = {}) {
  return useQuery({
    queryKey: sparePartsKeys.purchaseOrderList(params),
    queryFn: () => getPurchaseOrders(params),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Bulk create spare parts from a PO (admin only)
 */
export function useBulkCreateSpareParts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: BulkCreateRequest) => bulkCreateSpareParts(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sparePartsKeys.all });
      // Also refresh suppliers list in case a new supplier was auto-created
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
  });
}

/**
 * Delete all parts in a PO (admin only)
 */
export function useDeletePartsByPO() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deletePartsByPO,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sparePartsKeys.all });
    },
  });
}

/**
 * Update PO details (admin only)
 */
export function useUpdatePO() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ poNumber, data }: { poNumber: string; data: UpdatePORequest }) =>
      updatePO(poNumber, data),
    onSuccess: (_result, { poNumber }) => {
      queryClient.invalidateQueries({ queryKey: sparePartsKeys.byPO(poNumber) });
      queryClient.invalidateQueries({ queryKey: sparePartsKeys.purchaseOrders() });
    },
  });
}

/**
 * Upload PO document (admin only, scoped to submission)
 */
export function useUploadPODocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ poNumber, file, submissionNumber }: { poNumber: string; file: File; submissionNumber?: number }) =>
      uploadPODocument(poNumber, file, submissionNumber),
    onSuccess: (_result, { poNumber }) => {
      queryClient.invalidateQueries({ queryKey: sparePartsKeys.byPO(poNumber) });
      queryClient.invalidateQueries({ queryKey: sparePartsKeys.poDocument(poNumber) });
    },
  });
}

/**
 * Delete PO document (admin only, scoped to submission)
 */
export function useDeletePODocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ poNumber, submissionNumber }: { poNumber: string; submissionNumber?: number }) =>
      deletePODocument(poNumber, submissionNumber),
    onSuccess: (_result, { poNumber }) => {
      queryClient.invalidateQueries({ queryKey: sparePartsKeys.byPO(poNumber) });
      queryClient.invalidateQueries({ queryKey: sparePartsKeys.all });
    },
  });
}

/**
 * Get maintenance costs for a specific plant (with optional time filters)
 */
export function usePlantCosts(plantId: string | null, params: {
  year?: number;
  month?: number;
  quarter?: number;
  week?: number;
} = {}) {
  return useQuery({
    queryKey: [...sparePartsKeys.all, 'plant-costs', plantId, params] as const,
    queryFn: () => getPlantCosts(plantId!, params),
    enabled: !!plantId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Get costs grouped by period (week/month/quarter/year)
 */
export function useCostsByPeriod(params: {
  period: 'week' | 'month' | 'quarter' | 'year';
  year: number;
  plant_id?: string;
  location_id?: string;
} | null) {
  return useQuery({
    queryKey: [...sparePartsKeys.all, 'costs-by-period', params] as const,
    queryFn: () => getCostsByPeriod(params!),
    enabled: !!params,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Get overall spare parts cost summary
 */
export function useSparePartsSummary(params: {
  year?: number;
  month?: number;
  location_id?: string;
} = {}) {
  return useQuery({
    queryKey: [...sparePartsKeys.all, 'summary', params] as const,
    queryFn: () => getSparePartsSummary(params),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Get maintenance costs for a specific location
 */
export function useLocationCosts(locationId: string | null, params: {
  year?: number;
  month?: number;
} = {}) {
  return useQuery({
    queryKey: [...sparePartsKeys.all, 'location-costs', locationId, params] as const,
    queryFn: () => getLocationCosts(locationId!, params),
    enabled: !!locationId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Update a single spare part (admin only)
 */
export function useUpdateSparePart() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ partId, data }: { partId: string; data: UpdateSparePartRequest }) =>
      updateSparePart(partId, data),
    onSuccess: (_result, { partId }) => {
      queryClient.invalidateQueries({ queryKey: sparePartsKeys.detail(partId) });
      queryClient.invalidateQueries({ queryKey: sparePartsKeys.lists() });
      queryClient.invalidateQueries({ queryKey: sparePartsKeys.stats() });
    },
  });
}

/**
 * Autocomplete part descriptions (enabled when q >= 2 chars)
 */
export function useAutocompleteDescriptions(q: string) {
  return useQuery({
    queryKey: sparePartsKeys.autocompleteDescriptions(q),
    queryFn: () => autocompleteDescriptions(q),
    enabled: q.length >= 2,
    staleTime: 30 * 1000,
  });
}

/**
 * Autocomplete PO numbers (enabled when q >= 1 char)
 */
export function useAutocompletePONumbers(q: string) {
  return useQuery({
    queryKey: sparePartsKeys.autocompletePONumbers(q),
    queryFn: () => autocompletePONumbers(q),
    enabled: q.length >= 1,
    staleTime: 30 * 1000,
  });
}

/**
 * Get shared costs for a specific plant
 */
export function usePlantSharedCosts(plantId: string | null) {
  return useQuery({
    queryKey: sparePartsKeys.plantSharedCosts(plantId!),
    queryFn: () => getPlantSharedCosts(plantId!),
    enabled: !!plantId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Year-over-year cost comparison
 */
export function useYearOverYear(params: {
  years: number[];
  group_by?: 'month' | 'quarter';
  plant_id?: string;
  location_id?: string;
} | null) {
  return useQuery({
    queryKey: sparePartsKeys.yearOverYear(params as Record<string, unknown>),
    queryFn: () => getYearOverYear(params!),
    enabled: !!params && params.years.length > 0,
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
  CreateSparePartRequest,
  POSummary,
  POListParams,
  PODetailMeta,
  BulkCreateRequest,
  UpdatePORequest,
  UpdateSparePartRequest,
  PlantCosts,
  PlantRecentPart,
  CostByPeriod,
  CostByPeriodMeta,
  CostByPeriodResponse,
  SparePartsSummary,
  LocationCosts,
  PlantSharedCost,
  PlantSharedCostsResponse,
  YearOverYearEntry,
  YearOverYearResponse,
  PONumberSuggestion,
} from '@/lib/api/spare-parts';
