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

export function useProjectStats() {
  return useQuery({
    queryKey: projectsKeys.stats(),
    queryFn: getProjectStats,
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
