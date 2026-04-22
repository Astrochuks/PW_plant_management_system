/**
 * Dashboard data hooks using React Query
 */

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  getDashboardSummary,
  getFleetSummary,
  getPlantEvents,
  acknowledgeEvent,
  getStatesSummary,
  getFleetDistribution,
  getRecentlyPurchased,
  type DashboardSummary,
  type DashboardFilterParams,
  type FleetSummaryItem,
  type PlantEvent,
  type StateSummary,
  type FleetDistState,
  type RecentlyPurchasedPlant,
} from '@/lib/api/dashboard';

// Query keys
export const dashboardKeys = {
  all: ['dashboard'] as const,
  summary: (params?: DashboardFilterParams) => [...dashboardKeys.all, 'summary', params] as const,
  fleetSummary: (locationId?: string) => [...dashboardKeys.all, 'fleet-summary', locationId] as const,
  events: (params?: Record<string, unknown>) => [...dashboardKeys.all, 'events', params] as const,
  statesSummary: (fleetType?: string) => [...dashboardKeys.all, 'states-summary', fleetType] as const,
  fleetDistribution: (fleetType?: string) => [...dashboardKeys.all, 'fleet-distribution', fleetType] as const,
  recentlyPurchased: () => [...dashboardKeys.all, 'recently-purchased'] as const,
};

/**
 * Hook to fetch dashboard summary stats.
 * Uses keepPreviousData so the dashboard doesn't flash empty on revisit.
 */
export function useDashboardSummary(params?: DashboardFilterParams) {
  return useQuery({
    queryKey: dashboardKeys.summary(params),
    queryFn: () => getDashboardSummary(params),
    staleTime: 2 * 60 * 1000,
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
    staleTime: 2 * 60 * 1000,
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

/**
 * Hook to fetch recently purchased plants
 */
export function useRecentlyPurchased(limit = 10) {
  return useQuery({
    queryKey: dashboardKeys.recentlyPurchased(),
    queryFn: () => getRecentlyPurchased(limit),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to fetch states summary (plant aggregation per state for the map)
 */
export function useStatesSummary(fleetType?: string) {
  return useQuery({
    queryKey: dashboardKeys.statesSummary(fleetType),
    queryFn: () => getStatesSummary(fleetType),
    staleTime: 2 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

export function useFleetDistribution(fleetType?: string) {
  return useQuery({
    queryKey: dashboardKeys.fleetDistribution(fleetType),
    queryFn: () => getFleetDistribution(fleetType),
    staleTime: 2 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}
