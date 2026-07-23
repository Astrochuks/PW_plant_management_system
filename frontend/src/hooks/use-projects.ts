/**
 * Projects data hooks using React Query
 */

import { useCallback, useEffect } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import {
  getProjects,
  getProject,
  getProjectOverview,
  getProjectIssues,
  getProjectWorkDone,
  getProjectCostsSummary,
  getProjectSite,
  getProjectLedgers,
  getProjectStats,
  getProjectClients,
  getProjectMilestones,
  getLinkableProjects,
  createProject,
  updateProject,
  deleteProject,
  importAwardLetters,
  type ProjectsListParams,
  type Project,
  type PaginationMeta,
  type ProjectStats,
  type CreateProjectRequest,
  type ImportResult,
  type Milestone,
  type ProjectMilestonesData,
  type LinkableProject,
} from '@/lib/api/projects';

export type { Project, ProjectStats, PaginationMeta, ProjectsListParams, ImportResult, Milestone, ProjectMilestonesData, LinkableProject };

// ============================================================================
// Query Keys
// ============================================================================

export const projectsKeys = {
  all: ['projects'] as const,
  lists: () => [...projectsKeys.all, 'list'] as const,
  list: (params: ProjectsListParams) => [...projectsKeys.lists(), params] as const,
  stats: () => [...projectsKeys.all, 'stats'] as const,
  clients: () => [...projectsKeys.all, 'clients'] as const,
  linkable: () => [...projectsKeys.all, 'linkable'] as const,
  details: () => [...projectsKeys.all, 'detail'] as const,
  detail: (id: string) => [...projectsKeys.details(), id] as const,
  milestones: (id: string) => [...projectsKeys.detail(id), 'milestones'] as const,
};

// ============================================================================
// Query Hooks
// ============================================================================

export function useProjects(params: ProjectsListParams = {}) {
  return useQuery({
    queryKey: projectsKeys.list(params),
    queryFn: () => getProjects(params),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

export function useProjectOverview(id: string | null) {
  return useQuery({
    queryKey: [...projectsKeys.detail(id!), 'overview'],
    queryFn: () => getProjectOverview(id!),
    enabled: !!id,
    staleTime: 2 * 60 * 1000,
  });
}

export function useProjectIssues(id: string | null, enabled = true) {
  return useQuery({
    queryKey: [...projectsKeys.detail(id!), 'issues'],
    queryFn: () => getProjectIssues(id!),
    enabled: !!id && enabled,
    staleTime: 60 * 1000,
  });
}

export function useProjectWorkDone(id: string | null, year?: number, week?: number) {
  return useQuery({
    queryKey: [...projectsKeys.detail(id!), 'work-done', year ?? 'latest', week ?? 'latest'],
    queryFn: () => getProjectWorkDone(id!, year, week),
    enabled: !!id, staleTime: 2 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

export function useProjectCostsSummary(id: string | null) {
  return useQuery({
    queryKey: [...projectsKeys.detail(id!), 'costs-summary'],
    queryFn: () => getProjectCostsSummary(id!),
    enabled: !!id, staleTime: 2 * 60 * 1000,
  });
}

export function useProjectSite(id: string | null) {
  return useQuery({
    queryKey: [...projectsKeys.detail(id!), 'site'],
    queryFn: () => getProjectSite(id!),
    enabled: !!id, staleTime: 2 * 60 * 1000,
  });
}

export function useProjectLedgers(id: string | null) {
  return useQuery({
    queryKey: [...projectsKeys.detail(id!), 'ledgers'],
    queryFn: () => getProjectLedgers(id!),
    enabled: !!id, staleTime: 2 * 60 * 1000,
  });
}

export function useProject(id: string | null) {
  return useQuery({
    queryKey: projectsKeys.detail(id!),
    queryFn: () => getProject(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

export function useProjectStats(isLegacy?: boolean) {
  return useQuery({
    queryKey: [...projectsKeys.stats(), isLegacy],
    queryFn: () => getProjectStats(isLegacy),
    staleTime: 5 * 60 * 1000,
  });
}

export function useProjectClients() {
  return useQuery({
    queryKey: projectsKeys.clients(),
    queryFn: getProjectClients,
    staleTime: 10 * 60 * 1000,
  });
}

export function useProjectMilestones(id: string | null) {
  return useQuery({
    queryKey: projectsKeys.milestones(id!),
    queryFn: () => getProjectMilestones(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLinkableProjects() {
  return useQuery({
    queryKey: projectsKeys.linkable(),
    queryFn: getLinkableProjects,
    staleTime: 2 * 60 * 1000,
  });
}

// ============================================================================
// Mutation Hooks
// ============================================================================

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectsKeys.lists() });
      queryClient.invalidateQueries({ queryKey: projectsKeys.stats() });
      queryClient.invalidateQueries({ queryKey: projectsKeys.clients() });
    },
  });
}

export function useUpdateProject(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<CreateProjectRequest>) => updateProject(projectId, data),
    onSuccess: (data) => {
      queryClient.setQueryData(projectsKeys.detail(projectId), data);
      queryClient.invalidateQueries({ queryKey: projectsKeys.lists() });
      queryClient.invalidateQueries({ queryKey: projectsKeys.stats() });
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectsKeys.lists() });
      queryClient.invalidateQueries({ queryKey: projectsKeys.stats() });
    },
  });
}

export function useImportAwardLetters() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importAwardLetters,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectsKeys.lists() });
      queryClient.invalidateQueries({ queryKey: projectsKeys.stats() });
      queryClient.invalidateQueries({ queryKey: projectsKeys.clients() });
    },
  });
}

// ============================================================================
// Prefetch
// ============================================================================

export function usePrefetchProjectDetail() {
  const queryClient = useQueryClient();
  return useCallback(
    (projectId: string) => {
      if (queryClient.getQueryData(projectsKeys.detail(projectId))) return;
      queryClient.prefetchQuery({
        queryKey: projectsKeys.detail(projectId),
        queryFn: () => getProject(projectId),
        staleTime: 5 * 60 * 1000,
      });
    },
    [queryClient]
  );
}

// ============================================================================
// Register Review Queue (admin)
// ============================================================================

import {
  getReviewQueue,
  getReviewQueueSummary,
  resolveReviewItem,
  bulkDismissReviewItems,
  type ReviewQueueParams,
  type ReviewQueueItem,
  type ReviewQueuePage,
  type ReviewQueueSummary,
} from '@/lib/api/projects';

export type { ReviewQueueParams, ReviewQueueItem, ReviewQueuePage, ReviewQueueSummary };

export const reviewQueueKeys = {
  all: ['projects', 'review-queue'] as const,
  list: (params: ReviewQueueParams) => [...reviewQueueKeys.all, 'list', params] as const,
  summary: () => [...reviewQueueKeys.all, 'summary'] as const,
};

export function useReviewQueue(params: ReviewQueueParams = {}) {
  return useQuery({
    queryKey: reviewQueueKeys.list(params),
    queryFn: () => getReviewQueue(params),
    staleTime: 2 * 60 * 1000,
    placeholderData: keepPreviousData,
    // Trust the actual request, not the browser's online heuristic —
    // embedded/flaky environments misreport offline and paused the query
    networkMode: 'always',
    retry: 2,
  });
}

export function useReviewQueueSummary() {
  return useQuery({
    queryKey: reviewQueueKeys.summary(),
    queryFn: getReviewQueueSummary,
    staleTime: 2 * 60 * 1000,
    refetchOnMount: 'always',
    networkMode: 'always',
    retry: 2,
  });
}

export function useResolveReviewItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, value }: { id: string; value: string | null }) =>
      resolveReviewItem(id, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reviewQueueKeys.all });
      // Applied values change project rows too
      queryClient.invalidateQueries({ queryKey: projectsKeys.all });
    },
  });
}

export function useBulkDismissReviewItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ reason, field }: { reason: string; field?: string }) =>
      bulkDismissReviewItems(reason, field),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reviewQueueKeys.all });
    },
  });
}

// ============================================================================
// Register Benchmarks (T1.13)
// ============================================================================

import { getProjectBenchmarks, type TypeBenchmark } from '@/lib/api/projects';

export type { TypeBenchmark };

export function useProjectBenchmarks() {
  return useQuery({
    queryKey: [...projectsKeys.all, 'benchmarks'] as const,
    queryFn: getProjectBenchmarks,
    staleTime: 10 * 60 * 1000,
  });
}

// ============================================================================
// Weekly Report Submissions (Phase 2)
// ============================================================================

import {
  getProjectSubmissions,
  getProjectSubmission,
  uploadWeeklyReport,
  retryProjectSubmission,
  deleteProjectSubmission,
  getUnmappedFleetNumbers,
  linkUnmappedFleetNumber,
  type ProjectSubmission,
  type SubmissionStatus,
  type UnmappedFleetNumber,
} from '@/lib/api/projects';

export type { ProjectSubmission, SubmissionStatus, UnmappedFleetNumber };

export const submissionKeys = {
  all: ['projects', 'submissions'] as const,
  list: (params: object) => [...submissionKeys.all, 'list', params] as const,
  detail: (id: string) => [...submissionKeys.all, 'detail', id] as const,
  unmapped: () => ['projects', 'unmapped-fleet'] as const,
};

const ACTIVE_STATUSES = new Set(['queued', 'parsing']);
const TERMINAL_STATUSES = new Set(['success', 'partial', 'failed']);

// Submissions whose processing outcome hasn't been reflected in the UI
// yet. Module-level on purpose: it survives route changes, so a workbook
// that finishes parsing while NO submissions view is mounted still
// triggers the global refresh the next time any of them fetches.
// Seeded by the upload/retry mutations (they know the submission id)
// and by any fetch that sees a submission queued/parsing.
const PENDING_SUBMISSIONS = new Set<string>();

export function useProjectSubmissions(params: {
  status?: SubmissionStatus; project_id?: string; page?: number; limit?: number;
} = {}, opts: { poll?: boolean; watch?: boolean } = {}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: submissionKeys.list(params),
    queryFn: () => getProjectSubmissions(params),
    staleTime: 30 * 1000,
    networkMode: 'always',
    retry: 2,
    // poll: steady 4s (submission tables). watch (hub layout): 4s while
    // anything is processing, slow 15s heartbeat otherwise so changes
    // made elsewhere still surface without a manual refresh.
    refetchInterval: opts.poll
      ? 4000
      : opts.watch
        ? (q) => (PENDING_SUBMISSIONS.size > 0
            || (q.state.data?.data ?? []).some(
              (sub) => ACTIVE_STATUSES.has(sub.status)) ? 4000 : 15000)
        : undefined,
  });

  // The moment a pending workbook lands (queued/parsing -> done), every
  // projects query — overview, tables, issues, lists — is stale.
  // Invalidate the whole 'projects' root so the dashboard updates within
  // one poll tick instead of waiting out staleTime or a hard refresh.
  useEffect(() => {
    const rows = query.data?.data ?? [];
    let finished = false;
    for (const sub of rows) {
      if (ACTIVE_STATUSES.has(sub.status)) {
        PENDING_SUBMISSIONS.add(sub.id);
      } else if (TERMINAL_STATUSES.has(sub.status) && PENDING_SUBMISSIONS.has(sub.id)) {
        PENDING_SUBMISSIONS.delete(sub.id);
        finished = true;
      }
    }
    if (finished) {
      queryClient.invalidateQueries({ queryKey: projectsKeys.all });
    }
  }, [query.data, queryClient]);

  return query;
}

export function useUploadWeeklyReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, projectId, year, weekNumber }: {
      file: File; projectId: string; year: number; weekNumber: number;
    }) => uploadWeeklyReport(file, projectId, year, weekNumber),
    onSuccess: (data) => {
      // remember the id NOW — even if parsing finishes before any
      // submissions view takes its first look, the terminal sighting
      // still triggers the global refresh
      if (data?.submission_id) PENDING_SUBMISSIONS.add(data.submission_id);
      queryClient.invalidateQueries({ queryKey: submissionKeys.all });
    },
  });
}

export function useRetryProjectSubmission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => retryProjectSubmission(id),
    onSuccess: (_data, id) => {
      PENDING_SUBMISSIONS.add(id);
      queryClient.invalidateQueries({ queryKey: submissionKeys.all });
    },
  });
}

export function useDeleteProjectSubmission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteProjectSubmission(id),
    // deletion (incl. adjustments recompute) completes inside the request —
    // every dashboard figure is already different, so drop the whole root
    onSuccess: () => queryClient.invalidateQueries({ queryKey: projectsKeys.all }),
  });
}

export function useUnmappedFleetNumbers() {
  return useQuery({
    queryKey: submissionKeys.unmapped(),
    queryFn: getUnmappedFleetNumbers,
    staleTime: 5 * 60 * 1000,
    networkMode: 'always',
  });
}

export function useLinkUnmappedFleetNumber() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ raw, plantId }: { raw: string; plantId: string }) =>
      linkUnmappedFleetNumber(raw, plantId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: submissionKeys.unmapped() }),
  });
}

// ============================================================================
// Operations (Phase 3) — recomputed weekly aggregates
// ============================================================================

import {
  getProjectOperations,
  getProjectOperationsSummary,
  getProjectOperationsSeries,
  type ProjectOperationsRow,
  type ProjectOperationsSummary,
  type ProjectOperationsWeekRow,
  type ProjectOperationsMonthRow,
} from '@/lib/api/projects';

export type {
  ProjectOperationsRow,
  ProjectOperationsSummary,
  ProjectOperationsWeekRow,
  ProjectOperationsMonthRow,
};

export const operationsKeys = {
  all: ['projects', 'operations'] as const,
  portfolio: () => [...operationsKeys.all, 'portfolio'] as const,
  summary: (id: string) => [...operationsKeys.all, 'summary', id] as const,
  series: (id: string, g: 'week' | 'month') =>
    [...operationsKeys.all, 'series', id, g] as const,
};

export function useExecutiveSummary() {
  return useQuery({
    queryKey: [...operationsKeys.all, 'executive'] as const,
    queryFn: getExecutiveSummary,
    staleTime: 2 * 60 * 1000,
    networkMode: 'always',
    retry: 2,
  });
}

export function useProjectOperations() {
  return useQuery({
    queryKey: operationsKeys.portfolio(),
    queryFn: getProjectOperations,
    staleTime: 2 * 60 * 1000,
    networkMode: 'always',
    retry: 2,
  });
}

export function useProjectOperationsSummary(projectId: string | undefined) {
  return useQuery({
    queryKey: operationsKeys.summary(projectId ?? ''),
    queryFn: () => getProjectOperationsSummary(projectId!),
    enabled: !!projectId,
    staleTime: 2 * 60 * 1000,
    networkMode: 'always',
    retry: 2,
  });
}

export function useProjectOperationsSeries(
  projectId: string | undefined, granularity: 'week' | 'month',
) {
  return useQuery({
    queryKey: operationsKeys.series(projectId ?? '', granularity),
    queryFn: () => getProjectOperationsSeries(projectId!, granularity),
    enabled: !!projectId,
    staleTime: 2 * 60 * 1000,
    networkMode: 'always',
    retry: 2,
  });
}

import {
  getExecutiveSummary,
  getProjectFinancials,
  getProjectPlantData,
  type ProjectFinancials,
  type FinancialWeek,
  type ProjectPlantRollup,
  type ProjectPlantData,
  type PlantFleetWeek,
  type PlantWeekRow,
} from '@/lib/api/projects';

export type { ProjectFinancials, FinancialWeek, ProjectPlantRollup, ProjectPlantData, PlantFleetWeek, PlantWeekRow };
export type { ExecutiveSummary, PortfolioProject, AttentionItem, PortfolioWeek } from '@/lib/api/projects';

export function useProjectFinancials(projectId: string | undefined) {
  return useQuery({
    queryKey: [...operationsKeys.all, 'financials', projectId ?? ''] as const,
    queryFn: () => getProjectFinancials(projectId!),
    enabled: !!projectId,
    staleTime: 2 * 60 * 1000,
    networkMode: 'always',
    retry: 2,
  });
}

export function useProjectPlantData(projectId: string | undefined) {
  return useQuery({
    queryKey: [...operationsKeys.all, 'plants', projectId ?? ''] as const,
    queryFn: () => getProjectPlantData(projectId!),
    enabled: !!projectId,
    staleTime: 2 * 60 * 1000,
    networkMode: 'always',
    retry: 2,
  });
}

import { previewWeeklyReport, type ReportPreview, type SheetPreview } from '@/lib/api/projects';

export type { ReportPreview, SheetPreview };

/**
 * Warm every hub tab's queries in the background as soon as a project
 * hub opens. Each entry mirrors its hook's queryKey + staleTime
 * EXACTLY, so the later mount is a pure cache hit. Delayed slightly so
 * the visible page's own requests win the connection first.
 */
export function usePrefetchHubData(id: string | null) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!id) return;
    const t = setTimeout(() => {
      const two = 2 * 60 * 1000;
      queryClient.prefetchQuery({
        queryKey: [...operationsKeys.all, 'financials', id] as const,
        queryFn: () => getProjectFinancials(id), staleTime: two,
      });
      queryClient.prefetchQuery({
        queryKey: [...projectsKeys.detail(id), 'work-done', 'latest', 'latest'],
        queryFn: () => getProjectWorkDone(id), staleTime: two,
      });
      queryClient.prefetchQuery({
        queryKey: [...projectsKeys.detail(id), 'site'],
        queryFn: () => getProjectSite(id), staleTime: two,
      });
      queryClient.prefetchQuery({
        queryKey: [...projectsKeys.detail(id), 'ledgers'],
        queryFn: () => getProjectLedgers(id), staleTime: two,
      });
      queryClient.prefetchQuery({
        queryKey: [...operationsKeys.all, 'plants', id] as const,
        queryFn: () => getProjectPlantData(id), staleTime: two,
      });
      queryClient.prefetchQuery({
        queryKey: submissionKeys.unmapped(),
        queryFn: getUnmappedFleetNumbers, staleTime: 5 * 60 * 1000,
      });
    }, 800);
    return () => clearTimeout(t);
  }, [id, queryClient]);
}

export function usePreviewWeeklyReport() {
  return useMutation({
    mutationFn: ({ file, projectId }: { file: File; projectId?: string }) =>
      previewWeeklyReport(file, projectId),
  });
}
