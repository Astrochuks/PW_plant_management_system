/**
 * Site Engineer hooks using React Query
 */

import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  getSiteStats,
  getSitePlants,
  getDraft,
  upsertDraftRow,
  removeDraftRow,
  submitDraft,
  getSiteSubmissions,
  exportSubmission,
  getSubmissionRecords,
  getIncomingTransfers,
  confirmTransfer,
  rejectTransfer,
  checkNewPlant,
  getSiteLocations,
  requestPlantTransfer,
  getPullRequests,
  type DraftRowUpsert,
} from '@/lib/api/site-report'

export type {
  SiteStats,
  SitePlant,
  Draft,
  DraftRow,
  DraftRowUpsert,
  SiteSubmission,
  SubmissionRecord,
  IncomingTransfer,
  PlantCheckResult,
  PullRequest,
} from '@/lib/api/site-report'

// ============================================================================
// Query Keys
// ============================================================================

export const siteKeys = {
  all: ['site'] as const,
  stats: () => [...siteKeys.all, 'stats'] as const,
  plants: (params?: object) => [...siteKeys.all, 'plants', params] as const,
  draft: (weekEnding: string) => [...siteKeys.all, 'draft', weekEnding] as const,
  submissions: (params?: object) => [...siteKeys.all, 'submissions', params] as const,
  incomingTransfers: () => [...siteKeys.all, 'incoming-transfers'] as const,
  pullRequests: () => [...siteKeys.all, 'pull-requests'] as const,
  locations: () => [...siteKeys.all, 'locations'] as const,
}

// ============================================================================
// Queries
// ============================================================================

export function useSiteStats() {
  return useQuery({
    queryKey: siteKeys.stats(),
    queryFn: getSiteStats,
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  })
}

export function useSitePlants(params: { page?: number; limit?: number; search?: string; condition?: string } = {}) {
  return useQuery({
    queryKey: siteKeys.plants(params),
    queryFn: () => getSitePlants(params),
    staleTime: 2 * 60 * 1000,
  })
}

export function useDraft(weekEndingDate: string) {
  return useQuery({
    queryKey: siteKeys.draft(weekEndingDate),
    queryFn: () => getDraft(weekEndingDate),
    staleTime: 30 * 1000, // 30s — auto-saves invalidate immediately; avoids refetch on every mount
    placeholderData: keepPreviousData, // show previous week's data while new week loads
    enabled: !!weekEndingDate,
  })
}

export function useSiteSubmissions(params: { page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: siteKeys.submissions(params),
    queryFn: () => getSiteSubmissions(params),
    staleTime: 5 * 60 * 1000,
  })
}

export function useIncomingTransfers() {
  return useQuery({
    queryKey: siteKeys.incomingTransfers(),
    queryFn: getIncomingTransfers,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
  })
}

export function usePullRequests() {
  return useQuery({
    queryKey: siteKeys.pullRequests(),
    queryFn: getPullRequests,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
  })
}

export function useIncomingTransferCount() {
  const { data: incoming = [] } = useIncomingTransfers()
  const { data: pullReqs = [] } = usePullRequests()
  return { data: incoming.length + pullReqs.length }
}

export function useSiteLocations() {
  return useQuery({
    queryKey: siteKeys.locations(),
    queryFn: getSiteLocations,
    staleTime: 10 * 60 * 1000,
  })
}

// ============================================================================
// Mutations
// ============================================================================

export function useUpsertDraftRow(weekEndingDate: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (row: DraftRowUpsert) => upsertDraftRow(weekEndingDate, row),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteKeys.draft(weekEndingDate) })
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Failed to save — check your connection'
      toast.error(`Save failed: ${msg}`)
    },
  })
}

export function useRemoveDraftRow(weekEndingDate: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (fleetNumber: string) => removeDraftRow(weekEndingDate, fleetNumber),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteKeys.draft(weekEndingDate) })
    },
  })
}

export function useSubmitDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (weekEndingDate: string) => submitDraft(weekEndingDate),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteKeys.all })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['locations'] })
    },
  })
}

export function useConfirmTransfer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (transferId: string) => confirmTransfer(transferId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteKeys.incomingTransfers() })
      queryClient.invalidateQueries({ queryKey: siteKeys.pullRequests() })
      queryClient.invalidateQueries({ queryKey: siteKeys.stats() })
    },
  })
}

export function useRejectTransfer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (transferId: string) => rejectTransfer(transferId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteKeys.incomingTransfers() })
      queryClient.invalidateQueries({ queryKey: siteKeys.pullRequests() })
    },
  })
}

export function useRequestPlantTransfer() {
  return useMutation({
    mutationFn: (fleetNumber: string) => requestPlantTransfer(fleetNumber),
  })
}

export function useExportSubmission() {
  return useMutation({
    mutationFn: (submissionId: string) => exportSubmission(submissionId),
  })
}

export function useSubmissionRecords(submissionId: string | null) {
  return useQuery({
    queryKey: [...siteKeys.submissions(), 'records', submissionId],
    queryFn: () => getSubmissionRecords(submissionId!),
    enabled: !!submissionId,
    staleTime: 10 * 60 * 1000,
  })
}

export function useCheckNewPlant() {
  return useMutation({
    mutationFn: (fleetNumber: string) => checkNewPlant(fleetNumber),
  })
}
