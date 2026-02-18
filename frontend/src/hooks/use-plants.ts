/**
 * Plants data hooks using React Query
 */

import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  getPlants,
  getPlant,
  getLocations,
  getFleetTypes,
  getPlantMaintenanceHistory,
  getPlantLocationHistory,
  getPlantWeeklyRecords,
  getPlantEvents,
  getFilteredPlantStats,
  createPlant,
  updatePlant,
  deletePlant,
  type PlantsListParams,
  type PlantSummary,
  type Location,
  type FleetType,
  type PaginationMeta,
  type PlantCondition,
  type PlantFilteredStats,
  type CreatePlantRequest,
  type UpdatePlantRequest,
  type MaintenanceRecord,
  type LocationRecord,
  type WeeklyUsageRecord,
  type PlantEvent,
} from '@/lib/api/plants';

// Re-export types for convenience
export type { PlantSummary, PlantCondition, PlantFilteredStats, Location, FleetType, PlantsListParams, PaginationMeta };

// ============================================================================
// Query Keys
// ============================================================================

export const plantsKeys = {
  all: ['plants'] as const,
  lists: () => [...plantsKeys.all, 'list'] as const,
  list: (params: PlantsListParams) => [...plantsKeys.lists(), params] as const,
  filteredStats: (params: Record<string, unknown>) => [...plantsKeys.all, 'filtered-stats', params] as const,
  details: () => [...plantsKeys.all, 'detail'] as const,
  detail: (id: string) => [...plantsKeys.details(), id] as const,
  maintenanceHistory: (id: string) => [...plantsKeys.detail(id), 'maintenance'] as const,
  locationHistory: (id: string) => [...plantsKeys.detail(id), 'locations'] as const,
};

export const locationsKeys = {
  all: ['locations'] as const,
  list: () => [...locationsKeys.all, 'list'] as const,
};

export const fleetTypesKeys = {
  all: ['fleet-types'] as const,
  list: () => [...fleetTypesKeys.all, 'list'] as const,
};

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to fetch paginated plants list with filters.
 * Uses keepPreviousData so the table stays visible while new data loads.
 */
export function usePlants(params: PlantsListParams = {}) {
  return useQuery({
    queryKey: plantsKeys.list(params),
    queryFn: () => getPlants(params),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Hook to fetch a single plant by ID
 */
export function usePlant(id: string | null) {
  return useQuery({
    queryKey: plantsKeys.detail(id!),
    queryFn: () => getPlant(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to fetch plant maintenance history
 */
export function usePlantMaintenanceHistory(plantId: string | null, limit: number = 50) {
  return useQuery({
    queryKey: plantsKeys.maintenanceHistory(plantId!),
    queryFn: () => getPlantMaintenanceHistory(plantId!, limit),
    enabled: !!plantId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to fetch plant location history
 */
export function usePlantLocationHistory(plantId: string | null) {
  return useQuery({
    queryKey: plantsKeys.locationHistory(plantId!),
    queryFn: () => getPlantLocationHistory(plantId!),
    enabled: !!plantId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to fetch plant weekly usage records
 */
export function usePlantWeeklyRecords(plantId: string | null) {
  return useQuery({
    queryKey: [...plantsKeys.detail(plantId!), 'weekly'],
    queryFn: () => getPlantWeeklyRecords(plantId!),
    enabled: !!plantId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to fetch plant events
 */
export function usePlantEvents(plantId: string | null) {
  return useQuery({
    queryKey: [...plantsKeys.detail(plantId!), 'events'],
    queryFn: () => getPlantEvents(plantId!),
    enabled: !!plantId,
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Hook to fetch all locations (for filter dropdown)
 */
export function useLocations() {
  return useQuery({
    queryKey: locationsKeys.list(),
    queryFn: getLocations,
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Hook to fetch all fleet types (for filter dropdown)
 */
export function useFleetTypes() {
  return useQuery({
    queryKey: fleetTypesKeys.list(),
    queryFn: getFleetTypes,
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Hook to fetch aggregated plant stats with the same filters as the plants list.
 * Uses keepPreviousData so stats don't flash empty on filter changes.
 */
export function usePlantFilteredStats(
  params: Omit<PlantsListParams, 'page' | 'limit' | 'sort_by' | 'sort_order' | 'columns'>
) {
  return useQuery({
    queryKey: plantsKeys.filteredStats(params),
    queryFn: () => getFilteredPlantStats(params),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

// ============================================================================
// Prefetch helpers
// ============================================================================

/**
 * Prefetch a single plant detail + sub-data into the cache.
 * Call this on hover/focus of a plant row for instant detail page loads.
 */
export function usePrefetchPlantDetail() {
  const queryClient = useQueryClient();

  return (plantId: string) => {
    queryClient.prefetchQuery({
      queryKey: plantsKeys.detail(plantId),
      queryFn: () => getPlant(plantId),
      staleTime: 5 * 60 * 1000,
    });
    queryClient.prefetchQuery({
      queryKey: plantsKeys.maintenanceHistory(plantId),
      queryFn: () => getPlantMaintenanceHistory(plantId),
      staleTime: 5 * 60 * 1000,
    });
    queryClient.prefetchQuery({
      queryKey: plantsKeys.locationHistory(plantId),
      queryFn: () => getPlantLocationHistory(plantId),
      staleTime: 5 * 60 * 1000,
    });
  };
}

// ============================================================================
// Mutations (Create, Update, Delete)
// ============================================================================

/**
 * Mutation hook to create a new plant (Admin only)
 */
export function useCreatePlant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createPlant,
    onSuccess: () => {
      // Invalidate plants list to refetch
      queryClient.invalidateQueries({ queryKey: plantsKeys.lists() });
    },
  });
}

/**
 * Mutation hook to update a plant (Admin only)
 */
export function useUpdatePlant(plantId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdatePlantRequest) => updatePlant(plantId, data),
    onSuccess: (data) => {
      // Update the specific plant detail
      queryClient.setQueryData(plantsKeys.detail(plantId), data);
      // Invalidate plants list
      queryClient.invalidateQueries({ queryKey: plantsKeys.lists() });
    },
  });
}

/**
 * Mutation hook to delete a plant (Admin only)
 */
export function useDeletePlant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deletePlant,
    onSuccess: () => {
      // Invalidate plants list
      queryClient.invalidateQueries({ queryKey: plantsKeys.lists() });
    },
  });
}
