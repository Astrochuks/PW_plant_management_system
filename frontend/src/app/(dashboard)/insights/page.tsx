'use client'

import { useState } from 'react'
import { Lightbulb, AlertTriangle, AlertCircle, Info, RefreshCw, Filter } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { InsightCard } from '@/components/insights/insight-card'
import { useInsights, useInsightsSummary, useGenerateInsights, useAcknowledgeInsight } from '@/hooks/use-insights'
import { useAuth } from '@/providers/auth-provider'
import type { InsightSeverity, InsightType, InsightsListParams } from '@/lib/api/insights'

type SeverityFilter = 'all' | InsightSeverity

const INSIGHT_TYPES: { value: string; label: string }[] = [
  { value: 'all', label: 'All Types' },
  { value: 'fleet_overview', label: 'Fleet Overview' },
  { value: 'condition_change', label: 'Condition Changes' },
  { value: 'utilization_alert', label: 'Utilization Alerts' },
  { value: 'idle_fleet', label: 'Idle Fleet' },
  { value: 'chronic_breakdown', label: 'Chronic Breakdowns' },
  { value: 'fleet_rebalancing', label: 'Fleet Rebalancing' },
  { value: 'fleet_reliability', label: 'Fleet Reliability' },
  { value: 'site_performance', label: 'Site Rankings' },
  { value: 'submission_gap', label: 'Submission Gaps' },
  { value: 'missing_plants', label: 'Missing Plants' },
]

export default function InsightsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [page, setPage] = useState(1)

  const params: InsightsListParams = {
    page,
    limit: 20,
    ...(severityFilter !== 'all' && { severity: severityFilter }),
    ...(typeFilter !== 'all' && { insight_type: typeFilter as InsightType }),
  }

  const { data: summaryData, isLoading: summaryLoading } = useInsightsSummary()
  const { data: insightsData, isLoading: insightsLoading } = useInsights(params)
  const generateMutation = useGenerateInsights()
  const acknowledgeMutation = useAcknowledgeInsight()

  const summary = summaryData
  const insights = insightsData?.data ?? []
  const meta = insightsData?.meta

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Lightbulb className="h-6 w-6 text-amber-500" />
            Fleet Intelligence
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Automated insights from weekly report data
          </p>
        </div>
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const weekDate = summary?.week_ending_date
              if (weekDate) generateMutation.mutate(weekDate)
            }}
            disabled={generateMutation.isPending || !summary?.week_ending_date}
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${generateMutation.isPending ? 'animate-spin' : ''}`} />
            Generate Insights
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {summaryLoading ? (
          [...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-5 pb-4">
                <Skeleton className="h-4 w-16 mb-2" />
                <Skeleton className="h-8 w-12" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Total Insights</p>
                </div>
                <p className="text-2xl font-bold mt-1">{summary?.total ?? 0}</p>
                {summary?.week_ending_date && (
                  <p className="text-[10px] text-muted-foreground">Week ending {summary.week_ending_date}</p>
                )}
              </CardContent>
            </Card>
            <Card className="border-red-200 dark:border-red-900">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                  <p className="text-xs text-muted-foreground">Critical</p>
                </div>
                <p className="text-2xl font-bold mt-1 text-red-600">{summary?.critical ?? 0}</p>
              </CardContent>
            </Card>
            <Card className="border-amber-200 dark:border-amber-900">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <p className="text-xs text-muted-foreground">Warnings</p>
                </div>
                <p className="text-2xl font-bold mt-1 text-amber-600">{summary?.warning ?? 0}</p>
              </CardContent>
            </Card>
            <Card className="border-blue-200 dark:border-blue-900">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-blue-600" />
                  <p className="text-xs text-muted-foreground">Unacknowledged</p>
                </div>
                <p className="text-2xl font-bold mt-1 text-blue-600">{summary?.unacknowledged ?? 0}</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Filter className="h-4 w-4 text-muted-foreground" />
        {/* Severity toggle */}
        <div className="flex items-center rounded-md bg-muted p-0.5">
          {(['all', 'critical', 'warning', 'info'] as SeverityFilter[]).map((sev) => (
            <button
              key={sev}
              onClick={() => { setSeverityFilter(sev); setPage(1) }}
              className={`px-3 py-1 text-xs rounded-sm transition-colors ${
                severityFilter === sev
                  ? 'bg-background shadow-sm font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {sev === 'all' ? 'All' : sev.charAt(0).toUpperCase() + sev.slice(1)}
            </button>
          ))}
        </div>

        {/* Type filter */}
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1) }}>
          <SelectTrigger className="w-48 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INSIGHT_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value} className="text-xs">
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Insight Cards */}
      {insightsLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-4 pb-3">
                <div className="flex gap-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : insights.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Lightbulb className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              No insights generated yet. Upload weekly reports or click &quot;Generate Insights&quot; to start.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {insights.map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              onAcknowledge={(id) => acknowledgeMutation.mutate(id)}
              isAcknowledging={acknowledgeMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {meta && meta.total_pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {meta.page} of {meta.total_pages} ({meta.total} insights)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= meta.total_pages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
