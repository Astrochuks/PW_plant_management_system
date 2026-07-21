'use client'

/**
 * Costs — the 7 company-standard categories. To-date comes from the
 * LATEST week's own cumulative column (exact even with missing weeks);
 * trends come from stored this-week movement.
 */

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import ECharts from 'echarts-for-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjectCostsSummary, useProjectFinancials } from '@/hooks/use-projects'
import { naira, pctFmt, weekLabel } from '@/lib/format'

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

  const cats = summary.categories
  const total = summary.total_to_date
  const catBarOption = {
    tooltip: { valueFormatter: (v: number) => naira(v, true) },
    grid: { left: 130, right: 40, top: 10, bottom: 24 },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => naira(v, true) } },
    yAxis: { type: 'category', data: [...cats].reverse().map((c) => c.cost_category) },
    series: [{
      type: 'bar',
      data: [...cats].reverse().map((c) => Math.round(c.to_date)),
      itemStyle: { color: '#f59e0b' },
      barMaxWidth: 22,
    }],
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
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Cost · project to date" value={naira(total, true)} sub={naira(total)}
          lineage="latest week's cumulative column" />
        <Kpi label="Cost · latest week"
          value={naira(cats.reduce((a, c) => a + c.this_week, 0), true)}
          lineage="Σ this-week amounts" />
        <Kpi label="Biggest category" value={cats[0]?.cost_category ?? '—'}
          sub={`${naira(cats[0]?.to_date ?? null, true)} · ${pctFmt(total ? (cats[0]?.to_date ?? 0) / total : null)} of costs`}
          lineage="to date" />
        <Kpi label="Cost per ₦ of works"
          value={fin && fin.totals.earnings > 0
            ? `₦${(fin.totals.cost_total / (fin.totals.earnings / 1.075)).toFixed(2)}`
            : '—'}
          lineage="stored weeks · cost ÷ works (ex-VAT)" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm">Cost to date · by category</CardTitle>
            <p className="text-xs text-muted-foreground">workbook cumulative, latest week</p>
          </CardHeader>
          <CardContent>
            <ECharts option={catBarOption} style={{ height: 260 }} notMerge />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Category positions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Category</th>
                  <th className="px-4 py-2 text-right font-medium">To date</th>
                  <th className="px-4 py-2 text-right font-medium">This week</th>
                  <th className="px-4 py-2 text-right font-medium">% of costs</th>
                </tr>
              </thead>
              <tbody>
                {cats.map((c) => (
                  <tr key={c.cost_category} className="border-b last:border-0">
                    <td className="px-4 py-1.5">{c.cost_category}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{naira(c.to_date)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{naira(c.this_week)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{pctFmt(total ? c.to_date / total : null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-0">
          <div>
            <CardTitle className="text-sm">Cost movement · stacked by category</CardTitle>
            <p className="text-xs text-muted-foreground">stored weeks only — gaps show as holes</p>
          </div>
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

function Kpi({ label, value, sub, lineage }: { label: string; value: string; sub?: string; lineage: string }) {
  return (
    <Card className="py-0">
      <CardContent className="px-4 py-3">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-xl font-bold tabular-nums truncate">{value}</p>
        {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
        <p className="text-[10px] text-muted-foreground/70">{lineage}</p>
      </CardContent>
    </Card>
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
