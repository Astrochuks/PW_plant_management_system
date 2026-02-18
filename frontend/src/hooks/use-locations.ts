/**
 * Locations data hooks using React Query
 */

import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  getLocationsWithStats,
  getLocation,
  getLocationPlants,
  getLocationSubmissions,
  getLocationUsage,
  getLocationWeeklyRecords,
  getLocationTransfers,
  getStates,
  createLocation,
  updateLocation,
  deleteLocation,
  type LocationPlantsParams,
  type LocationSubmissionsParams,
  type LocationUsageParams,
  type LocationWeeklyRecordsParams,
  type LocationTransfersParams,
  type CreateLocationRequest,
  type UpdateLocationRequest,
} from '@/lib/api/locations';

// Re-export types for convenience
export type {
  LocationStats,
  LocationPlant,
  LocationSubmission,
  LocationUsage,
  LocationWeeklyRecord,
  LocationTransfer,
  State,
  LocationPlantsParams,
} from '@/lib/api/locations';

// ============================================================================
// Query Keys
// ============================================================================

export const locationsKeys = {
  all: ['locations'] as const,
  lists: () => [...locationsKeys.all, 'list'] as const,
  detail: (id: string) => [...locationsKeys.all, 'detail', id] as const,
  plants: (id: string, params?: LocationPlantsParams) =>
    [...locationsKeys.detail(id), 'plants', params] as const,
  submissions: (id: string, params?: LocationSubmissionsParams) =>
    [...locationsKeys.detail(id), 'submissions', params] as const,
  usage: (id: string, params?: LocationUsageParams) =>
    [...locationsKeys.detail(id), 'usage', params] as const,
  weeklyRecords: (id: string, params?: LocationWeeklyRecordsParams) =>
    [...locationsKeys.detail(id), 'weekly-records', params] as const,
  transfers: (id: string, params?: LocationTransfersParams) =>
    [...locationsKeys.detail(id), 'transfers', params] as const,
};

export const statesKeys = {
  all: ['states'] as const,
  list: () => [...statesKeys.all, 'list'] as const,
};

// ============================================================================
// Hooks
// ============================================================================

/**
 * Fetch all locations with stats (for list page)
 */
export function useLocationsWithStats() {
  return useQuery({
    queryKey: locationsKeys.lists(),
    queryFn: getLocationsWithStats,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch a single location by ID
 */
export function useLocationDetail(id: string | null) {
  return useQuery({
    queryKey: locationsKeys.detail(id!),
    queryFn: () => getLocation(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch plants at a location (paginated)
 */
export function useLocationPlants(id: string | null, params: LocationPlantsParams = {}) {
  return useQuery({
    queryKey: locationsKeys.plants(id!, params),
    queryFn: () => getLocationPlants(id!, params),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Fetch weekly report submissions for a location
 */
export function useLocationSubmissions(id: string | null, params: LocationSubmissionsParams = {}) {
  return useQuery({
    queryKey: locationsKeys.submissions(id!, params),
    queryFn: () => getLocationSubmissions(id!, params),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch usage statistics for a location
 */
export function useLocationUsage(id: string | null, params: LocationUsageParams = {}) {
  return useQuery({
    queryKey: locationsKeys.usage(id!, params),
    queryFn: () => getLocationUsage(id!, params),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch detailed weekly records for a location
 */
export function useLocationWeeklyRecords(id: string | null, params: LocationWeeklyRecordsParams = {}) {
  return useQuery({
    queryKey: locationsKeys.weeklyRecords(id!, params),
    queryFn: () => getLocationWeeklyRecords(id!, params),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Fetch transfers for a location
 */
export function useLocationTransfers(id: string | null, params: LocationTransfersParams = {}) {
  return useQuery({
    queryKey: locationsKeys.transfers(id!, params),
    queryFn: () => getLocationTransfers(id!, params),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch all states (for form dropdowns)
 */
export function useStates() {
  return useQuery({
    queryKey: statesKeys.list(),
    queryFn: getStates,
    staleTime: 10 * 60 * 1000,
  });
}

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new location (admin only)
 */
export function useCreateLocation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateLocationRequest) => createLocation(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: locationsKeys.all });
    },
  });
}

/**
 * Update a location (admin only)
 */
export function useUpdateLocation(locationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateLocationRequest) => updateLocation(locationId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: locationsKeys.all });
    },
  });
}

/**
 * Delete a location (admin only)
 */
export function useDeleteLocation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) => deleteLocation(id, force),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: locationsKeys.all });
    },
  });
}
