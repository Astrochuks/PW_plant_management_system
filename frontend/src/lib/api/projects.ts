/**
 * Projects API functions
 * Handles all project-related API calls
 */

import apiClient from './client';

// ============================================================================
// Types
// ============================================================================

export type ProjectStatus = 'active' | 'completed' | 'on_hold' | 'cancelled' | 'retention_period' | 'legacy';

export interface Project {
  id: string;
  project_name: string;
  short_name: string | null;
  client: string;
  state_id: string | null;
  state_name: string | null;
  state_code: string | null;

  original_contract_sum: number | null;
  variation_sum: number | null;
  current_contract_sum: number | null;
  contract_sum_raw: string | null;

  has_award_letter: boolean;
  award_date: string | null;
  award_date_raw: string | null;
  commencement_date: string | null;
  commencement_date_raw: string | null;

  original_duration_months: number | null;
  original_completion_date: string | null;
  extension_of_time_months: number | null;
  revised_completion_date: string | null;

  substantial_completion_cert: string | null;
  substantial_completion_date: string | null;
  substantial_completion_date_raw: string | null;
  final_completion_cert: string | null;
  final_completion_date: string | null;
  final_completion_date_raw: string | null;
  maintenance_cert: string | null;
  maintenance_cert_date: string | null;
  maintenance_cert_date_raw: string | null;

  retention_application_date: string | null;
  retention_application_date_raw: string | null;
  retention_paid: string | null;
  retention_amount_paid: number | null;

  works_vetted_certified: number | null;
  payment_received: number | null;
  outstanding_payment: number | null;
  cost_to_date: number | null;
  revenue_to_date: number | null;

  status: ProjectStatus;
  project_type: ProjectType | null;
  work_nature: WorkNature | null;
  register_source: RegisterSource | null;
  completeness: number | null;
  is_legacy: boolean;
  notes: string | null;
  source_sheet: string | null;
  source_row: number | null;
  import_batch_id: string | null;

  linked_location_id: string | null;
  linked_location_name: string | null;

  created_at: string;
  updated_at: string;
}

export type ProjectType =
  | 'road' | 'bridge' | 'drainage' | 'building'
  | 'airport' | 'water' | 'infrastructure' | 'other';
export type WorkNature =
  | 'construction' | 'dualization' | 'rehabilitation'
  | 'maintenance' | 'emergency_repair' | 'completion';
export type RegisterSource = 'award_letters_workbook' | 'manual' | 'weekly_report_inferred';

export interface ProjectsListParams {
  page?: number;
  limit?: number;
  search?: string;
  client?: string;
  state_id?: string;
  status?: ProjectStatus;
  is_legacy?: boolean;
  project_type?: ProjectType;
  work_nature?: WorkNature;
  register_source?: RegisterSource;
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

export interface ProjectStats {
  totals: {
    total: number;
    active: number;
    completed: number;
    on_hold: number;
    retention_period: number;
    cancelled: number;
    legacy: number;
    non_legacy: number;
    total_contract_value: number;
    total_clients: number;
  };
  top_clients: Array<{
    client: string;
    project_count: number;
    total_value: number;
  }>;
}

export interface CreateProjectRequest {
  project_name: string;
  client: string;
  short_name?: string;
  state_id?: string;
  original_contract_sum?: number;
  variation_sum?: number;
  current_contract_sum?: number;
  contract_sum_raw?: string;
  has_award_letter?: boolean;
  award_date?: string;
  commencement_date?: string;
  original_duration_months?: number;
  original_completion_date?: string;
  extension_of_time_months?: number;
  revised_completion_date?: string;
  substantial_completion_cert?: string;
  substantial_completion_date?: string;
  final_completion_cert?: string;
  final_completion_date?: string;
  maintenance_cert?: string;
  maintenance_cert_date?: string;
  retention_application_date?: string;
  retention_paid?: string;
  retention_amount_paid?: number;
  works_vetted_certified?: number;
  payment_received?: number;
  outstanding_payment?: number;
  cost_to_date?: number;
  revenue_to_date?: number;
  status?: ProjectStatus;
  project_type?: ProjectType;
  work_nature?: WorkNature;
  notes?: string;
}

export interface ImportResult {
  import_batch_id: string;
  sheets_processed: number;
  total_parsed: number;
  created: number;
  deleted: number;
  errors: Array<{ project_name?: string; sheet?: string; error: string }>;
  warnings: Array<{ sheet: string; message: string; project?: string; row?: number }>;
  parse_errors: Array<{ sheet: string; row?: number; error: string }>;
}

// ============================================================================
// API Functions
// ============================================================================

export async function getProjects(params: ProjectsListParams = {}): Promise<{
  data: Project[];
  meta: PaginationMeta;
}> {
  const queryParams: Record<string, string> = {};
  if (params.page) queryParams.page = String(params.page);
  if (params.limit) queryParams.limit = String(params.limit);
  if (params.search) queryParams.search = params.search;
  if (params.client) queryParams.client = params.client;
  if (params.state_id) queryParams.state_id = params.state_id;
  if (params.status) queryParams.status = params.status;
  if (params.is_legacy !== undefined) queryParams.is_legacy = String(params.is_legacy);
  if (params.project_type) queryParams.project_type = params.project_type;
  if (params.work_nature) queryParams.work_nature = params.work_nature;
  if (params.register_source) queryParams.register_source = params.register_source;
  if (params.sort_by) queryParams.sort_by = params.sort_by;
  if (params.sort_order) queryParams.sort_order = params.sort_order;

  const response = await apiClient.get('/projects', { params: queryParams });
  return { data: response.data.data, meta: response.data.meta };
}

export async function getProject(id: string): Promise<Project> {
  const response = await apiClient.get(`/projects/${id}`);
  return response.data.data;
}

export async function getProjectStats(isLegacy?: boolean): Promise<ProjectStats> {
  const params: Record<string, string> = {};
  if (isLegacy !== undefined) params.is_legacy = String(isLegacy);
  const response = await apiClient.get('/projects/stats', { params });
  return response.data.data;
}

export async function getProjectClients(): Promise<string[]> {
  const response = await apiClient.get('/projects/clients');
  return response.data.data;
}

export async function createProject(data: CreateProjectRequest): Promise<Project> {
  const response = await apiClient.post('/projects', data);
  return response.data.data;
}

export async function updateProject(id: string, data: Partial<CreateProjectRequest>): Promise<Project> {
  const response = await apiClient.patch(`/projects/${id}`, data);
  return response.data.data;
}

export async function deleteProject(id: string): Promise<void> {
  await apiClient.delete(`/projects/${id}`);
}

export async function importAwardLetters(file: File): Promise<ImportResult> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await apiClient.post('/projects/import/award-letters', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 180000,
  });
  return response.data.data;
}

// ============================================================================
// Milestones
// ============================================================================

export interface Milestone {
  key: string;
  label: string;
  date: string | null;
  status: 'completed' | 'upcoming' | 'not_set';
}

export interface ProjectMilestonesData {
  milestones: Milestone[];
  duration: {
    original_months: number | null;
    extension_months: number | null;
    total_months: number | null;
  };
}

export async function getProjectMilestones(id: string): Promise<ProjectMilestonesData> {
  const response = await apiClient.get(`/projects/${id}/milestones`);
  return response.data.data;
}

// ============================================================================
// Linkable Projects (for location linking)
// ============================================================================

export interface LinkableProject {
  id: string;
  project_name: string;
  client: string;
  status: string;
}

export async function getLinkableProjects(): Promise<LinkableProject[]> {
  const response = await apiClient.get('/projects/linkable');
  return response.data.data;
}

// ============================================================================
// Register Review Queue (T1.10/T1.11 — admin)
// ============================================================================

export interface ReviewQueueItem {
  id: string;
  import_batch_id: string | null;
  sheet_name: string | null;
  row_number: number | null;
  project_id: string | null;
  project_name: string | null;
  field: string;
  raw_value: string | null;
  reason: string;
  suggested_value: string | null;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_value: string | null;
  created_at: string;
}

export interface ReviewQueuePage {
  items: ReviewQueueItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface ReviewQueueSummary {
  open_total: number;
  by_sheet: { sheet_name: string | null; n: number }[];
  by_reason: { reason: string; n: number }[];
  by_field: { field: string; n: number }[];
}

export interface ReviewQueueParams {
  sheet?: string;
  reason?: string;
  field?: string;
  resolved?: boolean | null;
  page?: number;
  page_size?: number;
}

export async function getReviewQueue(params: ReviewQueueParams = {}): Promise<ReviewQueuePage> {
  const response = await apiClient.get('/projects/review-queue', { params });
  const data = response.data.data;
  return {
    ...data,
    total: Number(data.total ?? 0),
    items: (data.items ?? []).map((i: ReviewQueueItem) => ({
      ...i,
      row_number: i.row_number == null ? null : Number(i.row_number),
    })),
  };
}

export async function getReviewQueueSummary(): Promise<ReviewQueueSummary> {
  const response = await apiClient.get('/projects/review-queue/summary');
  const data = response.data.data;
  return {
    open_total: Number(data.open_total ?? 0),
    by_sheet: (data.by_sheet ?? []).map((r: { sheet_name: string | null; n: number }) => ({
      sheet_name: r.sheet_name,
      n: Number(r.n ?? 0),
    })),
    by_reason: (data.by_reason ?? []).map((r: { reason: string; n: number }) => ({
      reason: r.reason,
      n: Number(r.n ?? 0),
    })),
    by_field: (data.by_field ?? []).map((f: { field: string; n: number }) => ({
      field: f.field,
      n: Number(f.n ?? 0),
    })),
  };
}

export async function resolveReviewItem(
  id: string,
  value: string | null,
): Promise<{ id: string; applied: Record<string, string>; dismissed: boolean }> {
  const response = await apiClient.post(`/projects/review-queue/${id}/resolve`, { value });
  return response.data.data;
}

export async function bulkDismissReviewItems(
  reason: string,
  field?: string,
): Promise<{ dismissed: number }> {
  const response = await apiClient.post('/projects/review-queue/bulk-dismiss', {
    reason,
    ...(field ? { field } : {}),
  });
  return { dismissed: Number(response.data.data.dismissed ?? 0) };
}


// ============================================================================
// Register Benchmarks (T1.13)
// ============================================================================

export interface TypeBenchmark {
  project_type: ProjectType;
  n_projects: number;
  n_valued: number;
  total_value: number | null;
  value_p25: number | null;
  value_median: number | null;
  value_p75: number | null;
  n_delivered: number | null;
  delivery_p25_months: number | null;
  delivery_median_months: number | null;
  delivery_p75_months: number | null;
}

export async function getProjectBenchmarks(): Promise<TypeBenchmark[]> {
  const response = await apiClient.get('/projects/benchmarks');
  return (response.data.data ?? []).map((b: TypeBenchmark) => ({
    ...b,
    n_projects: Number(b.n_projects ?? 0),
    n_valued: Number(b.n_valued ?? 0),
    total_value: b.total_value == null ? null : Number(b.total_value),
    value_median: b.value_median == null ? null : Number(b.value_median),
    value_p25: b.value_p25 == null ? null : Number(b.value_p25),
    value_p75: b.value_p75 == null ? null : Number(b.value_p75),
    n_delivered: b.n_delivered == null ? null : Number(b.n_delivered),
    delivery_median_months: b.delivery_median_months == null ? null : Number(b.delivery_median_months),
    delivery_p25_months: b.delivery_p25_months == null ? null : Number(b.delivery_p25_months),
    delivery_p75_months: b.delivery_p75_months == null ? null : Number(b.delivery_p75_months),
  }));
}

// ============================================================================
// Weekly Report Submissions (Phase 2)
// ============================================================================

export type SubmissionStatus = 'queued' | 'parsing' | 'success' | 'partial' | 'failed' | 'deleted';

export interface ProjectSubmission {
  id: string;
  project_id: string;
  short_name: string | null;
  project_name: string;
  year: number;
  week_number: number;
  week_ending_date: string | null;
  file_name: string | null;
  source: 'excel' | 'manual';
  status: SubmissionStatus;
  error_message: string | null;
  sheets_processed: Record<string, string> | null;
  row_counts: Record<string, unknown> | null;
  parse_duration_ms: number | null;
  retry_count: number;
  uploaded_at: string;
}

export async function uploadWeeklyReport(
  file: File, projectId: string, year: number, weekNumber: number,
): Promise<{ submission_id: string; status: string }> {
  const form = new FormData();
  form.append('file', file);
  form.append('project_id', projectId);
  form.append('year', String(year));
  form.append('week_number', String(weekNumber));
  const response = await apiClient.post('/projects/upload-weekly-report', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
  return response.data.data;
}

export async function getProjectSubmissions(params: {
  status?: SubmissionStatus; project_id?: string; page?: number; limit?: number;
} = {}): Promise<{ data: ProjectSubmission[]; total: number }> {
  const response = await apiClient.get('/projects/submissions', { params });
  return { data: response.data.data, total: Number(response.data.meta?.total ?? 0) };
}

export async function getProjectSubmission(id: string): Promise<ProjectSubmission> {
  const response = await apiClient.get(`/projects/submissions/${id}`);
  return response.data.data;
}

export async function retryProjectSubmission(id: string): Promise<void> {
  await apiClient.post(`/projects/submissions/${id}/retry`);
}

export async function deleteProjectSubmission(
  id: string,
): Promise<{ deleted_week_data: boolean; year: number; week_number: number }> {
  const response = await apiClient.delete(`/projects/submissions/${id}`);
  return response.data.data;
}

export async function reResolveFleetNumbers(): Promise<{ rows_backfilled: number }> {
  const response = await apiClient.post('/projects/unmapped-fleet-numbers/re-resolve');
  return response.data.data;
}

export interface UnmappedFleetNumber {
  fleet_number_raw: string;
  occurrences: number;
  projects: number;
  first_week: number;
  last_week: number;
  description: string | null;
}

export async function getUnmappedFleetNumbers(): Promise<UnmappedFleetNumber[]> {
  const response = await apiClient.get('/projects/unmapped-fleet-numbers');
  return (response.data.data ?? []).map((r: UnmappedFleetNumber) => ({
    ...r,
    occurrences: Number(r.occurrences ?? 0),
  }));
}

export async function linkUnmappedFleetNumber(
  fleetNumberRaw: string, plantId: string,
): Promise<{ linked_to: string; rows_backfilled: number }> {
  const response = await apiClient.post('/projects/unmapped-fleet-numbers/link', {
    fleet_number_raw: fleetNumberRaw, plant_id: plantId,
  });
  return response.data.data;
}

// ── Operations (weekly-report derived) ──────────────────────────────────────

export interface ProjectOperationsRow {
  id: string;
  short_name: string | null;
  project_name: string;
  status: ProjectStatus;
  location_name: string | null;
  weeks_received: number;
  first_week: number;
  last_week: number;
  latest_year: number;
  last_week_ending: string | null;
  days_since_last_report: number | null;
  hours_worked: number;
  breakdown_hours: number;
  standby_hours: number;
  plant_cost_ngn: number;
  fleet_count: number;
  diesel_litres: number;
  payments_net_ngn: number;
  payments_count: number;
  current_contract_amount: number | null;
  works_certified: number | null;
  beme_pct_complete: number | null;
}

const OPS_NUMERIC_KEYS = [
  'weeks_received', 'first_week', 'last_week', 'latest_year',
  'hours_worked', 'breakdown_hours', 'standby_hours', 'plant_cost_ngn',
  'fleet_count', 'diesel_litres', 'payments_net_ngn', 'payments_count',
] as const;

function normalizeOpsRow<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  for (const k of OPS_NUMERIC_KEYS) {
    if (k in out) out[k] = Number(out[k] ?? 0);
  }
  for (const k of ['current_contract_amount', 'works_certified',
                   'beme_pct_complete', 'days_since_last_report']) {
    if (k in out && out[k] != null) out[k] = Number(out[k]);
  }
  return out as T;
}

export async function getProjectOperations(): Promise<ProjectOperationsRow[]> {
  const response = await apiClient.get('/projects/operations');
  return (response.data.data ?? []).map(normalizeOpsRow);
}

export interface ProjectOperationsSummary {
  project: {
    id: string; short_name: string | null; project_name: string;
    status: ProjectStatus; current_contract_sum: number | null;
    location_name: string | null;
  };
  totals: {
    weeks_received: number;
    last_week_ending: string | null;
    hours_worked: number;
    breakdown_hours: number;
    standby_hours: number;
    plant_cost_ngn: number;
    fleet_count: number;
    diesel_litres: number;
    payments_net_ngn: number;
    payments_count: number;
    certificates_count: number;
    certificates_net_ngn: number;
  };
  latest_snapshot: {
    year: number; week_number: number;
    original_contract_amount: number | null;
    current_contract_amount: number | null;
    works_certified: number | null;
    retention_held: number | null;
    advance_unrecovered: number | null;
  } | null;
  latest_pct: { year: number; week_number: number; beme_pct_complete: number } | null;
}

export async function getProjectOperationsSummary(
  projectId: string,
): Promise<ProjectOperationsSummary> {
  const response = await apiClient.get(`/projects/${projectId}/operations/summary`);
  const d = response.data.data;
  const numOrNull = (v: unknown) => (v == null ? null : Number(v));
  return {
    project: {
      ...d.project,
      current_contract_sum: numOrNull(d.project?.current_contract_sum),
    },
    totals: Object.fromEntries(
      Object.entries(d.totals ?? {}).map(([k, v]) =>
        [k, k === 'last_week_ending' ? v : Number(v ?? 0)],
      ),
    ) as ProjectOperationsSummary['totals'],
    latest_snapshot: d.latest_snapshot
      ? {
          ...d.latest_snapshot,
          original_contract_amount: numOrNull(d.latest_snapshot.original_contract_amount),
          current_contract_amount: numOrNull(d.latest_snapshot.current_contract_amount),
          works_certified: numOrNull(d.latest_snapshot.works_certified),
          retention_held: numOrNull(d.latest_snapshot.retention_held),
          advance_unrecovered: numOrNull(d.latest_snapshot.advance_unrecovered),
        }
      : null,
    latest_pct: d.latest_pct
      ? { ...d.latest_pct, beme_pct_complete: Number(d.latest_pct.beme_pct_complete) }
      : null,
  };
}

export interface ProjectOperationsWeekRow {
  year: number;
  week_number: number;
  week_ending_date: string;
  beme_pct_complete: number | null;
  hours_worked: number;
  breakdown_hours: number;
  standby_hours: number;
  plant_cost_ngn: number;
  plants_on_site: number;
  diesel_litres: number;
  labour_total: number;
  works_certified: number | null;
}

export interface ProjectOperationsMonthRow {
  month: string;
  weeks_in_month: number;
  beme_pct_complete: number | null;
  hours_worked: number;
  breakdown_hours: number;
  standby_hours: number;
  plant_cost_ngn: number;
  diesel_litres: number;
  works_certified: number | null;
}

export async function getProjectOperationsSeries(
  projectId: string, granularity: 'week' | 'month',
): Promise<(ProjectOperationsWeekRow | ProjectOperationsMonthRow)[]> {
  const response = await apiClient.get(
    `/projects/${projectId}/operations/series`, { params: { granularity } },
  );
  return (response.data.data ?? []).map((row: Record<string, unknown>) => {
    const out: Record<string, unknown> = { ...row };
    for (const [k, v] of Object.entries(out)) {
      if (k === 'week_ending_date' || k === 'month') continue;
      if (v != null) out[k] = Number(v);
    }
    return out;
  });
}

// ── Financials + per-plant rollups ──────────────────────────────────────────

export interface WeekFlag {
  sheet: string;
  type: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export interface FinancialWeek {
  year: number;
  week_number: number;
  week_ending_date: string;
  works_value: number;
  vat: number;
  earnings: number;
  cost_total: number;
  cost_by_category: Record<string, number>;
  diesel_cost: number;
  diesel_rate: number | null;
  diesel_litres: number;          // charged (Cost Report AGO — money truth)
  diesel_logged_litres: number;   // attribution log (may be stale copy)
  net: number;
  cumulative_net: number;
  sheet_net: number | null;
  flags: WeekFlag[];
}

export interface ProjectFinancials {
  weeks: FinancialWeek[];
  totals: {
    earnings: number;
    cost_total: number;
    net: number;
    diesel_cost: number;
    diesel_litres: number;
    weeks_gaining: number;
    weeks_losing: number;
    cost_by_category: Record<string, number>;
  };
  bills: { item: string; this_week: number | null; pct_complete: number | null }[];
  cross_check_warnings: string[];
}

export async function getProjectFinancials(projectId: string): Promise<ProjectFinancials> {
  const response = await apiClient.get(`/projects/${projectId}/operations/financials`);
  const d = response.data.data;
  const numRec = (o: Record<string, unknown> | null | undefined) =>
    Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, Number(v ?? 0)]));
  return {
    weeks: (d.weeks ?? []).map((w: Record<string, unknown>) => ({
      ...w,
      works_value: Number(w.works_value ?? 0),
      vat: Number(w.vat ?? 0),
      earnings: Number(w.earnings ?? 0),
      cost_total: Number(w.cost_total ?? 0),
      cost_by_category: numRec(w.cost_by_category as Record<string, unknown>),
      diesel_cost: Number(w.diesel_cost ?? 0),
      diesel_rate: w.diesel_rate == null ? null : Number(w.diesel_rate),
      diesel_litres: Number(w.diesel_litres ?? 0),
      diesel_logged_litres: Number(w.diesel_logged_litres ?? 0),
      net: Number(w.net ?? 0),
      cumulative_net: Number(w.cumulative_net ?? 0),
      sheet_net: w.sheet_net == null ? null : Number(w.sheet_net),
      flags: (w.flags ?? []) as WeekFlag[],
    })),
    totals: {
      ...d.totals,
      earnings: Number(d.totals?.earnings ?? 0),
      cost_total: Number(d.totals?.cost_total ?? 0),
      net: Number(d.totals?.net ?? 0),
      diesel_cost: Number(d.totals?.diesel_cost ?? 0),
      diesel_litres: Number(d.totals?.diesel_litres ?? 0),
      weeks_gaining: Number(d.totals?.weeks_gaining ?? 0),
      weeks_losing: Number(d.totals?.weeks_losing ?? 0),
      cost_by_category: numRec(d.totals?.cost_by_category),
    },
    bills: (d.bills ?? []).map((b: Record<string, unknown>) => ({
      item: b.item,
      this_week: b.this_week == null ? null : Number(b.this_week),
      pct_complete: b.pct_complete == null ? null : Number(b.pct_complete),
    })),
    cross_check_warnings: d.cross_check_warnings ?? [],
  };
}

export interface ProjectPlantRollup {
  fleet_number_raw: string;
  plant_id: string | null;
  fleet_number: string | null;
  description: string | null;
  plant_category: string | null;
  condition: string | null;
  weeks_seen: number;
  hours_worked: number;
  breakdown_hours: number;
  standby_hours: number;
  plant_cost_ngn: number;
  diesel_litres: number;
}

export async function getProjectPlantRollups(projectId: string): Promise<ProjectPlantRollup[]> {
  const response = await apiClient.get(`/projects/${projectId}/operations/plants`);
  return (response.data.data ?? []).map((r: Record<string, unknown>) => ({
    ...r,
    weeks_seen: Number(r.weeks_seen ?? 0),
    hours_worked: Number(r.hours_worked ?? 0),
    breakdown_hours: Number(r.breakdown_hours ?? 0),
    standby_hours: Number(r.standby_hours ?? 0),
    plant_cost_ngn: Number(r.plant_cost_ngn ?? 0),
    diesel_litres: Number(r.diesel_litres ?? 0),
  }));
}

// ── Upload preview (parse in memory, nothing stored) ────────────────────────

export interface SheetPreview {
  kind: 'parsed' | 'stored_only';
  status: string;
  warnings: string[];
  rows?: Record<string, unknown>[];
  total_rows?: number;
  grid?: string[][];
  bills?: { bill_no: number; name: string; sheet_total_contract: number | null; sheet_total_this_week: number | null }[];
  tail?: Record<string, { contract: number | null; this_week: number | null }>;
  cross_checks?: { check: string; ours: number; sheet: number; delta: number }[];
  footer?: { total_all?: number; pct_allocated?: number; adjustments?: { label: string; amount: number }[] };
  stock?: Record<string, number | null>;
  sheet_totals?: Record<string, number | null>;
  sheet_total?: Record<string, number | null>;
  snapshot?: Record<string, unknown>;
  calendar_weeks?: number;
}

export interface ReportPreview {
  identity: Record<string, unknown> | null;
  identity_warning: string | null;
  drift: { clean: boolean; missing: string[]; drifted: string[] };
  sheets: Record<string, SheetPreview>;
}

export async function previewWeeklyReport(
  file: File,
  projectId?: string,
): Promise<ReportPreview> {
  const formData = new FormData();
  formData.append('file', file);
  if (projectId) formData.append('project_id', projectId);
  const response = await apiClient.post('/projects/preview-weekly-report', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
  return response.data.data;
}

export async function getSubmissionDownloadUrl(
  submissionId: string,
): Promise<{ url: string; file_name: string | null }> {
  const response = await apiClient.get(`/projects/submissions/${submissionId}/download`);
  return response.data.data;
}

// ── Project hub: Overview (living contract summary) ────────────────────

export interface ProjectOverview {
  project: {
    id: string;
    project_name: string;
    short_name: string | null;
    client: string;
    state_name: string | null;
    status: ProjectStatus;
    project_type: ProjectType | null;
    work_nature: WorkNature | null;
    current_contract_sum: number | null;
    original_contract_sum: number | null;
    award_date: string | null;
    commencement_date: string | null;
    revised_completion_date: string | null;
  };
  latest_week: {
    year: number;
    week_number: number;
    week_ending_date: string;
    works_this_week: number;
    cost_this_week: number;
  } | null;
  ladder: {
    contract_sum: number;
    beme_scope: number;
    works_to_date: number;
    earnings_to_date: number;
    certified_ex_vat: number;
    certified_incl_vat: number;
    paid_gross: number;
    paid_net: number;
    wip_incl_vat: number;
    certified_not_paid: number;
  };
  net_earnings: {
    value: number;
    pct: number | null;
    earnings: number;
    costs_to_date: number;
  };
  progress: {
    physical_pct: number | null;
    commercial_pct: number | null;
    reported_pct: number | null;
  };
  payment_status: {
    count: number;
    advances: number;
    certs_paid: number;
    on_account: number;
    total_gross: number;
    total_net: number;
  };
  certificates: {
    count: number;
    cumulative_gross: number;
    retention_held: number;
    retention_released: number;
    advance_recovery: number;
  };
  alerts: {
    scope_exceeds_contract: boolean;
    missing_weeks: Array<[number, number]>;
    flags_latest_week: number;
    flags_serious: number;
    flags_total: number;
    unresolved_fleet: number;
  };
  recent_weeks: Array<{
    year: number;
    week_number: number;
    week_ending_date: string;
    flags: number;
    works_this_week: number;
    cost_this_week: number;
    submission_id: string | null;
  }>;
}

export async function getProjectOverview(projectId: string): Promise<ProjectOverview> {
  const response = await apiClient.get(`/projects/${projectId}/overview`);
  return response.data.data;
}

// ── Project hub: Work done / Costs / Site / Financial ledgers ───────────

export interface WorkDoneItem {
  item_code: string | null;
  description: string | null;
  unit: string | null;
  contract_qty: number | null;
  rate: number | null;
  contract_amount: number | null;
  qty_done: number | null;
  amount_done: number | null;
  pct_complete: number | null;
  is_overrun: boolean | null;
  no_contract_qty: boolean | null;
  latest_qty: number | null;
  latest_amount: number | null;
}

export interface WorkDoneBill {
  bill_code: string | null;
  bill_name: string | null;
  contract_amount: number;
  amount_done: number;
  latest_amount: number;
  pct_complete: number | null;
  items: WorkDoneItem[];
}

export async function getProjectWorkDone(projectId: string): Promise<{ bills: WorkDoneBill[] }> {
  const response = await apiClient.get(`/projects/${projectId}/work-done`);
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    bills: (response.data.data.bills ?? []).map((b: Record<string, unknown>) => ({
      ...b,
      contract_amount: Number(b.contract_amount ?? 0),
      amount_done: Number(b.amount_done ?? 0),
      latest_amount: Number(b.latest_amount ?? 0),
      pct_complete: n(b.pct_complete),
      items: (b.items as Record<string, unknown>[]).map((i) => ({
        ...i,
        contract_qty: n(i.contract_qty), rate: n(i.rate),
        contract_amount: n(i.contract_amount), qty_done: n(i.qty_done),
        amount_done: n(i.amount_done), pct_complete: n(i.pct_complete),
        latest_qty: n(i.latest_qty), latest_amount: n(i.latest_amount),
      })),
    })),
  };
}

export interface CostCategoryRow {
  cost_category: string;
  to_date: number;
  this_week: number;
  stored_weeks: number;
}

export async function getProjectCostsSummary(projectId: string): Promise<{
  categories: CostCategoryRow[];
  total_to_date: number;
}> {
  const response = await apiClient.get(`/projects/${projectId}/costs/summary`);
  const d = response.data.data;
  return {
    categories: (d.categories ?? []).map((c: Record<string, unknown>) => ({
      cost_category: c.cost_category,
      to_date: Number(c.to_date ?? 0),
      this_week: Number(c.this_week ?? 0),
      stored_weeks: Number(c.stored_weeks ?? 0),
    })),
    total_to_date: Number(d.total_to_date ?? 0),
  };
}

export interface ProjectSite {
  labour: Array<{
    block: string; dept_slot: number | null; department: string | null;
    manning_this_week: number | null; manning_previous_week: number | null;
    movement: number | null; comment: string | null;
  }>;
  labour_trend: Array<{ year: number; week_number: number; week_ending_date: string; total: number }>;
  subcontractors: Array<Record<string, unknown>>;
  materials: Array<Record<string, unknown>>;
  hired_vehicles: Array<Record<string, unknown>>;
  hired_to_date_stored: number;
}

export async function getProjectSite(projectId: string): Promise<ProjectSite | null> {
  const response = await apiClient.get(`/projects/${projectId}/site`);
  return response.data.data;
}

export interface CertificateRow extends Record<string, unknown> {
  cert_number: string;
  date_submitted: string | null;
  gross_value_works_done: number | null;
}

export async function getProjectLedgers(projectId: string): Promise<{
  certificates: CertificateRow[];
  payments: Array<Record<string, unknown>>;
}> {
  const response = await apiClient.get(`/projects/${projectId}/financials/ledgers`);
  return response.data.data;
}

export async function markFleetNumberExternal(raw: string, label?: string): Promise<void> {
  await apiClient.post('/projects/unmapped-fleet-numbers/mark-external', {
    fleet_number_raw: raw, label,
  });
}
