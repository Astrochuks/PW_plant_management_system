/**
 * Insights API functions
 */

import apiClient from './client';

// Types

export type InsightType =
  | 'condition_change'
  | 'utilization_alert'
  | 'missing_plants'
  | 'chronic_breakdown'
  | 'idle_fleet'
  | 'fleet_rebalancing'
  | 'submission_gap'
  | 'transfer_activity'
  | 'fleet_reliability'
  | 'site_performance';

export type InsightSeverity = 'info' | 'warning' | 'critical';

export interface Insight {
  id: string;
  insight_type: InsightType;
  severity: InsightSeverity;
  title: string;
  description: string;
  recommendation: string | null;
  data: Record<string, unknown>;
  week_ending_date: string;
  year: number;
  week_number: number;
  location_id: string | null;
  location_name: string | null;
  plant_id: string | null;
  fleet_type: string | null;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

export interface InsightsSummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
  unacknowledged: number;
  week_ending_date: string | null;
  top_insights: Insight[];
}

export interface WeeklyBrief {
  week_ending_date: string;
  fleet_overview: Record<string, unknown>;
  site_rankings: Array<Record<string, unknown>>;
  condition_changes: Array<Record<string, unknown>>;
  chronic_breakdowns: Array<Record<string, unknown>>;
  insights: Insight[];
  recommendations: string[];
}

export interface InsightsListParams {
  week_ending_date?: string;
  severity?: InsightSeverity;
  insight_type?: InsightType;
  location_id?: string;
  acknowledged?: boolean;
  page?: number;
  limit?: number;
}

// API Response wrappers
interface ApiResponse<T> {
  success: boolean;
  data: T;
}

interface PaginatedApiResponse<T> {
  success: boolean;
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

// API Functions

export async function getInsights(params?: InsightsListParams): Promise<{
  data: Insight[];
  meta: { page: number; limit: number; total: number; total_pages: number };
}> {
  const response = await apiClient.get<PaginatedApiResponse<Insight>>('/insights', { params });
  return {
    data: response.data.data,
    meta: response.data.meta,
  };
}

export async function getInsightsSummary(weekEndingDate?: string): Promise<InsightsSummary> {
  const params = weekEndingDate ? { week_ending_date: weekEndingDate } : {};
  const response = await apiClient.get<ApiResponse<InsightsSummary>>('/insights/summary', { params });
  return response.data.data;
}

export async function getWeeklyBrief(weekEndingDate?: string): Promise<WeeklyBrief | null> {
  const params = weekEndingDate ? { week_ending_date: weekEndingDate } : {};
  const response = await apiClient.get<ApiResponse<WeeklyBrief | null>>('/insights/weekly-brief', { params });
  return response.data.data;
}

export async function generateInsights(weekEndingDate: string): Promise<{
  site_insights: number;
  fleet_insights: number;
}> {
  const response = await apiClient.post<ApiResponse<{ site_insights: number; fleet_insights: number }>>(
    `/insights/generate?week_ending_date=${weekEndingDate}`,
    undefined,
    { timeout: 120000 } // 2 minutes — insight generation scans all sites
  );
  return response.data.data;
}

export async function acknowledgeInsight(insightId: string): Promise<void> {
  await apiClient.patch(`/insights/${insightId}/acknowledge`);
}
