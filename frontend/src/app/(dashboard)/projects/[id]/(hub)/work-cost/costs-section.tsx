'use client'

/**
 * Costs — the 7 company-standard categories. To-date comes from the
 * LATEST week's own cumulative column (exact even with missing weeks);
 * trends come from stored this-week movement.
 */

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import ECharts from 'echarts-for-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Legend } from '@/components/projects/hub-ui'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjectCostsSummary, useProjectFinancials } from '@/hooks/use-projects'
import { naira, weekLabel } from '@/lib/format'

type Granularity = 'week' | 'month'

export default function CostsPage() {
  const params = useParams<{ id: string }>()
  const { data: summary, isLoading } = useProjectCostsSummary(params.id)
  const { data: fin } = useProjectFinancials(params.id)
  const [gran, setGran] = useState<Granularity>('week')

  const trend = useMemo(() => {
    if (!fin?.weeks) return { labels: [] as string[], categories: {} as Record<string, number[]> }
    const labels: string[] = []
    const buckets: Record<string, Record<string, number>> = {}
    for (const w of fin.weeks) {
      const label = gran === 'week'
        ? weekLabel(w.year, w.week_number)
        : new Date(w.week_ending_date + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
      if (!buckets[label]) { buckets[label] = {}; labels.push(label) }
      for (const [cat, amt] of Object.entries(w.cost_by_category)) {
        buckets[label][cat] = (buckets[label][cat] ?? 0) + amt
      }
    }
    const cats = [...new Set(Object.values(buckets).flatMap((b) => Object.keys(b)))]
    const categories: Record<string, number[]> = {}
    for (const c of cats) categories[c] = labels.map((l) => Math.round(buckets[l][c] ?? 0))
    return { labels, categories }
  }, [fin, gran])

  if (isLoading) return <PageSkeleton />
  if (!summary || summary.categories.length === 0) {
    return (
      <div className="rounded-lg border py-12 text-center text-muted-foreground">
        <p className="text-lg font-medium text-foreground">No cost data yet</p>
        <p className="mt-1 text-sm">Upload a weekly report with a Cost Report sheet.</p>
      </div>
    )
  }

  const stackOption = {
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => naira(v, true) },
    legend: { bottom: 0, type: 'scroll' },
    grid: { left: 70, right: 20, top: 20, bottom: 42 },
    xAxis: { type: 'category', data: trend.labels },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => naira(v, true) } },
    series: Object.entries(trend.categories).map(([name, data]) => ({
      name, type: 'bar', stack: 'cost', data, barMaxWidth: 28,
    })),
  }

  return (
    <div className="space-y-4">
      <Card className="relative">
        <Legend>Cost movement · stacked by category</Legend>
        <CardHeader className="flex-row items-center justify-between pb-0 pt-5">
          <p className="text-xs text-muted-foreground">stored weeks only — gaps show as holes</p>
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
            {(['week', 'month'] as const).map((g) => (
              <button key={g} onClick={() => setGran(g)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize ${
                  gran === g ? 'bg-primary/20 text-foreground' : 'text-muted-foreground'
                }`}>
                {g === 'week' ? 'Weekly' : 'Monthly'}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <ECharts option={stackOption} style={{ height: 300 }} notMerge />
        </CardContent>
      </Card>
    </div>
  )
}


function PageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-72" /><Skeleton className="h-72" />
      </div>
      <Skeleton className="h-72" />
    </div>
  )
}
