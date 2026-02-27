/**
 * Insights data hooks using React Query
 */

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  getInsights,
  getInsightsSummary,
  getWeeklyBrief,
  generateInsights,
  acknowledgeInsight,
  type InsightsListParams,
} from '@/lib/api/insights';

// Query keys
export const insightsKeys = {
  all: ['insights'] as const,
  list: (params?: InsightsListParams) => [...insightsKeys.all, 'list', params] as const,
  summary: (week?: string) => [...insightsKeys.all, 'summary', week] as const,
  brief: (week?: string) => [...insightsKeys.all, 'brief', week] as const,
};

/**
 * Hook to fetch paginated insights list
 */
export function useInsights(params?: InsightsListParams) {
  return useQuery({
    queryKey: insightsKeys.list(params),
    queryFn: () => getInsights(params),
    staleTime: 2 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Hook to fetch insights summary for dashboard
 */
export function useInsightsSummary(weekEndingDate?: string) {
  return useQuery({
    queryKey: insightsKeys.summary(weekEndingDate),
    queryFn: () => getInsightsSummary(weekEndingDate),
    staleTime: 2 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Hook to fetch structured weekly brief
 */
export function useWeeklyBrief(weekEndingDate?: string) {
  return useQuery({
    queryKey: insightsKeys.brief(weekEndingDate),
    queryFn: () => getWeeklyBrief(weekEndingDate),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to trigger insight generation (admin)
 */
export function useGenerateInsights() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: generateInsights,
    onSettled: () => {
      // Invalidate on both success and error — the server may complete
      // even if the client times out, so always refetch.
      queryClient.invalidateQueries({ queryKey: insightsKeys.all });
    },
  });
}

/**
 * Hook to acknowledge an insight
 */
export function useAcknowledgeInsight() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: acknowledgeInsight,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: insightsKeys.all });
    },
  });
}
