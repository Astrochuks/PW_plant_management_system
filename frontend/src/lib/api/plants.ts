/**
 * Plants API functions
 * Handles all plant-related API calls
 */

import apiClient from './client';

// ============================================================================
// Types
// ============================================================================

export type PlantCondition =
  | 'working'
  | 'standby'
  | 'under_repair'
  | 'breakdown'
  | 'faulty'
  | 'scrap'
  | 'missing'
  | 'off_hire'
  | 'gpm_assessment'
  | 'unverified';

export interface PlantSummary {
  id: string;
  fleet_number: string;
  description: string | null;
  fleet_type: string | null;
  make: string | null;
  model: string | null;
  condition: PlantCondition | null;
  physical_verification: boolean;
  current_location: string | null;
  current_location_id: string | null;
  state: string | null;
  state_code: string | null;
  total_maintenance_cost: number | null;
  parts_replaced_count: number | null;
  last_maintenance_date: string | null;
  chassis_number: string | null;
  year_of_manufacture: number | null;
  purchase_year: number | null;
  purchase_cost: number | null;
  serial_m: string | null;
  serial_e: string | null;
  remarks: string | null;
  pending_transfer_to_id: string | null;
  pending_transfer_to_location: string | null;
  created_at: string;
  updated_at: string;
}

export interface Location {
  id: string;
  location_name: string;
  state_id: string | null;
  state_name: string | null;
  state_code: string | null;
  total_plants: number;
  working_plants: number;
  standby_plants: number;
  under_repair_plants: number;
  breakdown_plants: number;
  faulty_plants: number;
  missing_plants: number;
  scrap_plants: number;
  off_hire_plants: number;
  gpm_assessment_plants: number;
  unverified_plants: number;
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
  condition?: string;        // comma-separated: working,standby,breakdown,...
  location_id?: string;
  fleet_type?: string;       // fleet type name (e.g. "TRUCKS"), comma-separated for multi
  state?: string;
  search?: string;
  verified_only?: boolean;
  unknown_location?: boolean;
  pending_transfer?: boolean;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
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
  if (params.condition) queryParams.condition = params.condition;
  if (params.location_id) queryParams.location_id = params.location_id;
  if (params.fleet_type) queryParams.fleet_type = params.fleet_type;
  if (params.state) queryParams.state = params.state;
  if (params.search) queryParams.search = params.search;
  if (params.verified_only) queryParams.verified_only = 'true';
  if (params.unknown_location) queryParams.unknown_location = 'true';
  if (params.pending_transfer) queryParams.pending_transfer = 'true';
  if (params.sort_by) queryParams.sort_by = params.sort_by;
  if (params.sort_order) queryParams.sort_order = params.sort_order;

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

  if (params.condition) queryParams.condition = params.condition;
  if (params.location_id) queryParams.location_id = params.location_id;
  if (params.fleet_type) queryParams.fleet_type = params.fleet_type;
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
 * Export plants to Excel with current filters
 */
export interface ExportParams {
  condition?: string;
  location_id?: string;
  fleet_type?: string;
  state?: string;
  search?: string;
  verified_only?: boolean;
  exclude_not_seen?: boolean;
  columns?: string;
}

export async function exportPlantsExcel(params: ExportParams = {}): Promise<Blob> {
  const queryParams: Record<string, string> = {};
  if (params.condition) queryParams.condition = params.condition;
  if (params.location_id) queryParams.location_id = params.location_id;
  if (params.fleet_type) queryParams.fleet_type = params.fleet_type;
  if (params.state) queryParams.state = params.state;
  if (params.search) queryParams.search = params.search;
  if (params.verified_only) queryParams.verified_only = 'true';
  if (params.exclude_not_seen !== undefined) queryParams.exclude_not_seen = String(params.exclude_not_seen);
  if (params.columns) queryParams.columns = params.columns;

  const response = await apiClient.get('/plants/export/excel', {
    params: queryParams,
    responseType: 'blob',
  });
  return response.data;
}

/**
 * Get plant maintenance history
 */
export interface MaintenanceRecord {
  id: string
  part_description: string
  supplier: string | null
  part_number: string | null
  reason_for_change: string | null
  unit_cost: number | null
  quantity: number | null
  total_cost: number | null
  replaced_date: string
  purchase_order_number: string | null
  remarks: string | null
}

export async function getPlantMaintenanceHistory(
  plantId: string,
  limit: number = 50
): Promise<MaintenanceRecord[]> {
  const response = await apiClient.get<ApiResponse<MaintenanceRecord[]>>(
    `/plants/${plantId}/maintenance-history`,
    { params: { limit: String(limit) } }
  );
  return response.data.data;
}

/**
 * Get plant location history
 */
export interface LocationRecord {
  location_name: string
  start_date: string
  end_date?: string
  duration_days?: number
  transfer_reason?: string
}

export async function getPlantLocationHistory(plantId: string): Promise<LocationRecord[]> {
  const response = await apiClient.get<ApiResponse<LocationRecord[]>>(
    `/plants/${plantId}/location-history`
  );
  return response.data.data;
}

/**
 * Get plant weekly usage records
 */
export interface WeeklyUsageRecord {
  year: number
  week_number: number
  hours_worked: number
  standby_hours: number
  breakdown_hours: number
  week_ending_date: string | null
  off_hire: boolean
  remarks: string | null
  location_name: string | null
  condition: string | null
}

export async function getPlantWeeklyRecords(plantId: string): Promise<WeeklyUsageRecord[]> {
  const response = await apiClient.get<ApiResponse<WeeklyUsageRecord[]>>(
    `/plants/${plantId}/weekly-records`
  );
  return response.data.data;
}

/**
 * Get plant events
 */
export interface PlantEvent {
  id: string
  plant_id: string
  event_type: string
  event_date: string | null
  year: number | null
  week_number: number | null
  from_location_id: string | null
  to_location_id: string | null
  from_location_name: string | null
  to_location_name: string | null
  details: Record<string, any> | null
  remarks: string | null
  acknowledged: boolean
  created_at: string
}

export async function getPlantEvents(plantId: string): Promise<PlantEvent[]> {
  const response = await apiClient.get<ApiResponse<PlantEvent[]>>(
    `/plants/${plantId}/events`
  );
  return response.data.data;
}

/**
 * Create a new plant (Admin only)
 */
export interface CreatePlantRequest {
  fleet_number: string
  description?: string
  fleet_type?: string
  make?: string
  model?: string
  chassis_number?: string
  year_of_manufacture?: number
  purchase_year?: number
  purchase_cost?: number
  serial_m?: string
  serial_e?: string
  remarks?: string
  current_location_id?: string
}

export async function createPlant(data: CreatePlantRequest): Promise<PlantSummary> {
  const response = await apiClient.post<ApiResponse<PlantSummary>>('/plants', data);
  return response.data.data;
}

/**
 * Update an existing plant (Admin only)
 */
export interface UpdatePlantRequest {
  description?: string
  fleet_type?: string
  make?: string
  model?: string
  chassis_number?: string
  year_of_manufacture?: number
  purchase_year?: number
  purchase_cost?: number
  serial_m?: string
  serial_e?: string
  remarks?: string
  current_location_id?: string
  condition?: string
  physical_verification?: boolean
}

export async function updatePlant(plantId: string, data: UpdatePlantRequest): Promise<PlantSummary> {
  // Backend PATCH uses query params, not request body
  const params: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null && value !== '') {
      params[key] = value;
    }
  }
  const response = await apiClient.patch<ApiResponse<PlantSummary>>(`/plants/${plantId}`, null, { params });
  return response.data.data;
}

/**
 * Delete a plant (Admin only)
 */
export async function deletePlant(plantId: string): Promise<void> {
  await apiClient.delete(`/plants/${plantId}`);
}

// ============================================================================
// Filtered Stats
// ============================================================================

export interface PlantFilteredStats {
  total: number;
  by_condition: Record<string, number>;
  by_location: Record<string, number>;
  by_fleet_type: Record<string, Record<string, number>>;
  by_state_fleet_type: Record<string, Record<string, Record<string, number>>>;
}

/**
 * Get aggregated stats for plants matching the current filters.
 */
export async function getFilteredPlantStats(
  params: Omit<PlantsListParams, 'page' | 'limit' | 'sort_by' | 'sort_order' | 'columns'>
): Promise<PlantFilteredStats> {
  const queryParams: Record<string, string> = {};

  if (params.condition) queryParams.condition = params.condition;
  if (params.location_id) queryParams.location_id = params.location_id;
  if (params.fleet_type) queryParams.fleet_type = params.fleet_type;
  if (params.state) queryParams.state = params.state;
  if (params.search) queryParams.search = params.search;
  if (params.verified_only) queryParams.verified_only = 'true';
  if (params.unknown_location) queryParams.unknown_location = 'true';
  if (params.pending_transfer) queryParams.pending_transfer = 'true';

  const response = await apiClient.get<ApiResponse<PlantFilteredStats>>(
    '/plants/filtered-stats',
    { params: queryParams }
  );

  return response.data.data;
}
