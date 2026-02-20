/**
 * States management hooks using React Query
 */

import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  getStatesAdmin,
  getState,
  getStatePlants,
  createState,
  updateState,
  deleteState,
  type StatePlantsParams,
  type CreateStateRequest,
  type UpdateStateRequest,
} from '@/lib/api/locations';
import { statesKeys } from '@/hooks/use-locations';

// Re-export types
export type {
  State,
  StateDetail,
  StatePlant,
  StatePlantsParams,
  CreateStateRequest,
  UpdateStateRequest,
} from '@/lib/api/locations';

// ============================================================================
// Query Keys
// ============================================================================

export const statesAdminKeys = {
  all: ['states-admin'] as const,
  list: (includeInactive?: boolean) =>
    [...statesAdminKeys.all, 'list', includeInactive] as const,
  detail: (id: string) => [...statesAdminKeys.all, 'detail', id] as const,
  plants: (id: string, params?: StatePlantsParams) =>
    [...statesAdminKeys.all, 'plants', id, params] as const,
};

// ============================================================================
// Hooks
// ============================================================================

/**
 * Fetch states list with optional inactive inclusion (admin page)
 */
export function useStatesAdmin(includeInactive: boolean = false) {
  return useQuery({
    queryKey: statesAdminKeys.list(includeInactive),
    queryFn: () => getStatesAdmin({ include_inactive: includeInactive }),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch a single state by ID (with sites)
 */
export function useStateDetail(id: string | null) {
  return useQuery({
    queryKey: statesAdminKeys.detail(id!),
    queryFn: () => getState(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch paginated plants in a state
 */
export function useStatePlants(id: string | null, params: StatePlantsParams = {}) {
  return useQuery({
    queryKey: statesAdminKeys.plants(id!, params),
    queryFn: () => getStatePlants(id!, params),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new state
 */
export function useCreateState() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateStateRequest) => createState(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: statesAdminKeys.all });
      queryClient.invalidateQueries({ queryKey: statesKeys.all });
    },
  });
}

/**
 * Update a state
 */
export function useUpdateState(stateId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateStateRequest) => updateState(stateId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: statesAdminKeys.all });
      queryClient.invalidateQueries({ queryKey: statesKeys.all });
    },
  });
}

/**
 * Delete a state
 */
export function useDeleteState() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteState(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: statesAdminKeys.all });
      queryClient.invalidateQueries({ queryKey: statesKeys.all });
    },
  });
}
