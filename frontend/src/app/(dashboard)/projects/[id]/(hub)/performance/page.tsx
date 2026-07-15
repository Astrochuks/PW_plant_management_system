'use client'

/**
 * Performance — the Weekly Summary reborn. Stored-weeks series from
 * /operations/financials, aggregated client-side by period. Headline
 * to-date figures come from the overview service (baseline + gaps),
 * so "project to date" is exact even with missing weeks.
 */

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import ECharts from 'echarts-for-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjectFinancials, useProjectOverview } from '@/hooks/use-projects'
import type { FinancialWeek } from '@/hooks/use-projects'
import { naira, pctFmt, weekLabel } from '@/lib/format'

type Granularity = 'week' | 'month' | 'quarter' | 'year'

interface Bucket {
  label: string
  works: number
  earnings: number
  cost: number
  net: number
  weeks: number
}

function bucketKey(w: FinancialWeek, g: Granularity): string {
  const d = new Date(w.week_ending_date + 'T00:00:00')
  if (g === 'week') return weekLabel(w.year, w.week_number)
  if (g === 'month') return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  if (g === 'quarter') return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`
  return String(d.getFullYear())
}

export default function PerformancePage() {
  const params = useParams<{ id: string }>()
  const { data: fin, isLoading } = useProjectFinancials(params.id)
  const { data: overview } = useProjectOverview(params.id)
  const [gran, setGran] = useState<Granularity>('week')

  const buckets: Bucket[] = useMemo(() => {
    if (!fin?.weeks) return []
    const map = new Map<string, Bucket>()
    for (const w of fin.weeks) {
      const key = bucketKey(w, gran)
      const b = map.get(key) ?? { label: key, works: 0, earnings: 0, cost: 0, net: 0, weeks: 0 }
      b.works += w.works_value
      b.earnings += w.earnings
      b.cost += w.cost_total
      b.net += w.net
      b.weeks += 1
      map.set(key, b)
    }
    return [...map.values()]
  }, [fin, gran])

  if (isLoading) return <PageSkeleton />
  if (!fin || fin.weeks.length === 0) {
    return (
      <div className="rounded-lg border py-12 text-center text-muted-foreground">
        <p className="text-lg font-medium text-foreground">No weekly reports yet</p>
        <p className="mt-1 text-sm">Performance builds itself from uploaded weeks.</p>
      </div>
    )
  }

  const latest = buckets[buckets.length - 1]
  const totals = fin.totals

  const chartOption = {
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v: number) => naira(v, true),
    },
    legend: { data: ['Earnings', 'Costs'], bottom: 0 },
    grid: { left: 70, right: 20, top: 20, bottom: 40 },
    xAxis: { type: 'category', data: buckets.map((b) => b.label) },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (v: number) => naira(v, true) },
    },
    series: [
      {
        name: 'Earnings', type: 'line', smooth: true,
        data: buckets.map((b) => Math.round(b.earnings)),
        itemStyle: { color: '#059669' }, lineStyle: { width: 2.5 },
      },
      {
        name: 'Costs', type: 'line', smooth: true,
        data: buckets.map((b) => Math.round(b.cost)),
        itemStyle: { color: '#dc2626' }, lineStyle: { width: 2.5 },
      },
    ],
  }

  const marginOption = {
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v: number) => naira(v, true),
    },
    grid: { left: 70, right: 20, top: 20, bottom: 24 },
    xAxis: { type: 'category', data: buckets.map((b) => b.label) },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => naira(v, true) } },
    series: [{
      name: 'Net', type: 'bar',
      data: buckets.map((b) => ({
        value: Math.round(b.net),
        itemStyle: { color: b.net >= 0 ? '#059669' : '#dc2626' },
      })),
    }],
  }

  return (
    <div className="space-y-4">
      {/* Period picker */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-lg bg-muted p-1 w-fit">
          {(['week', 'month', 'quarter', 'year'] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGran(g)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                gran === g ? 'bg-primary/20 text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {g === 'week' ? 'Weekly' : g === 'month' ? 'Monthly' : g === 'quarter' ? 'Quarterly' : 'Yearly'}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {fin.weeks.length} stored weeks · trends cover stored weeks only; to-date figures include the baseline
        </p>
      </div>

      {/* KPI cards: latest bucket + stored range + project to date */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label={`Works · latest ${gran}`} value={naira(latest.works, true)}
          sub={latest.label} lineage="Σ BEME this-week amounts" />
        <Kpi label={`Net · latest ${gran}`} value={naira(latest.net, true)}
          sub={`earnings − costs · ${latest.label}`}
          lineage="works × 1.075 − costs" tone={latest.net >= 0 ? 'good' : 'bad'} />
        <Kpi label="Net · stored weeks" value={naira(totals.net, true)}
          sub={`${totals.weeks_gaining} gaining · ${totals.weeks_losing} losing`}
          lineage={`across ${fin.weeks.length} stored weeks`} />
        <Kpi label="Net earnings · to date" value={naira(overview?.net_earnings.value ?? null, true)}
          sub={overview ? pctFmt(overview.net_earnings.pct) : undefined}
          lineage="incl. baseline · Weekly Summary definition" />
      </div>

      {/* Earnings vs costs */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">Earnings vs costs · per {gran}</CardTitle>
          <p className="text-xs text-muted-foreground">earnings = works × 1.075, excl contingency</p>
        </CardHeader>
        <CardContent>
          <ECharts option={chartOption} style={{ height: 300 }} notMerge />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">Net (gain / loss) · per {gran}</CardTitle>
        </CardHeader>
        <CardContent>
          <ECharts option={marginOption} style={{ height: 220 }} notMerge />
        </CardContent>
      </Card>

      {/* Period table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Movement by {gran}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium capitalize">{gran}</th>
                  <th className="px-4 py-2 text-right font-medium">Works</th>
                  <th className="px-4 py-2 text-right font-medium">Earnings (+VAT 7.5%)</th>
                  <th className="px-4 py-2 text-right font-medium">Costs</th>
                  <th className="px-4 py-2 text-right font-medium">Net</th>
                  <th className="px-4 py-2 text-right font-medium">Margin</th>
                </tr>
              </thead>
              <tbody>
                {[...buckets].reverse().map((b) => (
                  <tr key={b.label} className="border-b last:border-0">
                    <td className="px-4 py-2">{b.label}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{naira(b.works)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{naira(b.earnings)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{naira(b.cost)}</td>
                    <td className={`px-4 py-2 text-right tabular-nums font-medium ${b.net >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                      {naira(b.net)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {b.earnings ? pctFmt(b.net / b.earnings) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {fin.cross_check_warnings.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">Cross-checks vs the workbook&apos;s own Net Earnings:</p>
          <ul className="mt-1 list-disc pl-4">
            {fin.cross_check_warnings.slice(0, 6).map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value, sub, lineage, tone }: {
  label: string; value: string; sub?: string; lineage: string; tone?: 'good' | 'bad'
}) {
  return (
    <Card className="py-0">
      <CardContent className="px-4 py-3">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className={`mt-0.5 text-xl font-bold tabular-nums ${
          tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-600' : ''
        }`}>{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground truncate">{sub}</p>}
        <p className="text-[10px] text-muted-foreground/70">{lineage}</p>
      </CardContent>
    </Card>
  )
}

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-72" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-72" />
      <Skeleton className="h-56" />
    </div>
  )
}
