/**
 * Locations API functions
 * Handles all location-related API calls
 */

import apiClient from './client';

// ============================================================================
// Types
// ============================================================================

export interface LocationStats {
  location_id: string;
  location_name: string;
  location_code: string | null;
  active_plants: number;
  archived_plants: number;
  disposed_plants: number;
  total_plants: number;
  verified_plants: number;
  verification_rate: number;
  total_maintenance_cost: number;
  total_parts_replaced: number;
}

export interface LocationPlantsParams {
  page?: number;
  limit?: number;
  status?: string;
}

// API Response wrappers
interface ApiResponse<T> {
  success: boolean;
  data: T;
}

interface LocationPlantsResponse {
  success: boolean;
  data: LocationPlant[];
  location: {
    id: string;
    name: string;
  };
  meta: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export interface LocationPlant {
  id: string;
  fleet_number: string;
  description: string | null;
  fleet_type: string | null;
  status: 'active' | 'archived' | 'disposed';
  physical_verification: boolean;
  total_maintenance_cost: number | null;
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Get all locations with stats
 */
export async function getLocationsWithStats(): Promise<LocationStats[]> {
  const response = await apiClient.get<ApiResponse<LocationStats[]>>('/locations');
  return response.data.data;
}

/**
 * Get a single location by ID
 */
export async function getLocation(id: string): Promise<LocationStats> {
  const response = await apiClient.get<ApiResponse<LocationStats>>(`/locations/${id}`);
  return response.data.data;
}

/**
 * Get plants at a specific location
 */
export async function getLocationPlants(
  locationId: string,
  params: LocationPlantsParams = {}
): Promise<LocationPlantsResponse> {
  const queryParams: Record<string, string> = {};

  if (params.page) queryParams.page = String(params.page);
  if (params.limit) queryParams.limit = String(params.limit);
  if (params.status) queryParams.status = params.status;

  const response = await apiClient.get<LocationPlantsResponse>(
    `/locations/${locationId}/plants`,
    { params: queryParams }
  );

  return response.data;
}
