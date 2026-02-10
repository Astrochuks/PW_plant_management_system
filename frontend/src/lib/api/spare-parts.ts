/**
 * Spare Parts API functions
 * Handles all spare parts-related API calls
 */

import apiClient from './client';

// ============================================================================
// Types
// ============================================================================

export interface SparePart {
  id: string;
  plant_id: string;
  fleet_number: string | null;
  plant_description: string | null;
  part_description: string;
  part_number: string | null;
  replaced_date: string | null;
  supplier: string | null;
  supplier_name: string | null;
  reason_for_change: string | null;
  unit_cost: number | null;
  quantity: number;
  vat_percentage: number;
  discount_percentage: number;
  other_costs: number;
  total_cost: number | null;
  purchase_order_number: string | null;
  remarks: string | null;
  created_at: string;
  updated_at: string;
}

export interface SparePartsListParams {
  page?: number;
  limit?: number;
  plant_id?: string;
  fleet_number?: string;
  supplier?: string;
  date_from?: string;
  date_to?: string;
  search?: string;
}

export interface SparePartsStats {
  total_parts: number;
  total_cost: number;
  unique_plants: number;
  unique_suppliers: number;
  avg_cost_per_part: number;
}

export interface TopSupplier {
  supplier: string;
  total_spend: number;
  parts_count: number;
}

export interface HighCostPlant {
  plant_id: string;
  fleet_number: string;
  description: string | null;
  total_cost: number;
  parts_count: number;
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
 * Get paginated list of spare parts with optional filters
 */
export async function getSpareParts(params: SparePartsListParams = {}): Promise<{
  data: SparePart[];
  meta: PaginationMeta;
}> {
  const queryParams: Record<string, string> = {};

  if (params.page) queryParams.page = String(params.page);
  if (params.limit) queryParams.limit = String(params.limit);
  if (params.plant_id) queryParams.plant_id = params.plant_id;
  if (params.fleet_number) queryParams.fleet_number = params.fleet_number;
  if (params.supplier) queryParams.supplier = params.supplier;
  if (params.date_from) queryParams.date_from = params.date_from;
  if (params.date_to) queryParams.date_to = params.date_to;
  if (params.search) queryParams.search = params.search;

  const response = await apiClient.get<PaginatedApiResponse<SparePart>>('/spare-parts', {
    params: queryParams,
  });

  return {
    data: response.data.data,
    meta: response.data.meta,
  };
}

/**
 * Get a single spare part by ID
 */
export async function getSparePart(id: string): Promise<SparePart> {
  const response = await apiClient.get<ApiResponse<SparePart>>(`/spare-parts/${id}`);
  return response.data.data;
}

/**
 * Get spare parts statistics
 */
export async function getSparePartsStats(params: {
  year?: number;
  location_id?: string;
} = {}): Promise<SparePartsStats> {
  const queryParams: Record<string, string> = {};

  if (params.year) queryParams.year = String(params.year);
  if (params.location_id) queryParams.location_id = params.location_id;

  const response = await apiClient.get<ApiResponse<SparePartsStats>>('/spare-parts/stats', {
    params: queryParams,
  });
  return response.data.data;
}

/**
 * Get top suppliers by spend
 */
export async function getTopSuppliers(params: {
  limit?: number;
  year?: number;
} = {}): Promise<TopSupplier[]> {
  const queryParams: Record<string, string> = {};

  if (params.limit) queryParams.limit = String(params.limit);
  if (params.year) queryParams.year = String(params.year);

  const response = await apiClient.get<ApiResponse<TopSupplier[]>>('/spare-parts/top-suppliers', {
    params: queryParams,
  });
  return response.data.data;
}

/**
 * Get plants with highest maintenance costs
 */
export async function getHighCostPlants(params: {
  limit?: number;
  year?: number;
} = {}): Promise<HighCostPlant[]> {
  const queryParams: Record<string, string> = {};

  if (params.limit) queryParams.limit = String(params.limit);
  if (params.year) queryParams.year = String(params.year);

  const response = await apiClient.get<ApiResponse<HighCostPlant[]>>('/spare-parts/high-cost-plants', {
    params: queryParams,
  });
  return response.data.data;
}
