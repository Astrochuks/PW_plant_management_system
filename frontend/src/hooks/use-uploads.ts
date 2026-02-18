/**
 * Upload hooks using React Query mutations
 */

import { useMutation } from '@tanstack/react-query';
import {
  previewWeeklyReport,
  confirmWeeklyReport,
  type PreviewResponse,
  type ConfirmResponse,
  type ConfirmedPlant,
  type MissingPlantAction,
} from '@/lib/api/uploads';

// Re-export types for convenience
export type {
  PreviewPlant,
  MissingPlant,
  PreviewResponse,
  ConfirmResponse,
  ConfirmedPlant,
  MissingPlantAction,
} from '@/lib/api/uploads';

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
    }
  >({
    mutationFn: ({ locationId, year, weekNumber, weekEndingDate, plants, missingPlantActions }) =>
      confirmWeeklyReport(locationId, year, weekNumber, weekEndingDate, plants, missingPlantActions),
  });
}
