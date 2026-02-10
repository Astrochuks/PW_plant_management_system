/**
 * Plants API functions
 * Handles all plant-related API calls
 */

import apiClient from './client';

// ============================================================================
// Types
// ============================================================================

export interface PlantSummary {
  id: string;
  fleet_number: string;
  description: string | null;
  fleet_type: string | null;
  make: string | null;
  model: string | null;
  status: 'active' | 'archived' | 'disposed';
  physical_verification: boolean;
  current_location: string | null;
  current_location_id: string | null;
  total_maintenance_cost: number | null;
  parts_replaced_count: number | null;
  last_maintenance_date: string | null;
  chassis_number: string | null;
  year_of_manufacture: number | null;
  purchase_cost: number | null;
  remarks: string | null;
  created_at: string;
  updated_at: string;
}

export interface Location {
  location_id: string;
  location_name: string;
  active_plants: number;
  archived_plants: number;
  total_plants: number;
  verified_plants: number;
  verification_rate: number;
  total_maintenance_cost: number;
  total_parts_replaced: number;
}

export interface FleetType {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface PlantsListParams {
  page?: number;
  limit?: number;
  status?: string;
  location_id?: string;
  fleet_type_id?: string;
  search?: string;
  verified_only?: boolean;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  has_more: boolean;
}

// API Response wrappers
interface ApiResponse<T> {
  success: boolean;
  data: T;
}

interface PaginatedApiResponse<T> {
  success: boolean;
  data: T[];
  meta: PaginationMeta;
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Get paginated list of plants with optional filters
 */
export async function getPlants(params: PlantsListParams = {}): Promise<{
  data: PlantSummary[];
  meta: PaginationMeta;
}> {
  const queryParams: Record<string, string> = {};

  if (params.page) queryParams.page = String(params.page);
  if (params.limit) queryParams.limit = String(params.limit);
  if (params.status) queryParams.status = params.status;
  if (params.location_id) queryParams.location_id = params.location_id;
  if (params.fleet_type_id) queryParams.fleet_type_id = params.fleet_type_id;
  if (params.search) queryParams.search = params.search;
  if (params.verified_only) queryParams.verified_only = 'true';

  const response = await apiClient.get<PaginatedApiResponse<PlantSummary>>('/plants', {
    params: queryParams,
  });

  return {
    data: response.data.data,
    meta: response.data.meta,
  };
}

/**
 * Get a single plant by ID
 */
export async function getPlant(id: string): Promise<PlantSummary> {
  const response = await apiClient.get<ApiResponse<PlantSummary>>(`/plants/${id}`);
  return response.data.data;
}

/**
 * Search plants with full-text search
 */
export async function searchPlants(
  query: string,
  params: Omit<PlantsListParams, 'search' | 'page'> = {}
): Promise<PlantSummary[]> {
  const queryParams: Record<string, string> = {};

  if (params.status) queryParams.status = params.status;
  if (params.location_id) queryParams.location_id = params.location_id;
  if (params.fleet_type_id) queryParams.fleet_type_id = params.fleet_type_id;
  if (params.limit) queryParams.limit = String(params.limit);

  const response = await apiClient.get<ApiResponse<PlantSummary[]>>(
    `/plants/search/${encodeURIComponent(query)}`,
    { params: queryParams }
  );

  return response.data.data;
}

/**
 * Get all locations for filter dropdown
 */
export async function getLocations(): Promise<Location[]> {
  const response = await apiClient.get<ApiResponse<Location[]>>('/locations');
  return response.data.data;
}

/**
 * Get all fleet types for filter dropdown
 */
export async function getFleetTypes(): Promise<FleetType[]> {
  const response = await apiClient.get<ApiResponse<FleetType[]>>('/fleet-types');
  return response.data.data;
}

/**
 * Get plant maintenance history
 */
export async function getPlantMaintenanceHistory(
  plantId: string,
  limit: number = 50
): Promise<unknown[]> {
  const response = await apiClient.get<ApiResponse<unknown[]>>(
    `/plants/${plantId}/maintenance-history`,
    { params: { limit: String(limit) } }
  );
  return response.data.data;
}

/**
 * Get plant location history
 */
export async function getPlantLocationHistory(plantId: string): Promise<unknown[]> {
  const response = await apiClient.get<ApiResponse<unknown[]>>(
    `/plants/${plantId}/location-history`
  );
  return response.data.data;
}
