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
  plant_id: string | null;
  fleet_number: string | null;        // from plants_master JOIN
  fleet_number_raw: string | null;     // raw fleet input stored on spare_parts
  plant_description: string | null;    // from plants_master JOIN
  part_description: string;
  part_number: string | null;
  replaced_date: string | null;
  supplier: string | null;             // raw supplier text
  supplier_id: string | null;          // FK to suppliers table
  supplier_name: string | null;        // COALESCE(s.name, sp.supplier) from JOIN
  reason_for_change: string | null;
  unit_cost: number | null;
  quantity: number;
  vat_percentage: number;
  vat_amount: number | null;
  discount_percentage: number;
  discount_amount: number | null;
  other_costs: number;
  total_cost: number | null;
  purchase_order_number: string | null;
  po_date: string | null;
  requisition_number: string | null;
  location_id: string | null;
  remarks: string | null;
  // Cost classification
  is_workshop: boolean;
  is_category: boolean;
  category_name: string | null;
  cost_type: string | null;            // "direct" | "shared"
  submission_number?: number;           // batch within a PO
  shared_fleet_numbers?: string[] | null; // fleets sharing this cost item
  // Timestamps & time bucketing
  year: number | null;
  month: number | null;
  week_number: number | null;
  quarter: number | null;
  created_at: string;
  updated_at: string;
}

export interface SparePartsListParams {
  page?: number;
  limit?: number;
  plant_id?: string;
  fleet_number?: string;
  location_id?: string;
  supplier_id?: string;
  supplier?: string;
  po_number?: string;
  date_from?: string;
  date_to?: string;
  year?: number;
  month?: number;
  week?: number;
  quarter?: number;
  search?: string;
}

export interface POSummary {
  po_number: string;
  po_date: string | null;
  supplier_id: string | null;
  vendor: string;
  location_id: string | null;
  location_name: string | null;       // from locations JOIN in backend
  req_no: string | null;
  items_count: number;
  plants_count: number;
  total_amount: number;
  subtotal: number;
  has_workshop: boolean;
  has_category: boolean;
  cost_type: string;                   // "direct" | "shared"
  year: number | null;
  month: number | null;
  week_number: number | null;
  quarter: number | null;
  created_at: string;
  updated_at: string;
}

export interface POSupplierSummary {
  id: string | null;
  name: string;
  items_count: number;
  total_cost: number;
}

export interface POOverhead {
  vat_amount: number;
  discount_amount: number;
  other_costs: number;
}

export interface POSubmissionDocument {
  url: string;
  name: string;
  uploaded_at: string | null;
}

export interface POSubmission {
  submission_number: number;
  items_count: number;
  subtotal: number;
  vat_amount: number;
  discount_amount: number;
  other_costs: number;
  total: number;
  document: POSubmissionDocument | null;
}

export interface PODetailMeta {
  po_number: string;
  items_count: number;
  total_cost: number;
  distinct_plants: number;
  cost_type?: 'direct' | 'shared';
  supplier: { id: string; name: string } | null;
  suppliers?: POSupplierSummary[];
  overhead?: POOverhead;
  submissions?: POSubmission[];
}

export interface UpdatePORequest {
  po_date?: string;
  supplier_id?: string;
  vat_amount?: number;
  discount_amount?: number;
  location_id?: string;
  requisition_number?: string;
}

export interface POListParams {
  page?: number;
  limit?: number;
  location_id?: string;
  supplier_id?: string;
  plant_id?: string;
  fleet_number?: string;
  date_from?: string;
  date_to?: string;
  vendor?: string;
  search?: string;
  cost_type?: string;
  year?: number;
  month?: number;
  week?: number;
  quarter?: number;
  sort_by?: string;
  sort_order?: string;
}

export interface BulkCreateRequest {
  fleet_numbers: string;
  purchase_order_number: string;
  items: string;
  po_date?: string;
  requisition_number?: string;
  location_id?: string;
  supplier_id?: string;
  supplier?: string;
  vat_percentage?: number;
  vat_amount?: number;
  discount_percentage?: number;
  discount_amount?: number;
  other_costs?: number;
}

export interface CreateSparePartRequest {
  plant_id?: string;
  fleet_number?: string;
  part_description: string;
  part_number?: string;
  supplier?: string;
  reason_for_change?: string;
  unit_cost?: number;
  quantity?: number;
  vat_percentage?: number;
  discount_percentage?: number;
  other_costs?: number;
  purchase_order_number?: string;
  po_date?: string;
  requisition_number?: string;
  location_id?: string;
  remarks?: string;
}

export interface SparePartsStats {
  total_parts: number;
  total_spend: number;
  avg_cost_per_part: number;
  unique_plants: number;
  unique_suppliers: number;
  parts_in_period: number;
  spend_in_period: number;
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
  if (params.location_id) queryParams.location_id = params.location_id;
  if (params.supplier_id) queryParams.supplier_id = params.supplier_id;
  if (params.supplier) queryParams.supplier = params.supplier;
  if (params.po_number) queryParams.po_number = params.po_number;
  if (params.date_from) queryParams.date_from = params.date_from;
  if (params.date_to) queryParams.date_to = params.date_to;
  if (params.year) queryParams.year = String(params.year);
  if (params.month) queryParams.month = String(params.month);
  if (params.week) queryParams.week = String(params.week);
  if (params.quarter) queryParams.quarter = String(params.quarter);
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
 * Get spare parts statistics.
 * Backend function returns NUMERIC types as strings — normalize to numbers.
 */
export async function getSparePartsStats(params: {
  year?: number;
  month?: number;
  week?: number;
  quarter?: number;
  location_id?: string;
  supplier_id?: string;
} = {}): Promise<SparePartsStats> {
  const queryParams: Record<string, string> = {};

  if (params.year) queryParams.year = String(params.year);
  if (params.month) queryParams.month = String(params.month);
  if (params.week) queryParams.week = String(params.week);
  if (params.quarter) queryParams.quarter = String(params.quarter);
  if (params.location_id) queryParams.location_id = params.location_id;
  if (params.supplier_id) queryParams.supplier_id = params.supplier_id;

  const response = await apiClient.get<ApiResponse<Record<string, unknown>>>('/spare-parts/stats', {
    params: queryParams,
  });

  const d = response.data.data;
  return {
    total_parts: Number(d.total_parts ?? 0),
    total_spend: Number(d.total_spend ?? 0),
    avg_cost_per_part: Number(d.avg_cost_per_part ?? 0),
    unique_plants: Number(d.unique_plants ?? 0),
    unique_suppliers: Number(d.unique_suppliers ?? 0),
    parts_in_period: Number(d.parts_in_period ?? 0),
    spend_in_period: Number(d.spend_in_period ?? 0),
  };
}

/**
 * Get top suppliers by spend.
 * Backend function returns: supplier_id, supplier_name, total_spend,
 * parts_count, avg_part_cost, plants_serviced, po_count
 */
export async function getTopSuppliers(params: {
  limit?: number;
  year?: number;
  month?: number;
  quarter?: number;
  location_id?: string;
} = {}): Promise<TopSupplier[]> {
  const queryParams: Record<string, string> = {};

  if (params.limit) queryParams.limit = String(params.limit);
  if (params.year) queryParams.year = String(params.year);
  if (params.month) queryParams.month = String(params.month);
  if (params.quarter) queryParams.quarter = String(params.quarter);
  if (params.location_id) queryParams.location_id = params.location_id;

  const response = await apiClient.get<ApiResponse<Record<string, unknown>[]>>('/spare-parts/top-suppliers', {
    params: queryParams,
  });

  // Normalize: backend returns supplier_name, total_spend as NUMERIC (string)
  return response.data.data.map((row) => ({
    supplier: String(row.supplier_name ?? row.supplier ?? ''),
    total_spend: Number(row.total_spend ?? 0),
    parts_count: Number(row.parts_count ?? 0),
  }));
}

/**
 * Get plants with highest maintenance costs.
 * Backend function returns: plant_id, fleet_number, plant_description,
 * current_location, maintenance_cost, parts_count, last_maintenance
 */
export async function getHighCostPlants(params: {
  limit?: number;
  year?: number;
} = {}): Promise<HighCostPlant[]> {
  const queryParams: Record<string, string> = {};

  if (params.limit) queryParams.limit = String(params.limit);
  if (params.year) queryParams.year = String(params.year);

  const response = await apiClient.get<ApiResponse<Record<string, unknown>[]>>('/spare-parts/high-cost-plants', {
    params: queryParams,
  });

  // Normalize backend field names → frontend interface
  return response.data.data.map((row) => ({
    plant_id: String(row.plant_id ?? ''),
    fleet_number: String(row.fleet_number ?? ''),
    description: String(row.plant_description ?? row.description ?? ''),
    total_cost: Number(row.maintenance_cost ?? row.total_cost ?? 0),
    parts_count: Number(row.parts_count ?? 0),
  }));
}

/**
 * Create a spare part record (admin only)
 */
export async function createSparePart(data: CreateSparePartRequest): Promise<SparePart> {
  const queryParams: Record<string, string> = {};
  // Backend uses query params for spare parts creation
  if (data.plant_id) queryParams.plant_id = data.plant_id;
  if (data.fleet_number) queryParams.fleet_number = data.fleet_number;
  queryParams.part_description = data.part_description;
  if (data.part_number) queryParams.part_number = data.part_number;
  if (data.supplier) queryParams.supplier = data.supplier;
  if (data.reason_for_change) queryParams.reason_for_change = data.reason_for_change;
  if (data.unit_cost != null) queryParams.unit_cost = String(data.unit_cost);
  if (data.quantity != null) queryParams.quantity = String(data.quantity);
  if (data.vat_percentage != null) queryParams.vat_percentage = String(data.vat_percentage);
  if (data.discount_percentage != null) queryParams.discount_percentage = String(data.discount_percentage);
  if (data.other_costs != null) queryParams.other_costs = String(data.other_costs);
  if (data.purchase_order_number) queryParams.purchase_order_number = data.purchase_order_number;
  if (data.po_date) queryParams.po_date = data.po_date;
  if (data.requisition_number) queryParams.requisition_number = data.requisition_number;
  if (data.location_id) queryParams.location_id = data.location_id;
  if (data.remarks) queryParams.remarks = data.remarks;

  const response = await apiClient.post<ApiResponse<SparePart>>('/spare-parts', null, {
    params: queryParams,
  });
  return response.data.data;
}

/**
 * Delete a spare part record (admin only)
 */
export async function deleteSparePart(id: string): Promise<void> {
  await apiClient.delete(`/spare-parts/${id}`);
}

/**
 * Get all parts by PO number (with meta: items_count, total_cost, distinct_plants, supplier)
 */
export async function getPartsByPO(poNumber: string): Promise<{
  data: SparePart[];
  meta: PODetailMeta;
}> {
  const response = await apiClient.get<{
    success: boolean;
    data: SparePart[];
    meta: PODetailMeta;
  }>(`/spare-parts/by-po/${encodeURIComponent(poNumber)}`);
  return { data: response.data.data, meta: response.data.meta };
}

/**
 * Delete all parts in a PO (admin only)
 */
export async function deletePartsByPO(poNumber: string): Promise<void> {
  await apiClient.delete(`/spare-parts/by-po/${encodeURIComponent(poNumber)}`);
}

/**
 * List purchase orders (aggregated from spare_parts)
 */
export async function getPurchaseOrders(params: POListParams = {}): Promise<{
  data: POSummary[];
  meta: PaginationMeta & { total_amount: number };
}> {
  const queryParams: Record<string, string> = {};
  if (params.page) queryParams.page = String(params.page);
  if (params.limit) queryParams.limit = String(params.limit);
  if (params.location_id) queryParams.location_id = params.location_id;
  if (params.supplier_id) queryParams.supplier_id = params.supplier_id;
  if (params.plant_id) queryParams.plant_id = params.plant_id;
  if (params.fleet_number) queryParams.fleet_number = params.fleet_number;
  if (params.date_from) queryParams.date_from = params.date_from;
  if (params.date_to) queryParams.date_to = params.date_to;
  if (params.vendor) queryParams.vendor = params.vendor;
  if (params.search) queryParams.search = params.search;
  if (params.cost_type) queryParams.cost_type = params.cost_type;
  if (params.year) queryParams.year = String(params.year);
  if (params.month) queryParams.month = String(params.month);
  if (params.week) queryParams.week = String(params.week);
  if (params.quarter) queryParams.quarter = String(params.quarter);
  if (params.sort_by) queryParams.sort_by = params.sort_by;
  if (params.sort_order) queryParams.sort_order = params.sort_order;

  const response = await apiClient.get<{
    success: boolean;
    data: POSummary[];
    meta: PaginationMeta & { total_amount: number };
  }>('/spare-parts/pos', { params: queryParams });
  return { data: response.data.data, meta: response.data.meta };
}

/**
 * Bulk create spare parts from a PO (admin only)
 */
export async function bulkCreateSpareParts(data: BulkCreateRequest): Promise<{
  data: SparePart[];
  meta: Record<string, unknown>;
}> {
  const queryParams: Record<string, string> = {};
  queryParams.fleet_numbers = data.fleet_numbers;
  queryParams.purchase_order_number = data.purchase_order_number;
  queryParams.items = data.items;
  if (data.po_date) queryParams.po_date = data.po_date;
  if (data.requisition_number) queryParams.requisition_number = data.requisition_number;
  if (data.location_id) queryParams.location_id = data.location_id;
  if (data.supplier_id) queryParams.supplier_id = data.supplier_id;
  if (data.supplier) queryParams.supplier = data.supplier;
  if (data.vat_percentage != null) queryParams.vat_percentage = String(data.vat_percentage);
  if (data.vat_amount != null) queryParams.vat_amount = String(data.vat_amount);
  if (data.discount_percentage != null) queryParams.discount_percentage = String(data.discount_percentage);
  if (data.discount_amount != null) queryParams.discount_amount = String(data.discount_amount);
  if (data.other_costs != null) queryParams.other_costs = String(data.other_costs);

  const response = await apiClient.post<{
    success: boolean;
    data: SparePart[];
    meta: Record<string, unknown>;
  }>('/spare-parts/bulk', null, { params: queryParams, timeout: 60000 });
  return { data: response.data.data, meta: response.data.meta };
}

/**
 * Get PO document URL (scoped to submission)
 */
export async function getPODocument(poNumber: string, submissionNumber?: number): Promise<{
  po_number: string;
  document_url: string;
  document_name: string;
  uploaded_at: string;
} | null> {
  try {
    const params: Record<string, string> = {};
    if (submissionNumber != null) params.submission_number = String(submissionNumber);
    const response = await apiClient.get<ApiResponse<{
      po_number: string;
      document_url: string;
      document_name: string;
      uploaded_at: string;
    }>>(`/spare-parts/by-po/${encodeURIComponent(poNumber)}/document`, { params });
    return response.data.data;
  } catch {
    return null;
  }
}

/**
 * Upload PO document (admin only, scoped to submission)
 */
export async function uploadPODocument(poNumber: string, file: File, submissionNumber?: number): Promise<{
  po_number: string;
  document_url: string;
  document_name: string;
}> {
  const formData = new FormData();
  formData.append('file', file);
  const params: Record<string, string> = {};
  if (submissionNumber != null) params.submission_number = String(submissionNumber);
  const response = await apiClient.post<ApiResponse<{
    po_number: string;
    document_url: string;
    document_name: string;
  }>>(`/spare-parts/by-po/${encodeURIComponent(poNumber)}/document`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    params,
  });
  return response.data.data;
}

/**
 * Update PO details (admin only) — date, supplier, vat, discount, location, requisition
 */
export async function updatePO(poNumber: string, data: UpdatePORequest): Promise<{
  message: string;
  updated_fields: string[];
}> {
  const queryParams: Record<string, string> = {};
  if (data.po_date) queryParams.po_date = data.po_date;
  if (data.supplier_id) queryParams.supplier_id = data.supplier_id;
  if (data.vat_amount != null) queryParams.vat_amount = String(data.vat_amount);
  if (data.discount_amount != null) queryParams.discount_amount = String(data.discount_amount);
  if (data.location_id) queryParams.location_id = data.location_id;
  if (data.requisition_number) queryParams.requisition_number = data.requisition_number;

  const response = await apiClient.patch<{
    success: boolean;
    message: string;
    updated_fields: string[];
  }>(`/spare-parts/by-po/${encodeURIComponent(poNumber)}`, null, {
    params: queryParams,
  });
  return { message: response.data.message, updated_fields: response.data.updated_fields };
}

/**
 * Delete PO document (admin only, scoped to submission)
 */
export async function deletePODocument(poNumber: string, submissionNumber?: number): Promise<void> {
  const params: Record<string, string> = {};
  if (submissionNumber != null) params.submission_number = String(submissionNumber);
  await apiClient.delete(`/spare-parts/by-po/${encodeURIComponent(poNumber)}/document`, { params });
}

// ============================================================================
// Plant Cost Analytics
// ============================================================================

export interface PlantCosts {
  plant: {
    id: string;
    fleet_number: string;
    description: string;
    fleet_type: string;
    current_location_id: string | null;
    current_location: string | null;
  };
  costs: {
    total_cost: number;
    parts_count: number;
    po_count: number;
  };
  recent_parts: PlantRecentPart[];
}

/**
 * Get maintenance costs for a specific plant
 */
export async function getPlantCosts(plantId: string, params: {
  year?: number;
  month?: number;
  quarter?: number;
  week?: number;
} = {}): Promise<PlantCosts> {
  const queryParams: Record<string, string> = {};
  if (params.year) queryParams.year = String(params.year);
  if (params.month) queryParams.month = String(params.month);
  if (params.quarter) queryParams.quarter = String(params.quarter);
  if (params.week) queryParams.week = String(params.week);

  const response = await apiClient.get<ApiResponse<PlantCosts>>(
    `/spare-parts/plant/${plantId}/costs`,
    { params: queryParams }
  );
  return response.data.data;
}

export interface CostByPeriod {
  period: number;       // week 1-52, month 1-12, quarter 1-4, or year YYYY
  total_cost: number;
  items_count: number;
  po_count: number;
}

export interface CostByPeriodMeta {
  period_type: 'week' | 'month' | 'quarter' | 'year';
  year: number;
  grand_total: number;
  periods_count: number;
}

export interface CostByPeriodResponse {
  data: CostByPeriod[];
  meta: CostByPeriodMeta;
}

/**
 * Get spare parts costs grouped by period (week/month/quarter/year)
 */
export async function getCostsByPeriod(params: {
  period: 'week' | 'month' | 'quarter' | 'year';
  year: number;
  plant_id?: string;
  location_id?: string;
}): Promise<CostByPeriodResponse> {
  const queryParams: Record<string, string> = {
    period: params.period,
    year: String(params.year),
  };
  if (params.plant_id) queryParams.plant_id = params.plant_id;
  if (params.location_id) queryParams.location_id = params.location_id;

  const response = await apiClient.get<{
    success: boolean;
    data: Record<string, unknown>[];
    meta: CostByPeriodMeta;
  }>('/spare-parts/analytics/by-period', { params: queryParams });

  // Backend returns dynamic key: { week: 1, total_cost: X } or { month: 3, ... }
  // Normalize to { period: N, ... }
  const normalized: CostByPeriod[] = response.data.data.map((item) => ({
    period: Number(item[params.period] ?? 0),
    total_cost: Number(item.total_cost ?? 0),
    items_count: Number(item.items_count ?? 0),
    po_count: Number(item.po_count ?? 0),
  }));

  return { data: normalized, meta: response.data.meta };
}

export interface SparePartsSummary {
  total_cost: number;
  total_parts: number;
  total_pos: number;
  direct_cost: number;
  shared_cost: number;  // computed: total - direct - workshop - category
  workshop_cost: number;
  category_cost: number;
}

export interface LocationCosts {
  location: { id: string; name: string };
  costs: {
    total_cost: number;
    direct_cost: number;
    workshop_cost: number;
    category_cost: number;
  };
  items_count: number;
  plants_count: number;
}

export interface PlantRecentPart {
  id: string;
  part_description: string;
  quantity: number;
  total_cost: number;
  purchase_order_number: string | null;
  replaced_date: string | null;
  supplier: string | null;
}

export interface UpdateSparePartRequest {
  part_description?: string;
  replaced_date?: string;
  part_number?: string;
  supplier?: string;
  reason_for_change?: string;
  unit_cost?: number;
  quantity?: number;
  vat_percentage?: number;
  discount_percentage?: number;
  other_costs?: number;
  purchase_order_number?: string;
  remarks?: string;
}

export interface PlantSharedCost {
  label: string;
  po_number: string | null;
  po_date: string | null;
  items_subtotal: number;
  total_amount: number;
  po_vat: number;
  po_discount: number;
  po_other: number;
  supplier: string | null;
  shared_with: string[];
  items: string[];
}

export interface PlantSharedCostsResponse {
  plant: { id: string; fleet_number: string; description: string };
  shared_costs: PlantSharedCost[];
  shared_costs_count: number;
}

export interface YearOverYearEntry {
  [key: string]: number;
}

export interface YearOverYearResponse {
  data: YearOverYearEntry[];
  meta: {
    years: number[];
    group_by: 'month' | 'quarter';
    yearly_totals: Record<string, number>;
  };
}

export interface PONumberSuggestion {
  po_number: string;
  items_count: number;
  total_cost?: number;
  suppliers?: string[];
}

/**
 * Get overall spare parts cost summary.
 * Backend returns: total_cost, direct_cost, workshop_cost, category_cost,
 * items_count, po_count, plants_count, locations_count
 */
export async function getSparePartsSummary(params: {
  year?: number;
  month?: number;
  location_id?: string;
} = {}): Promise<SparePartsSummary> {
  const queryParams: Record<string, string> = {};
  if (params.year) queryParams.year = String(params.year);
  if (params.month) queryParams.month = String(params.month);
  if (params.location_id) queryParams.location_id = params.location_id;

  const response = await apiClient.get<ApiResponse<Record<string, unknown>>>(
    '/spare-parts/summary',
    { params: queryParams }
  );

  const d = response.data.data;
  const total = Number(d.total_cost ?? 0);
  const direct = Number(d.direct_cost ?? 0);
  const workshop = Number(d.workshop_cost ?? 0);
  const category = Number(d.category_cost ?? 0);

  return {
    total_cost: total,
    direct_cost: direct,
    workshop_cost: workshop,
    category_cost: category,
    shared_cost: Math.max(0, total - direct - workshop - category),
    total_parts: Number(d.items_count ?? d.total_parts ?? 0),
    total_pos: Number(d.po_count ?? d.total_pos ?? 0),
  };
}

/**
 * Get maintenance costs for a specific location
 */
export async function getLocationCosts(locationId: string, params: {
  year?: number;
  month?: number;
} = {}): Promise<LocationCosts> {
  const queryParams: Record<string, string> = {};
  if (params.year) queryParams.year = String(params.year);
  if (params.month) queryParams.month = String(params.month);

  const response = await apiClient.get<ApiResponse<LocationCosts>>(
    `/spare-parts/location/${locationId}/costs`,
    { params: queryParams }
  );
  return response.data.data;
}

// ============================================================================
// Autocomplete
// ============================================================================

/**
 * Autocomplete part descriptions (min 2 chars)
 */
export async function autocompleteDescriptions(q: string, limit = 10): Promise<string[]> {
  const response = await apiClient.get<ApiResponse<string[]>>(
    '/spare-parts/autocomplete/descriptions',
    { params: { q, limit: String(limit) } }
  );
  return response.data.data;
}

/**
 * Autocomplete PO numbers (min 1 char)
 */
export async function autocompletePONumbers(q: string, limit = 10): Promise<PONumberSuggestion[]> {
  const response = await apiClient.get<ApiResponse<PONumberSuggestion[]>>(
    '/spare-parts/autocomplete/po-numbers',
    { params: { q, limit: String(limit) } }
  );
  return response.data.data;
}

// ============================================================================
// Update Spare Part
// ============================================================================

/**
 * Update a single spare part (admin only). Uses query params.
 */
export async function updateSparePart(partId: string, data: UpdateSparePartRequest): Promise<SparePart> {
  const queryParams: Record<string, string> = {};
  if (data.part_description != null) queryParams.part_description = data.part_description;
  if (data.replaced_date != null) queryParams.replaced_date = data.replaced_date;
  if (data.part_number != null) queryParams.part_number = data.part_number;
  if (data.supplier != null) queryParams.supplier = data.supplier;
  if (data.reason_for_change != null) queryParams.reason_for_change = data.reason_for_change;
  if (data.unit_cost != null) queryParams.unit_cost = String(data.unit_cost);
  if (data.quantity != null) queryParams.quantity = String(data.quantity);
  if (data.vat_percentage != null) queryParams.vat_percentage = String(data.vat_percentage);
  if (data.discount_percentage != null) queryParams.discount_percentage = String(data.discount_percentage);
  if (data.other_costs != null) queryParams.other_costs = String(data.other_costs);
  if (data.purchase_order_number != null) queryParams.purchase_order_number = data.purchase_order_number;
  if (data.remarks != null) queryParams.remarks = data.remarks;

  const response = await apiClient.patch<ApiResponse<SparePart>>(
    `/spare-parts/${partId}`,
    null,
    { params: queryParams }
  );
  return response.data.data;
}

// ============================================================================
// Plant Shared Costs
// ============================================================================

/**
 * Get shared costs for a specific plant
 */
export async function getPlantSharedCosts(plantId: string): Promise<PlantSharedCostsResponse> {
  const response = await apiClient.get<ApiResponse<PlantSharedCostsResponse>>(
    `/spare-parts/plant/${plantId}/shared-costs`
  );
  return response.data.data;
}

// ============================================================================
// Year-over-Year Analytics
// ============================================================================

/**
 * Compare costs year-over-year
 */
export async function getYearOverYear(params: {
  years: number[];
  group_by?: 'month' | 'quarter';
  plant_id?: string;
  location_id?: string;
}): Promise<YearOverYearResponse> {
  const queryParams: Record<string, string> = {
    years: params.years.join(','),
  };
  if (params.group_by) queryParams.group_by = params.group_by;
  if (params.plant_id) queryParams.plant_id = params.plant_id;
  if (params.location_id) queryParams.location_id = params.location_id;

  const response = await apiClient.get<{
    success: boolean;
    data: YearOverYearEntry[];
    meta: {
      years: number[];
      group_by: 'month' | 'quarter';
      yearly_totals: Record<string, number>;
    };
  }>('/spare-parts/analytics/year-over-year', { params: queryParams });

  return { data: response.data.data, meta: response.data.meta };
}
