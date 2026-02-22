/**
 * Upload hooks using React Query mutations and queries
 */

import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  previewWeeklyReport,
  confirmWeeklyReport,
  listWeeklySubmissions,
  getWeeklySubmission,
  generateUploadToken,
  listUploadTokens,
  type PreviewResponse,
  type ConfirmResponse,
  type ConfirmedPlant,
  type MissingPlantAction,
  type SubmissionsListParams,
  type GenerateTokenRequest,
} from '@/lib/api/uploads';

// Re-export types for convenience
export type {
  PreviewPlant,
  MissingPlant,
  PreviewResponse,
  ConfirmResponse,
  ConfirmedPlant,
  MissingPlantAction,
  WeeklySubmission,
  SubmissionMeta,
  SubmissionPlantRecord,
  SubmissionDetail,
  SubmissionDetailMeta,
  SubmissionsListParams,
  UploadToken,
  GenerateTokenRequest,
} from '@/lib/api/uploads';

// ============================================================================
// Query Keys
// ============================================================================

export const submissionsKeys = {
  all: ['submissions'] as const,
  list: (params?: SubmissionsListParams) => [...submissionsKeys.all, 'list', params] as const,
  detail: (id: string) => [...submissionsKeys.all, 'detail', id] as const,
};

export const tokensKeys = {
  all: ['upload-tokens'] as const,
  list: (activeOnly?: boolean) => [...tokensKeys.all, 'list', activeOnly] as const,
};

// ============================================================================
// Preview / Confirm Mutations
// ============================================================================

/**
 * Mutation for previewing a weekly report
 */
export function usePreviewWeeklyReport() {
  return useMutation<
    PreviewResponse,
    Error,
    { file: File; locationId: string; weekEndingDate: string }
  >({
    mutationFn: ({ file, locationId, weekEndingDate }) =>
      previewWeeklyReport(file, locationId, weekEndingDate),
  });
}

/**
 * Mutation for confirming a weekly report
 */
export function useConfirmWeeklyReport() {
  const queryClient = useQueryClient();
  return useMutation<
    ConfirmResponse,
    Error,
    {
      locationId: string;
      year: number;
      weekNumber: number;
      weekEndingDate: string;
      plants: ConfirmedPlant[];
      missingPlantActions?: MissingPlantAction[];
      file?: File;
    }
  >({
    mutationFn: ({ locationId, year, weekNumber, weekEndingDate, plants, missingPlantActions, file }) =>
      confirmWeeklyReport(locationId, year, weekNumber, weekEndingDate, plants, missingPlantActions, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: submissionsKeys.all });
    },
  });
}

// ============================================================================
// Submissions Hooks
// ============================================================================

/**
 * List weekly submissions with filters and pagination
 */
export function useWeeklySubmissions(params: SubmissionsListParams = {}) {
  return useQuery({
    queryKey: submissionsKeys.list(params),
    queryFn: () => listWeeklySubmissions(params),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Get a single weekly submission with plant records
 */
export function useWeeklySubmission(id: string | null) {
  return useQuery({
    queryKey: submissionsKeys.detail(id!),
    queryFn: () => getWeeklySubmission(id!),
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}

// ============================================================================
// Tokens Hooks
// ============================================================================

/**
 * List upload tokens
 */
export function useUploadTokens(activeOnly = true) {
  return useQuery({
    queryKey: tokensKeys.list(activeOnly),
    queryFn: () => listUploadTokens(activeOnly),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Generate a new upload token
 */
export function useGenerateToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: GenerateTokenRequest) => generateUploadToken(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tokensKeys.all });
    },
  });
}
