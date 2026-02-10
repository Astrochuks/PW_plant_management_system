/**
 * Reports API functions
 * Handles all reports and analytics API calls
 */

import apiClient from './client';

// ============================================================================
// Types
// ============================================================================

export interface MaintenanceCostData {
  period: string;
  total_cost: number;
  parts_count: number;
}

export interface VerificationStatusData {
  location_id: string;
  location_name: string;
  total_plants: number;
  verified_plants: number;
  verification_rate: number;
}

export interface SubmissionComplianceData {
  location_id: string;
  location_name: string;
  expected_submissions: number;
  actual_submissions: number;
  compliance_rate: number;
}

export interface PlantMovementData {
  plant_id: string;
  fleet_number: string;
  from_location: string;
  to_location: string;
  transfer_date: string;
  transferred_by: string | null;
}

export interface WeeklyTrendData {
  week_number: number;
  year: number;
  plant_count: number;
  verified_count: number;
  verification_rate: number;
}

export interface UnverifiedPlantData {
  plant_id: string;
  fleet_number: string;
  description: string | null;
  current_location: string;
  last_verified_date: string | null;
  weeks_since_verification: number;
}

// API Response wrapper
interface ApiResponse<T> {
  success: boolean;
  data: T;
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Get maintenance cost analysis
 */
export async function getMaintenanceCosts(params: {
  year?: number;
  location_id?: string;
  group_by?: 'month' | 'quarter' | 'fleet_type' | 'location';
} = {}): Promise<MaintenanceCostData[]> {
  const queryParams: Record<string, string> = {};

  if (params.year) queryParams.year = String(params.year);
  if (params.location_id) queryParams.location_id = params.location_id;
  if (params.group_by) queryParams.group_by = params.group_by;

  const response = await apiClient.get<ApiResponse<MaintenanceCostData[]>>(
    '/reports/maintenance-costs',
    { params: queryParams }
  );
  return response.data.data;
}

/**
 * Get verification status by location
 */
export async function getVerificationStatus(params: {
  year?: number;
  week_number?: number;
} = {}): Promise<VerificationStatusData[]> {
  const queryParams: Record<string, string> = {};

  if (params.year) queryParams.year = String(params.year);
  if (params.week_number) queryParams.week_number = String(params.week_number);

  const response = await apiClient.get<ApiResponse<VerificationStatusData[]>>(
    '/reports/verification-status',
    { params: queryParams }
  );
  return response.data.data;
}

/**
 * Get submission compliance by location
 */
export async function getSubmissionCompliance(params: {
  year?: number;
  weeks?: number;
} = {}): Promise<SubmissionComplianceData[]> {
  const queryParams: Record<string, string> = {};

  if (params.year) queryParams.year = String(params.year);
  if (params.weeks) queryParams.weeks = String(params.weeks);

  const response = await apiClient.get<ApiResponse<SubmissionComplianceData[]>>(
    '/reports/submission-compliance',
    { params: queryParams }
  );
  return response.data.data;
}

/**
 * Get plant movement report
 */
export async function getPlantMovement(params: {
  date_from?: string;
  date_to?: string;
  fleet_type_id?: string;
} = {}): Promise<PlantMovementData[]> {
  const queryParams: Record<string, string> = {};

  if (params.date_from) queryParams.date_from = params.date_from;
  if (params.date_to) queryParams.date_to = params.date_to;
  if (params.fleet_type_id) queryParams.fleet_type_id = params.fleet_type_id;

  const response = await apiClient.get<ApiResponse<PlantMovementData[]>>(
    '/reports/plant-movement',
    { params: queryParams }
  );
  return response.data.data;
}

/**
 * Get weekly trend data
 */
export async function getWeeklyTrend(params: {
  year: number;
  location_id?: string;
}): Promise<WeeklyTrendData[]> {
  const queryParams: Record<string, string> = {
    year: String(params.year),
  };

  if (params.location_id) queryParams.location_id = params.location_id;

  const response = await apiClient.get<ApiResponse<WeeklyTrendData[]>>(
    '/reports/weekly-trend',
    { params: queryParams }
  );
  return response.data.data;
}

/**
 * Get unverified plants
 */
export async function getUnverifiedPlants(params: {
  location_id?: string;
  weeks_missing?: number;
  limit?: number;
} = {}): Promise<UnverifiedPlantData[]> {
  const queryParams: Record<string, string> = {};

  if (params.location_id) queryParams.location_id = params.location_id;
  if (params.weeks_missing) queryParams.weeks_missing = String(params.weeks_missing);
  if (params.limit) queryParams.limit = String(params.limit);

  const response = await apiClient.get<ApiResponse<UnverifiedPlantData[]>>(
    '/reports/unverified-plants',
    { params: queryParams }
  );
  return response.data.data;
}

/**
 * Export plants data
 */
export async function exportPlants(params: {
  format?: 'json' | 'csv';
  status?: string;
  location_id?: string;
} = {}): Promise<{ data: string | unknown[]; format: string; count: number }> {
  const queryParams: Record<string, string> = {};

  if (params.format) queryParams.format = params.format;
  if (params.status) queryParams.status = params.status;
  if (params.location_id) queryParams.location_id = params.location_id;

  const response = await apiClient.get<{
    success: boolean;
    data: string | unknown[];
    format: string;
    count: number;
  }>('/reports/export/plants', { params: queryParams });

  return {
    data: response.data.data,
    format: response.data.format,
    count: response.data.count,
  };
}

/**
 * Export maintenance data
 */
export async function exportMaintenance(params: {
  format?: 'json' | 'csv';
  year?: number;
  plant_id?: string;
} = {}): Promise<{ data: string | unknown[]; format: string; count: number }> {
  const queryParams: Record<string, string> = {};

  if (params.format) queryParams.format = params.format;
  if (params.year) queryParams.year = String(params.year);
  if (params.plant_id) queryParams.plant_id = params.plant_id;

  const response = await apiClient.get<{
    success: boolean;
    data: string | unknown[];
    format: string;
    count: number;
  }>('/reports/export/maintenance', { params: queryParams });

  return {
    data: response.data.data,
    format: response.data.format,
    count: response.data.count,
  };
}
