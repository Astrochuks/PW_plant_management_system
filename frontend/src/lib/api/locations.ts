/**
 * Locations API functions
 * Handles all location-related API calls
 */

import apiClient from './client';
import type { PlantCondition } from './plants';

// ============================================================================
// Types
// ============================================================================

export interface LocationStats {
  id: string;
  location_name: string;
  state_id: string | null;
  state_name: string | null;
  state_code: string | null;
  region: string | null;
  created_at: string;
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

export interface State {
  id: string;
  name: string;
  code: string | null;
  region: string | null;
  is_active: boolean;
  sites_count: number;
}

export interface LocationPlant {
  id: string;
  fleet_number: string;
  description: string | null;
  fleet_type: string | null;
  condition: PlantCondition | null;
  physical_verification: boolean;
  total_maintenance_cost: number | null;
  current_location: string | null;
  make: string | null;
  model: string | null;
}

export interface LocationSubmission {
  id: string;
  location_id: string;
  year: number;
  week_number: number;
  week_ending_date: string | null;
  submitted_at: string;
  submitted_by_name: string | null;
  submitted_by_email: string | null;
  status: string | null;
  plants_processed: number | null;
  plants_created: number | null;
  plants_updated: number | null;
  source_file_name: string | null;
}

export interface LocationUsage {
  location_id: string;
  location_name: string;
  period_label: string;
  hours_worked: number;
  standby_hours: number;
  breakdown_hours: number;
  utilization_rate: number;
  total_records: number;
  unique_plants: number;
  weeks_tracked: number;
  off_hire_count: number;
}

export interface LocationWeeklyRecord {
  id: string;
  plant_id: string;
  location_id: string;
  year: number;
  week_number: number;
  week_ending_date: string | null;
  hours_worked: number;
  standby_hours: number;
  breakdown_hours: number;
  off_hire: boolean;
  remarks: string | null;
  fleet_number: string;
  description: string | null;
}

export interface LocationTransfer {
  id: string;
  plant_id: string;
  from_location_id: string | null;
  to_location_id: string | null;
  from_location_raw: string | null;
  to_location_raw: string | null;
  transfer_date: string | null;
  detected_date: string | null;
  direction: 'inbound' | 'outbound';
  status: 'pending' | 'confirmed' | 'cancelled' | 'unknown';
  source_remarks: string | null;
  parsed_confidence: number | null;
  created_at: string;
  plant: { id: string; fleet_number: string; description: string | null } | null;
  from_location: { id: string; name: string } | null;
  to_location: { id: string; name: string } | null;
  source_week: number | null;
  source_year: number | null;
  week_ending_date: string | null;
}

export interface LocationTransfersParams {
  status?: string;
  limit?: number;
  offset?: number;
}

export interface LocationRecord {
  id: string;
  name: string;
  state_id: string | null;
  state: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateLocationRequest {
  name: string;
  state_id?: string;
}

export interface UpdateLocationRequest {
  name?: string;
  state_id?: string;
}

// Params types
export interface LocationPlantsParams {
  page?: number;
  limit?: number;
  condition?: string;
}

export interface LocationSubmissionsParams {
  year?: number;
  limit?: number;
}

export interface LocationUsageParams {
  year?: number;
  week?: number;
  period?: 'week' | 'month' | 'quarter' | 'year' | 'all';
}

export interface LocationWeeklyRecordsParams {
  year?: number;
  week?: number;
  page?: number;
  limit?: number;
}

// API Response wrappers
interface ApiResponse<T> {
  success: boolean;
  data: T;
}

interface PaginatedMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

interface LocationPlantsResponse {
  success: boolean;
  data: LocationPlant[];
  location: { id: string; name: string };
  meta: PaginatedMeta;
}

interface LocationWeeklyRecordsResponse {
  success: boolean;
  data: LocationWeeklyRecord[];
  meta: PaginatedMeta & { year?: number; week?: number; has_more?: boolean };
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
 * Create a new location (admin only)
 */
export async function createLocation(data: CreateLocationRequest): Promise<LocationRecord> {
  const params: Record<string, string> = { name: data.name };
  if (data.state_id) params.state_id = data.state_id;
  const response = await apiClient.post<ApiResponse<LocationRecord>>('/locations', null, { params });
  return response.data.data;
}

/**
 * Update a location (admin only)
 */
export async function updateLocation(id: string, data: UpdateLocationRequest): Promise<LocationRecord> {
  const params: Record<string, string> = {};
  if (data.name) params.name = data.name;
  if (data.state_id) params.state_id = data.state_id;
  const response = await apiClient.patch<ApiResponse<LocationRecord>>(`/locations/${id}`, null, { params });
  return response.data.data;
}

/**
 * Delete a location (admin only)
 */
export async function deleteLocation(id: string, force: boolean = false): Promise<void> {
  const params: Record<string, string> = {};
  if (force) params.force = 'true';
  await apiClient.delete(`/locations/${id}`, { params });
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
  if (params.condition) queryParams.status = params.condition;

  const response = await apiClient.get<LocationPlantsResponse>(
    `/locations/${locationId}/plants`,
    { params: queryParams }
  );
  return response.data;
}

/**
 * Get weekly report submissions for a location
 */
export async function getLocationSubmissions(
  locationId: string,
  params: LocationSubmissionsParams = {}
): Promise<LocationSubmission[]> {
  const queryParams: Record<string, string> = {};
  if (params.year) queryParams.year = String(params.year);
  if (params.limit) queryParams.limit = String(params.limit);

  const response = await apiClient.get<ApiResponse<LocationSubmission[]>>(
    `/locations/${locationId}/submissions`,
    { params: queryParams }
  );
  return response.data.data;
}

/**
 * Get usage statistics for a location
 */
export async function getLocationUsage(
  locationId: string,
  params: LocationUsageParams = {}
): Promise<LocationUsage> {
  const queryParams: Record<string, string> = {};
  if (params.year) queryParams.year = String(params.year);
  if (params.week) queryParams.week = String(params.week);
  if (params.period) queryParams.period = params.period;

  const response = await apiClient.get<ApiResponse<LocationUsage>>(
    `/locations/${locationId}/usage`,
    { params: queryParams }
  );
  return response.data.data;
}

/**
 * Get detailed weekly records for a location
 */
export async function getLocationWeeklyRecords(
  locationId: string,
  params: LocationWeeklyRecordsParams = {}
): Promise<LocationWeeklyRecordsResponse> {
  const queryParams: Record<string, string> = {};
  if (params.year) queryParams.year = String(params.year);
  if (params.week) queryParams.week = String(params.week);
  if (params.page) queryParams.page = String(params.page);
  if (params.limit) queryParams.limit = String(params.limit);

  const response = await apiClient.get<LocationWeeklyRecordsResponse>(
    `/locations/${locationId}/weekly-records`,
    { params: queryParams }
  );
  return response.data;
}

/**
 * Get transfers for a location (in and out)
 */
export async function getLocationTransfers(
  locationId: string,
  params: LocationTransfersParams = {}
): Promise<{ data: LocationTransfer[]; total: number }> {
  const queryParams: Record<string, string> = {
    location_id: locationId,
  };
  if (params.status) queryParams.status = params.status;
  if (params.limit) queryParams.limit = String(params.limit);
  if (params.offset) queryParams.offset = String(params.offset);

  const response = await apiClient.get<{
    success: boolean;
    data: LocationTransfer[];
    pagination: { total: number; limit: number; offset: number };
  }>('/transfers', { params: queryParams });

  return {
    data: response.data.data,
    total: response.data.pagination.total,
  };
}

/**
 * Get all states (basic list for dropdowns — active only)
 */
export async function getStates(): Promise<State[]> {
  const response = await apiClient.get<ApiResponse<State[]>>('/states');
  return response.data.data;
}

// ============================================================================
// States Admin API (CRUD)
// ============================================================================

export interface StateDetail extends State {
  sites: LocationStats[];
  created_at?: string;
  updated_at?: string;
}

export interface StatePlant {
  id: string;
  fleet_number: string;
  fleet_type: string | null;
  description: string | null;
  status: string | null;
  location_name: string | null;
  location_id: string | null;
}

export interface StatePlantsParams {
  page?: number;
  limit?: number;
  status?: string;
  fleet_type?: string;
}

export interface CreateStateRequest {
  name: string;
  code?: string;
  region?: string;
}

export interface UpdateStateRequest {
  name?: string;
  code?: string;
  region?: string;
  is_active?: boolean;
}

/**
 * Get all states with inactive support (admin page)
 */
export async function getStatesAdmin(
  params: { include_inactive?: boolean } = {}
): Promise<State[]> {
  const queryParams: Record<string, string> = {};
  if (params.include_inactive) queryParams.include_inactive = 'true';

  const response = await apiClient.get<{
    success: boolean;
    data: State[];
    meta: { total: number };
  }>('/states', { params: queryParams });

  return response.data.data;
}

/**
 * Get a single state by ID (with sites)
 */
export async function getState(id: string): Promise<StateDetail> {
  const response = await apiClient.get<ApiResponse<StateDetail>>(`/states/${id}`);
  return response.data.data;
}

/**
 * Get sites in a state
 */
export async function getStateSites(
  id: string
): Promise<{ data: LocationStats[]; meta: { state: { id: string; name: string }; total: number } }> {
  const response = await apiClient.get<{
    success: boolean;
    data: LocationStats[];
    meta: { state: { id: string; name: string }; total: number };
  }>(`/states/${id}/sites`);

  return { data: response.data.data, meta: response.data.meta };
}

/**
 * Get plants across all sites in a state (paginated)
 */
export async function getStatePlants(
  id: string,
  params: StatePlantsParams = {}
): Promise<{
  data: StatePlant[];
  meta: PaginatedMeta & { state: { id: string; name: string } };
}> {
  const queryParams: Record<string, string | number> = {};
  if (params.page) queryParams.page = params.page;
  if (params.limit) queryParams.limit = params.limit;
  if (params.status) queryParams.status = params.status;
  if (params.fleet_type) queryParams.fleet_type = params.fleet_type;

  const response = await apiClient.get<{
    success: boolean;
    data: StatePlant[];
    meta: PaginatedMeta & { state: { id: string; name: string } };
  }>(`/states/${id}/plants`, { params: queryParams });

  return { data: response.data.data, meta: response.data.meta };
}

/**
 * Create a new state (admin only, query params)
 */
export async function createState(data: CreateStateRequest): Promise<State> {
  const params: Record<string, string> = { name: data.name };
  if (data.code) params.code = data.code;
  if (data.region) params.region = data.region;

  const response = await apiClient.post<ApiResponse<State>>('/states', null, { params });
  return response.data.data;
}

/**
 * Update a state (admin only, query params)
 */
export async function updateState(id: string, data: UpdateStateRequest): Promise<State> {
  const params: Record<string, string> = {};
  if (data.name !== undefined) params.name = data.name;
  if (data.code !== undefined) params.code = data.code;
  if (data.region !== undefined) params.region = data.region;
  if (data.is_active !== undefined) params.is_active = String(data.is_active);

  const response = await apiClient.patch<ApiResponse<State>>(`/states/${id}`, null, { params });
  return response.data.data;
}

/**
 * Delete a state (admin only — fails if sites are linked)
 */
export async function deleteState(id: string): Promise<void> {
  await apiClient.delete(`/states/${id}`);
}
