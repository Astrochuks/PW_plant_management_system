/**
 * Projects data hooks using React Query
 */

import { useCallback } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import {
  getProjects,
  getProject,
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

export function useProjectSubmissions(params: {
  status?: SubmissionStatus; project_id?: string; page?: number; limit?: number;
} = {}, opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: submissionKeys.list(params),
    queryFn: () => getProjectSubmissions(params),
    staleTime: 30 * 1000,
    networkMode: 'always',
    retry: 2,
    refetchInterval: opts.poll ? 4000 : undefined,
  });
}

export function useUploadWeeklyReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, projectId, year, weekNumber }: {
      file: File; projectId: string; year: number; weekNumber: number;
    }) => uploadWeeklyReport(file, projectId, year, weekNumber),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: submissionKeys.all });
    },
  });
}

export function useRetryProjectSubmission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => retryProjectSubmission(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: submissionKeys.all }),
  });
}

export function useDeleteProjectSubmission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteProjectSubmission(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: submissionKeys.all }),
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
  getProjectFinancials,
  getProjectPlantRollups,
  type ProjectFinancials,
  type FinancialWeek,
  type ProjectPlantRollup,
} from '@/lib/api/projects';

export type { ProjectFinancials, FinancialWeek, ProjectPlantRollup };

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

export function useProjectPlantRollups(projectId: string | undefined) {
  return useQuery({
    queryKey: [...operationsKeys.all, 'plants', projectId ?? ''] as const,
    queryFn: () => getProjectPlantRollups(projectId!),
    enabled: !!projectId,
    staleTime: 2 * 60 * 1000,
    networkMode: 'always',
    retry: 2,
  });
}
