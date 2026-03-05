/**
 * Uploads API functions
 * Handles weekly report preview, confirm, submissions, and tokens
 */

import apiClient from './client';

// ============================================================================
// Types
// ============================================================================

export interface PreviewPlant {
  fleet_number: string;
  description: string | null;
  remarks: string | null;
  hours_worked: number;
  standby_hours: number;
  breakdown_hours: number;
  off_hire: boolean;
  physical_verification: boolean;
  detected_condition: string;
  condition_confidence: 'high' | 'medium' | 'low';
  condition_reason: string;
  detected_transfer_from_id: string | null;
  detected_transfer_from_name: string | null;
  detected_transfer_to_id: string | null;
  detected_transfer_to_name: string | null;
  transfer_from_raw: string | null;
  transfer_to_raw: string | null;
  is_new: boolean;
  was_in_previous_week: boolean;
  previous_location_id: string | null;
  previous_location_name: string | null;
}

export interface MissingPlant {
  fleet_number: string;
  description: string | null;
  last_seen_week: number;
  last_seen_year: number;
  last_location_id: string;
  last_location_name: string;
  last_condition: string | null;
}

export interface PreviewResponse {
  success: boolean;
  preview_id: string;
  location: { id: string; name: string };
  week: { year: number; week_number: number; week_ending_date: string };
  available_locations: { id: string; name: string }[];
  condition_options: string[];
  plants: PreviewPlant[];
  missing_plants: MissingPlant[];
  summary: {
    total_in_file: number;
    missing_from_previous: number;
    new_this_week: number;
    high_confidence: number;
    medium_confidence: number;
    low_confidence: number;
    condition_breakdown: Record<string, number>;
  };
}

export interface ConfirmResponse {
  success: boolean;
  submission_id: string;
  message: string;
  plants_count: number;
}

export interface ConfirmedPlant {
  fleet_number: string;
  description: string | null;
  remarks: string | null;
  hours_worked: number;
  standby_hours: number;
  breakdown_hours: number;
  off_hire: boolean;
  physical_verification: boolean;
  condition: string;
  transfer_to_location_id?: string | null;
  transfer_from_location_id?: string | null;
}

export interface MissingPlantAction {
  fleet_number: string;
  action: 'keep' | 'transferred' | 'scrap' | 'missing';
  transfer_to_location_id?: string;
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Preview a weekly report before saving.
 * Uploads the Excel file and returns all plants with auto-detected conditions.
 */
export async function previewWeeklyReport(
  file: File,
  locationId: string,
  weekEndingDate: string
): Promise<PreviewResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('location_id', locationId);
  formData.append('week_ending_date', weekEndingDate);

  const response = await apiClient.post<PreviewResponse>(
    '/uploads/admin/preview-weekly-report',
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000, // 2 min — large files take time to parse
    }
  );
  return response.data;
}

/**
 * Confirm and save validated weekly report data.
 */
export async function confirmWeeklyReport(
  locationId: string,
  year: number,
  weekNumber: number,
  weekEndingDate: string,
  plants: ConfirmedPlant[],
  missingPlantActions?: MissingPlantAction[],
  file?: File
): Promise<ConfirmResponse> {
  const formData = new FormData();
  formData.append('location_id', locationId);
  formData.append('year', String(year));
  formData.append('week_number', String(weekNumber));
  formData.append('week_ending_date', weekEndingDate);
  formData.append('plants_json', JSON.stringify(plants));
  if (missingPlantActions && missingPlantActions.length > 0) {
    formData.append('missing_plants_json', JSON.stringify(missingPlantActions));
  }
  if (file) {
    formData.append('file', file);
  }

  const response = await apiClient.post<ConfirmResponse>(
    '/uploads/admin/confirm-weekly-report',
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    }
  );
  return response.data;
}

// ============================================================================
// Submissions Types
// ============================================================================

export interface WeeklySubmission {
  id: string;
  location_id: string;
  location_name: string;
  year: number;
  week_number: number;
  week_ending_date: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'partial';
  submitted_at: string;
  submitted_by_email: string | null;
  submitted_by_name: string | null;
  plants_processed: number | null;
  plants_created: number | null;
  plants_updated: number | null;
  source_file_name: string | null;
  file_size_formatted: string | null;
  processing_duration_seconds: number | null;
}

export interface SubmissionMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  counts: {
    by_status: Record<string, number>;
    total_plants_processed: number;
    [key: string]: unknown;
  };
}

export interface SubmissionPlantRecord {
  id: string;
  fleet_number: string;
  fleet_type: string | null;
  hours_worked: number;
  standby_hours: number;
  breakdown_hours: number;
  condition: string | null;
  remarks: string | null;
  plant_id: string | null;
}

export interface SubmissionDetail {
  submission: WeeklySubmission;
  plant_records: SubmissionPlantRecord[];
  file_url: string | null;
}

export interface SubmissionDetailMeta {
  total_records: number;
  file_size_formatted: string | null;
  file_type: string;
  file_extension: string;
  can_preview_in_browser: boolean;
  processing_duration: string | null;
  week_label: string;
}

export interface SubmissionsListParams {
  year?: number;
  week_number?: number;
  location_id?: string;
  status?: string;
  page?: number;
  limit?: number;
}

// ============================================================================
// Tokens Types
// ============================================================================

export interface UploadToken {
  id: string;
  name: string;
  token: string; // masked in list, full only on create
  location_id: string | null;
  location_name: string | null;
  upload_types: string[];
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

export interface GenerateTokenRequest {
  name: string;
  location_id?: string;
  upload_types?: string;
  expires_in_days?: number;
}

// ============================================================================
// Submissions API
// ============================================================================

/**
 * List weekly submissions with optional filters
 */
export async function listWeeklySubmissions(params: SubmissionsListParams = {}): Promise<{
  data: WeeklySubmission[];
  meta: SubmissionMeta;
}> {
  const queryParams: Record<string, string> = {};
  if (params.year) queryParams.year = String(params.year);
  if (params.week_number) queryParams.week_number = String(params.week_number);
  if (params.location_id) queryParams.location_id = params.location_id;
  if (params.status) queryParams.status = params.status;
  if (params.page) queryParams.page = String(params.page);
  if (params.limit) queryParams.limit = String(params.limit);

  const response = await apiClient.get<{
    success: boolean;
    data: WeeklySubmission[];
    meta: SubmissionMeta;
  }>('/uploads/submissions/weekly', { params: queryParams });
  return { data: response.data.data, meta: response.data.meta };
}

/**
 * Get a single weekly submission with plant records
 */
export async function getWeeklySubmission(id: string): Promise<{
  data: SubmissionDetail;
  meta: SubmissionDetailMeta;
}> {
  const response = await apiClient.get<{
    success: boolean;
    data: {
      submission: WeeklySubmission;
      plant_records: SubmissionPlantRecord[];
      file_url: string | null;
    };
    meta: SubmissionDetailMeta;
  }>(`/uploads/submissions/weekly/${id}`);
  return {
    data: response.data.data,
    meta: response.data.meta,
  };
}

/**
 * Download submission file via authenticated fetch.
 * For uploaded submissions: returns the original Excel file.
 * For form-submitted reports: generates and returns a styled Excel.
 */
export async function downloadSubmissionFile(id: string, fileName?: string): Promise<void> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  const baseURL = apiClient.defaults.baseURL;
  const url = `${baseURL}/uploads/submissions/weekly/${id}/file`;

  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error('Failed to download file');
  }

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  // Use the provided name for originals; for generated Excel the backend sets Content-Disposition
  link.download = fileName || 'weekly-report.xlsx';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(blobUrl);
}

/**
 * Delete a weekly report submission and its plant records (admin only).
 */
export async function deleteWeeklySubmission(id: string): Promise<void> {
  await apiClient.delete(`/uploads/submissions/weekly/${id}`);
}

// ============================================================================
// Tokens API
// ============================================================================

/**
 * Generate a new upload token (admin only)
 */
export async function generateUploadToken(data: GenerateTokenRequest): Promise<UploadToken> {
  const formData = new FormData();
  formData.append('name', data.name);
  if (data.location_id) formData.append('location_id', data.location_id);
  if (data.upload_types) formData.append('upload_types', data.upload_types);
  if (data.expires_in_days) formData.append('expires_in_days', String(data.expires_in_days));

  const response = await apiClient.post<{
    success: boolean;
    data: UploadToken;
  }>('/uploads/tokens/generate', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data.data;
}

/**
 * List upload tokens (admin only)
 */
export async function listUploadTokens(activeOnly = true): Promise<UploadToken[]> {
  const response = await apiClient.get<{
    success: boolean;
    data: UploadToken[];
  }>('/uploads/tokens', {
    params: { active_only: String(activeOnly) },
  });
  return response.data.data;
}
