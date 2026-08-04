/**
 * Reports API functions
 * Handles all reports and analytics API calls
 */

import apiClient, { EXPORT_TIMEOUT_MS } from './client';

// ============================================================================
// Types
// ============================================================================

export interface FleetSummaryData {
  fleet_type: string;
  total: number;
  working: number;
  standby: number;
  breakdown: number;
  missing: number;
  scrap: number;
  off_hire: number;
  /** No condition recorded at all — should be 0; a data gap, not a bucket. */
  unknown: number;
}

export type MaintenanceCostGroupBy =
  | 'week'
  | 'month'
  | 'quarter'
  | 'year'
  | 'fleet_type'
  | 'location'
  | 'plant';

export interface MaintenanceCostData {
  period: string;
  total_cost: number;
  parts_count: number;
  [key: string]: unknown;
}

export interface MaintenanceCostsMeta {
  group_by: string;
  year: number | null;
  total_groups: number;
  grand_total: number;
}

export interface MaintenanceCostsResponse {
  data: MaintenanceCostData[];
  meta: MaintenanceCostsMeta;
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
 * Get fleet summary by type
 */
export async function getFleetSummary(params: {
  location_id?: string;
} = {}): Promise<FleetSummaryData[]> {
  const queryParams: Record<string, string> = {};

  if (params.location_id) queryParams.location_id = params.location_id;

  const response = await apiClient.get<ApiResponse<Record<string, unknown>[]>>(
    '/reports/fleet-summary',
    { params: queryParams }
  );

  // Normalize: asyncpg may return bigint as string
  return response.data.data.map((row) => ({
    fleet_type: String(row.fleet_type ?? 'Unknown'),
    total: Number(row.total ?? 0),
    working: Number(row.working ?? 0),
    standby: Number(row.standby ?? 0),
    breakdown: Number(row.breakdown ?? 0),
    missing: Number(row.missing ?? 0),
    scrap: Number(row.scrap ?? 0),
    off_hire: Number(row.off_hire ?? 0),
    unknown: Number(row.unknown ?? 0),
  }));
}

/**
 * Get maintenance cost analysis
 */
export async function getMaintenanceCosts(params: {
  year?: number;
  location_id?: string;
  plant_id?: string;
  fleet_type?: string;
  group_by?: MaintenanceCostGroupBy;
} = {}): Promise<MaintenanceCostsResponse> {
  const queryParams: Record<string, string> = {};

  if (params.year) queryParams.year = String(params.year);
  if (params.location_id) queryParams.location_id = params.location_id;
  if (params.plant_id) queryParams.plant_id = params.plant_id;
  if (params.fleet_type) queryParams.fleet_type = params.fleet_type;
  if (params.group_by) queryParams.group_by = params.group_by;

  const response = await apiClient.get<{
    success: boolean;
    data: Record<string, unknown>[];
    meta: MaintenanceCostsMeta;
  }>('/reports/maintenance-costs', { params: queryParams });

  // Normalize: DB returns group_key/part_count, frontend expects period/parts_count
  return {
    data: response.data.data.map((row) => ({
      period: String(row.group_key ?? row.period ?? ''),
      total_cost: Number(row.total_cost ?? 0),
      parts_count: Number(row.part_count ?? row.parts_count ?? 0),
    })),
    meta: {
      ...response.data.meta,
      grand_total: Number(response.data.meta.grand_total ?? 0),
    },
  };
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

  const response = await apiClient.get<ApiResponse<Record<string, unknown>[]>>(
    '/reports/verification-status',
    { params: queryParams }
  );

  // Normalize: DB returns verified_count, frontend expects verified_plants
  return response.data.data.map((row) => ({
    location_id: String(row.location_id ?? ''),
    location_name: String(row.location_name ?? ''),
    total_plants: Number(row.total_plants ?? 0),
    verified_plants: Number(row.verified_count ?? row.verified_plants ?? 0),
    verification_rate: Number(row.verification_rate ?? 0),
  }));
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

  const response = await apiClient.get<ApiResponse<Record<string, unknown>[]>>(
    '/reports/submission-compliance',
    { params: queryParams }
  );

  // Normalize: DB returns total_expected/total_submitted, frontend expects expected_submissions/actual_submissions
  return response.data.data.map((row) => ({
    location_id: String(row.location_id ?? ''),
    location_name: String(row.location_name ?? ''),
    expected_submissions: Number(row.total_expected ?? row.expected_submissions ?? 0),
    actual_submissions: Number(row.total_submitted ?? row.actual_submissions ?? 0),
    compliance_rate: Number(row.compliance_rate ?? 0),
  }));
}

/**
 * Get plant movement report
 */
export async function getPlantMovement(params: {
  date_from?: string;
  date_to?: string;
  fleet_type?: string;
} = {}): Promise<PlantMovementData[]> {
  const queryParams: Record<string, string> = {};

  if (params.date_from) queryParams.date_from = params.date_from;
  if (params.date_to) queryParams.date_to = params.date_to;
  if (params.fleet_type) queryParams.fleet_type = params.fleet_type;

  const response = await apiClient.get<ApiResponse<Record<string, unknown>[]>>(
    '/reports/plant-movement',
    { params: queryParams }
  );

  // Normalize: DB returns plant_id/event_date, frontend expects plant_id/transfer_date
  return response.data.data.map((row) => ({
    plant_id: String(row.plant_id ?? ''),
    fleet_number: String(row.fleet_number ?? ''),
    from_location: String(row.from_location ?? ''),
    to_location: String(row.to_location ?? ''),
    transfer_date: String(row.event_date ?? row.transfer_date ?? ''),
    transferred_by: row.transferred_by ? String(row.transferred_by) : null,
  }));
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

  const response = await apiClient.get<ApiResponse<Record<string, unknown>[]>>(
    '/reports/weekly-trend',
    { params: queryParams }
  );

  // Normalize: DB returns total_plants, frontend expects plant_count; year comes from params
  return response.data.data.map((row) => ({
    week_number: Number(row.week_number ?? 0),
    year: Number(row.year ?? params.year),
    plant_count: Number(row.total_plants ?? row.plant_count ?? 0),
    verified_count: Number(row.verified_count ?? 0),
    verification_rate: Number(row.verification_rate ?? 0),
  }));
}

export interface UnverifiedPlantsMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export interface UnverifiedPlantsResponse {
  data: UnverifiedPlantData[];
  meta: UnverifiedPlantsMeta;
}

/**
 * Get unverified plants (paginated)
 */
export async function getUnverifiedPlants(params: {
  location_id?: string;
  weeks_missing?: number;
  page?: number;
  limit?: number;
} = {}): Promise<UnverifiedPlantsResponse> {
  const queryParams: Record<string, string> = {};

  if (params.location_id) queryParams.location_id = params.location_id;
  if (params.weeks_missing) queryParams.weeks_missing = String(params.weeks_missing);
  if (params.page) queryParams.page = String(params.page);
  if (params.limit) queryParams.limit = String(params.limit);

  const response = await apiClient.get<{
    success: boolean;
    data: Record<string, unknown>[];
    meta: UnverifiedPlantsMeta;
  }>('/reports/unverified-plants', { params: queryParams });

  return {
    data: response.data.data.map((row) => ({
      plant_id: String(row.plant_id ?? ''),
      fleet_number: String(row.fleet_number ?? ''),
      description: row.description ? String(row.description) : null,
      current_location: String(row.current_location ?? ''),
      last_verified_date: row.last_verified_date ? String(row.last_verified_date) : null,
      weeks_since_verification: Number(row.weeks_since_verification ?? 0),
    })),
    meta: {
      ...response.data.meta,
      total: Number(response.data.meta.total ?? 0),
    },
  };
}

/** A downloaded export: the file itself, plus what the server called it. */
export interface ExportFile {
  blob: Blob;
  /** Row count, from `X-Total-Count` — the body no longer carries it. */
  count: number;
  /** Server-supplied name from `Content-Disposition`, else the fallback. */
  filename: string;
}

/**
 * Read `Content-Disposition`, falling back to a dated name.
 *
 * The header is only readable cross-origin because the endpoint sends
 * `Access-Control-Expose-Headers`; if a proxy strips it we still name
 * the file sensibly rather than saving "download".
 */
function exportFilename(headers: unknown, fallback: string): string {
  const raw = (headers as Record<string, string> | undefined)?.['content-disposition'];
  return raw?.match(/filename="?([^";]+)"?/)?.[1] ?? fallback;
}

function toExportFile(
  response: { data: Blob; headers: unknown },
  fallback: string
): ExportFile {
  const headers = response.headers as Record<string, string> | undefined;
  return {
    blob: response.data,
    count: Number(headers?.['x-total-count'] ?? 0),
    filename: exportFilename(response.headers, fallback),
  };
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Export plants data as a downloadable file.
 *
 * The endpoint streams the file directly instead of returning it inside
 * a JSON envelope, so this takes the bytes as a blob rather than parsing
 * 2MB of JSON only to re-serialize it into one. Exports get their own
 * long timeout — the global 10s is for queries, not file transfers.
 */
export async function exportPlants(params: {
  format?: 'json' | 'csv';
  /** Plant condition — the live column. `status` on plants is stale/legacy. */
  condition?: string;
  location_id?: string;
} = {}): Promise<ExportFile> {
  const queryParams: Record<string, string> = {};

  if (params.format) queryParams.format = params.format;
  if (params.condition) queryParams.condition = params.condition;
  if (params.location_id) queryParams.location_id = params.location_id;

  const response = await apiClient.get('/reports/export/plants', {
    params: queryParams,
    responseType: 'blob',
    timeout: EXPORT_TIMEOUT_MS,
  });

  return toExportFile(response, `plants_export_${today()}.${params.format ?? 'json'}`);
}

/**
 * Export maintenance data as a downloadable file.
 *
 * Streamed like {@link exportPlants} — see that function.
 */
export async function exportMaintenance(params: {
  format?: 'json' | 'csv';
  year?: number;
  plant_id?: string;
} = {}): Promise<ExportFile> {
  const queryParams: Record<string, string> = {};

  if (params.format) queryParams.format = params.format;
  if (params.year) queryParams.year = String(params.year);
  if (params.plant_id) queryParams.plant_id = params.plant_id;

  const response = await apiClient.get('/reports/export/maintenance', {
    params: queryParams,
    responseType: 'blob',
    timeout: EXPORT_TIMEOUT_MS,
  });

  return toExportFile(
    response,
    `maintenance_export_${today()}.${params.format ?? 'json'}`
  );
}
