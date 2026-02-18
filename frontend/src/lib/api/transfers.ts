/**
 * Transfers API functions
 */

import apiClient from './client';

// ============================================================================
// Types
// ============================================================================

export interface Transfer {
  id: string;
  plant_id: string;
  from_location_id: string | null;
  to_location_id: string | null;
  transfer_date: string | null;
  actual_arrival_date: string | null;
  direction: 'outbound' | 'inbound';
  status: 'pending' | 'confirmed' | 'cancelled';
  source_submission_id: string | null;
  confirmed_by_submission_id: string | null;
  source_remarks: string | null;
  created_at: string;
  updated_at: string | null;
  confirmed_at: string | null;
  // Enriched fields
  plant: { id: string; fleet_number: string; description: string | null } | null;
  from_location: { id: string; name: string } | null;
  to_location: { id: string; name: string } | null;
  source_week: number | null;
  source_year: number | null;
  week_ending_date: string | null;
}

export interface TransferStats {
  pending: number;
  confirmed: number;
  cancelled: number;
  recent_7_days: number;
  new_since: number;
}

export interface TransfersParams {
  status?: string;
  plant_id?: string;
  location_id?: string;
  limit?: number;
  offset?: number;
}

// ============================================================================
// API Functions
// ============================================================================

export async function getTransfers(params?: TransfersParams) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.plant_id) searchParams.set('plant_id', params.plant_id);
  if (params?.location_id) searchParams.set('location_id', params.location_id);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));

  const query = searchParams.toString();
  const response = await apiClient.get<{
    success: boolean;
    data: Transfer[];
    pagination: { total: number; limit: number; offset: number };
  }>(`/transfers${query ? `?${query}` : ''}`);
  return response.data;
}

export async function getPendingTransfers(locationId?: string) {
  const params = locationId ? `?location_id=${locationId}` : '';
  const response = await apiClient.get<{
    success: boolean;
    data: Transfer[];
    count: number;
  }>(`/transfers/pending${params}`);
  return response.data;
}

export async function getTransferStats(since?: string) {
  const params = since ? `?since=${encodeURIComponent(since)}` : '';
  const response = await apiClient.get<{
    success: boolean;
    data: TransferStats;
  }>(`/transfers/stats/summary${params}`);
  return response.data;
}

export async function confirmTransfer(transferId: string) {
  const response = await apiClient.post<{
    success: boolean;
    data: Transfer;
    message: string;
  }>(`/transfers/${transferId}/confirm`);
  return response.data;
}

export async function cancelTransfer(transferId: string, reason?: string) {
  const params = reason ? `?reason=${encodeURIComponent(reason)}` : '';
  const response = await apiClient.post<{
    success: boolean;
    data: Transfer;
    message: string;
  }>(`/transfers/${transferId}/cancel${params}`);
  return response.data;
}
