/**
 * React Query hooks for reports
 */

import { useQuery } from '@tanstack/react-query';
import {
  getFleetSummary,
  getMaintenanceCosts,
  getVerificationStatus,
  getSubmissionCompliance,
  getPlantMovement,
  getWeeklyTrend,
  getUnverifiedPlants,
  type MaintenanceCostGroupBy,
} from '@/lib/api/reports';

// ============================================================================
// Query Keys
// ============================================================================

export const reportsKeys = {
  all: ['reports'] as const,
  fleetSummary: (params?: { location_id?: string }) =>
    [...reportsKeys.all, 'fleet-summary', params] as const,
  maintenanceCosts: (params?: {
    year?: number;
    location_id?: string;
    plant_id?: string;
    fleet_type?: string;
    group_by?: string;
  }) => [...reportsKeys.all, 'maintenance-costs', params] as const,
  verificationStatus: (params?: { year?: number; week_number?: number }) =>
    [...reportsKeys.all, 'verification-status', params] as const,
  submissionCompliance: (params?: { year?: number; weeks?: number }) =>
    [...reportsKeys.all, 'submission-compliance', params] as const,
  plantMovement: (params?: {
    date_from?: string;
    date_to?: string;
    fleet_type?: string;
  }) => [...reportsKeys.all, 'plant-movement', params] as const,
  weeklyTrend: (params: { year: number; location_id?: string }) =>
    [...reportsKeys.all, 'weekly-trend', params] as const,
  unverifiedPlants: (params?: {
    location_id?: string;
    weeks_missing?: number;
    page?: number;
    limit?: number;
  }) => [...reportsKeys.all, 'unverified-plants', params] as const,
};

// ============================================================================
// Hooks
// ============================================================================

/**
 * Fetch fleet summary by type
 */
export function useFleetSummary(params: { location_id?: string } = {}) {
  return useQuery({
    queryKey: reportsKeys.fleetSummary(params),
    queryFn: () => getFleetSummary(params),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch maintenance cost analysis
 */
export function useMaintenanceCosts(
  params: {
    year?: number;
    location_id?: string;
    plant_id?: string;
    fleet_type?: string;
    group_by?: MaintenanceCostGroupBy;
  } = {}
) {
  return useQuery({
    queryKey: reportsKeys.maintenanceCosts(params),
    queryFn: () => getMaintenanceCosts(params),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch verification status by location
 */
export function useVerificationStatus(
  params: { year?: number; week_number?: number } = {}
) {
  return useQuery({
    queryKey: reportsKeys.verificationStatus(params),
    queryFn: () => getVerificationStatus(params),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch submission compliance by location
 */
export function useSubmissionCompliance(
  params: { year?: number; weeks?: number } = {}
) {
  return useQuery({
    queryKey: reportsKeys.submissionCompliance(params),
    queryFn: () => getSubmissionCompliance(params),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch plant movement report
 */
export function usePlantMovement(
  params: {
    date_from?: string;
    date_to?: string;
    fleet_type?: string;
  } = {}
) {
  return useQuery({
    queryKey: reportsKeys.plantMovement(params),
    queryFn: () => getPlantMovement(params),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch weekly trend data
 */
export function useWeeklyTrend(params: { year: number; location_id?: string }) {
  return useQuery({
    queryKey: reportsKeys.weeklyTrend(params),
    queryFn: () => getWeeklyTrend(params),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch unverified plants (paginated)
 */
export function useUnverifiedPlants(
  params: {
    location_id?: string;
    weeks_missing?: number;
    page?: number;
    limit?: number;
  } = {}
) {
  return useQuery({
    queryKey: reportsKeys.unverifiedPlants(params),
    queryFn: () => getUnverifiedPlants(params),
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

// Re-export types
export type {
  FleetSummaryData,
  MaintenanceCostData,
  MaintenanceCostsMeta,
  MaintenanceCostsResponse,
  MaintenanceCostGroupBy,
  VerificationStatusData,
  SubmissionComplianceData,
  PlantMovementData,
  WeeklyTrendData,
  UnverifiedPlantData,
  UnverifiedPlantsMeta,
  UnverifiedPlantsResponse,
} from '@/lib/api/reports';
