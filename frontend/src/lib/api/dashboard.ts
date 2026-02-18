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
  under_repair_plants: number;
  breakdown_plants: number;
  faulty_plants: number;
  missing_plants: number;
  scrap_plants: number;
  off_hire_plants: number;
  gpm_assessment_plants: number;
  unverified_condition_plants: number;
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
  under_repair_plants: number;
  breakdown_plants: number;
  faulty_plants: number;
  missing_plants: number;
  scrap_plants: number;
  off_hire_plants: number;
  gpm_assessment_plants: number;
  unverified_plants: number;
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
}

export interface FleetSummaryItem {
  fleet_type_id: string;
  fleet_type_name: string;
  total_count: number;
  verified_count: number;
  active_count: number;
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

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const response = await apiClient.get<ApiResponse<DashboardSummary>>('/reports/dashboard');
  return response.data.data;
}

export async function getFleetSummary(locationId?: string): Promise<FleetSummaryItem[]> {
  const params = locationId ? { location_id: locationId } : {};
  const response = await apiClient.get<ApiResponse<FleetSummaryItem[]>>('/reports/fleet-summary', { params });
  return response.data.data;
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
