/**
 * Uploads API functions
 * Handles weekly report preview and confirm flows
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
  missingPlantActions?: MissingPlantAction[]
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
