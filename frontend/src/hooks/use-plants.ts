/**
 * Plants data hooks using React Query
 */

import { useQuery } from '@tanstack/react-query';
import {
  getPlants,
  getPlant,
  getLocations,
  getFleetTypes,
  getPlantMaintenanceHistory,
  getPlantLocationHistory,
  type PlantsListParams,
  type PlantSummary,
  type Location,
  type FleetType,
  type PaginationMeta,
} from '@/lib/api/plants';

// Re-export types for convenience
export type { PlantSummary, Location, FleetType, PlantsListParams, PaginationMeta };

// ============================================================================
// Query Keys
// ============================================================================

export const plantsKeys = {
  all: ['plants'] as const,
  lists: () => [...plantsKeys.all, 'list'] as const,
  list: (params: PlantsListParams) => [...plantsKeys.lists(), params] as const,
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
 * Hook to fetch paginated plants list with filters
 */
export function usePlants(params: PlantsListParams = {}) {
  return useQuery({
    queryKey: plantsKeys.list(params),
    queryFn: () => getPlants(params),
    staleTime: 2 * 60 * 1000, // 2 minutes
    refetchOnWindowFocus: false,
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
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
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
    refetchOnWindowFocus: false,
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
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch all locations (for filter dropdown)
 */
export function useLocations() {
  return useQuery({
    queryKey: locationsKeys.list(),
    queryFn: getLocations,
    staleTime: 10 * 60 * 1000, // 10 minutes - locations rarely change
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch all fleet types (for filter dropdown)
 */
export function useFleetTypes() {
  return useQuery({
    queryKey: fleetTypesKeys.list(),
    queryFn: getFleetTypes,
    staleTime: 10 * 60 * 1000, // 10 minutes - fleet types rarely change
    refetchOnWindowFocus: false,
  });
}
