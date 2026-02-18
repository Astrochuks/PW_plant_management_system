/**
 * Dashboard data hooks using React Query
 */

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  getDashboardSummary,
  getFleetSummary,
  getPlantEvents,
  acknowledgeEvent,
  type DashboardSummary,
  type FleetSummaryItem,
  type PlantEvent,
} from '@/lib/api/dashboard';

// Query keys
export const dashboardKeys = {
  all: ['dashboard'] as const,
  summary: () => [...dashboardKeys.all, 'summary'] as const,
  fleetSummary: (locationId?: string) => [...dashboardKeys.all, 'fleet-summary', locationId] as const,
  events: (params?: Record<string, unknown>) => [...dashboardKeys.all, 'events', params] as const,
};

/**
 * Hook to fetch dashboard summary stats.
 * Uses keepPreviousData so the dashboard doesn't flash empty on revisit.
 */
export function useDashboardSummary() {
  return useQuery({
    queryKey: dashboardKeys.summary(),
    queryFn: getDashboardSummary,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Hook to fetch fleet summary by type
 */
export function useFleetSummary(locationId?: string) {
  return useQuery({
    queryKey: dashboardKeys.fleetSummary(locationId),
    queryFn: () => getFleetSummary(locationId),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Hook to fetch plant events
 */
export function usePlantEvents(params?: {
  event_type?: string;
  plant_id?: string;
  location_id?: string;
  acknowledged?: boolean;
  page?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: dashboardKeys.events(params),
    queryFn: () => getPlantEvents(params),
    staleTime: 2 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Hook to acknowledge an event
 */
export function useAcknowledgeEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: acknowledgeEvent,
    onSuccess: () => {
      // Invalidate events queries to refetch
      queryClient.invalidateQueries({ queryKey: dashboardKeys.events() });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.summary() });
    },
  });
}
