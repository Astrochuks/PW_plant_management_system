/**
 * React Query hooks for locations
 */

import { useQuery } from '@tanstack/react-query';
import {
  getLocationsWithStats,
  getLocation,
  getLocationPlants,
  type LocationStats,
  type LocationPlantsParams,
} from '@/lib/api/locations';

// ============================================================================
// Query Keys
// ============================================================================

export const locationsKeys = {
  all: ['locations'] as const,
  list: () => [...locationsKeys.all, 'list'] as const,
  detail: (id: string) => [...locationsKeys.all, 'detail', id] as const,
  plants: (id: string, params: LocationPlantsParams) =>
    [...locationsKeys.all, 'plants', id, params] as const,
};

// ============================================================================
// Hooks
// ============================================================================

/**
 * Fetch all locations with stats
 */
export function useLocationsWithStats() {
  return useQuery({
    queryKey: locationsKeys.list(),
    queryFn: getLocationsWithStats,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch a single location by ID
 */
export function useLocation(id: string | null) {
  return useQuery({
    queryKey: locationsKeys.detail(id!),
    queryFn: () => getLocation(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch plants at a specific location
 */
export function useLocationPlants(locationId: string | null, params: LocationPlantsParams = {}) {
  return useQuery({
    queryKey: locationsKeys.plants(locationId!, params),
    queryFn: () => getLocationPlants(locationId!, params),
    enabled: !!locationId,
    staleTime: 5 * 60 * 1000,
  });
}

// Re-export types
export type { LocationStats, LocationPlantsParams } from '@/lib/api/locations';
