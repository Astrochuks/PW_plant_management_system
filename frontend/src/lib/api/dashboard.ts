/**
 * Dashboard API functions
 * Response structures match backend exactly
 */

import apiClient from './client';

// Types matching backend responses

export interface DashboardPlantStats {
  total_plants: number;
  working_plants: number;
  standby_plants: number;
  breakdown_plants: number;
  missing_plants: number;
  scrap_plants: number;
  off_hire_plants: number;
  unknown_condition_plants: number;
  verified_plants: number;
  unverified_plants: number;
}

export interface LocationStat {
  id: string;
  location_name: string;
  state_id: string | null;
  state_name: string | null;
  state_code: string | null;
  region: string | null;
  total_plants: number;
  working_plants: number;
  standby_plants: number;
  breakdown_plants: number;
  missing_plants: number;
  scrap_plants: number;
  off_hire_plants: number;
  unknown_condition_plants: number;
}

export interface RecentSubmission {
  id: string;
  year: number;
  week_number: number;
  week_ending_date: string;
  location_id: string;
  location_name: string | null;
  status: string;
  plants_processed: number;
  plants_created: number;
  plants_updated: number;
  submitted_at: string;
}

export interface DashboardSummary {
  plants: DashboardPlantStats;
  top_locations: LocationStat[];
  recent_submissions: RecentSubmission[];
  unread_notifications: number;
  total_sites: number;
  total_states: number;
}

export interface FleetSummaryItem {
  fleet_type: string;
  total: number;
  working: number;
  standby: number;
  breakdown: number;
  other: number;
}

export interface PlantEvent {
  id: string;
  plant_id: string;
  event_type: 'movement' | 'missing' | 'new' | 'returned' | 'verification_failed';
  event_date: string;
  year: number;
  week_number: number;
  from_location_id: string | null;
  to_location_id: string | null;
  details: Record<string, unknown> | null;
  remarks: string | null;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
  fleet_number: string;
  plant_description: string | null;
}

// API Response wrappers (matching backend)
interface ApiResponse<T> {
  success: boolean;
  data: T;
}

interface PaginatedApiResponse<T> {
  success: boolean;
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
    has_more?: boolean;
  };
}

// API Functions

export interface DashboardFilterParams {
  state_id?: string;
  location_id?: string;
  fleet_type?: string;
  year?: number;
}

export async function getDashboardSummary(params?: DashboardFilterParams): Promise<DashboardSummary> {
  const response = await apiClient.get<ApiResponse<DashboardSummary>>('/reports/dashboard', { params });
  return response.data.data;
}

export async function getFleetSummary(locationId?: string): Promise<FleetSummaryItem[]> {
  const params = locationId ? { location_id: locationId } : {};
  const response = await apiClient.get<ApiResponse<Record<string, unknown>[]>>('/reports/fleet-summary', { params });
  return response.data.data.map((row) => ({
    fleet_type: String(row.fleet_type ?? 'Unknown'),
    total: Number(row.total ?? 0),
    working: Number(row.working ?? 0),
    standby: Number(row.standby ?? 0),
    breakdown: Number(row.breakdown ?? 0),
    other: Number(row.other ?? 0),
  }));
}

export async function getPlantEvents(params?: {
  event_type?: string;
  plant_id?: string;
  location_id?: string;
  acknowledged?: boolean;
  page?: number;
  limit?: number;
}): Promise<{ data: PlantEvent[]; meta: PaginatedApiResponse<PlantEvent>['meta'] }> {
  const response = await apiClient.get<PaginatedApiResponse<PlantEvent>>('/plants/events', { params });
  return {
    data: response.data.data,
    meta: response.data.meta,
  };
}

export async function acknowledgeEvent(eventId: string): Promise<void> {
  await apiClient.patch(`/plants/events/${eventId}/acknowledge`);
}

// Recently purchased plants
export interface RecentlyPurchasedPlant {
  id: string;
  fleet_number: string;
  description: string | null;
  fleet_type: string | null;
  make: string | null;
  model: string | null;
  purchase_year: number;
  purchase_month: number | null;
  purchase_cost: number | null;
  condition: string | null;
  current_location: string | null;
}

export async function getRecentlyPurchased(limit = 10): Promise<RecentlyPurchasedPlant[]> {
  const response = await apiClient.get<ApiResponse<RecentlyPurchasedPlant[]>>(
    '/reports/recently-purchased',
    { params: { limit } },
  );
  return response.data.data;
}

// States summary for the dashboard map

export interface StateSummary {
  id: string;
  name: string;
  code: string;
  region: string | null;
  sites_count: number;
  total_plants: number;
  working_plants: number;
  breakdown_plants: number;
  standby_plants: number;
  missing_plants: number;
  scrap_plants: number;
}

export async function getStatesSummary(fleetType?: string): Promise<StateSummary[]> {
  const params = fleetType ? { fleet_type: fleetType } : {};
  const response = await apiClient.get<ApiResponse<Record<string, unknown>[]>>(
    '/reports/states-summary',
    { params },
  );
  return response.data.data.map((row) => ({
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    code: String(row.code ?? ''),
    region: row.region ? String(row.region) : null,
    sites_count: Number(row.sites_count ?? 0),
    total_plants: Number(row.total_plants ?? 0),
    working_plants: Number(row.working_plants ?? 0),
    breakdown_plants: Number(row.breakdown_plants ?? 0),
    standby_plants: Number(row.standby_plants ?? 0),
    missing_plants: Number(row.missing_plants ?? 0),
    scrap_plants: Number(row.scrap_plants ?? 0),
  }));
}

// ── Fleet Distribution (states → sites → fleet type breakdown) ──────

export interface FleetDistSite {
  site_name: string;
  total_plants: number;
  fleet_types: Record<string, number>;
}

export interface FleetDistState {
  state_name: string;
  state_code: string;
  region: string | null;
  total_plants: number;
  sites: FleetDistSite[];
}

export async function getFleetDistribution(fleetType?: string): Promise<FleetDistState[]> {
  const params = fleetType ? { fleet_type: fleetType } : {};
  const response = await apiClient.get<ApiResponse<FleetDistState[]>>(
    '/reports/fleet-distribution',
    { params },
  );
  return response.data.data;
}
