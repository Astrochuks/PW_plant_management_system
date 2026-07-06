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

export interface ProjectsListParams {
  page?: number;
  limit?: number;
  search?: string;
  client?: string;
  state_id?: string;
  status?: ProjectStatus;
  is_legacy?: boolean;
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
