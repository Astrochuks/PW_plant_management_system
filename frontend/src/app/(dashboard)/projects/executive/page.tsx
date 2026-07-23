'use client'

/**
 * Executive summary — the portfolio landing page. Answers four
 * questions in order of "would this change what I do this week":
 * where we stand, what we're owed, what needs attention, and then the
 * projects themselves. Every figure is the project-level figure summed
 * up, so this page and the hub can never disagree.
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import ECharts from 'echarts-for-react'
import { AlertTriangle, ArrowRight, Banknote, CalendarClock, TrendingDown } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Kpi, Legend, LegendSm } from '@/components/projects/hub-ui'
import { useExecutiveSummary } from '@/hooks/use-projects'
import type { AttentionItem, PortfolioWeek } from '@/hooks/use-projects'
import { naira, num, pctFmt, fmtDate, weekLabel } from '@/lib/format'

type Granularity = 'week' | 'month' | 'quarter' | 'year'

const GRANS: Array<{ key: Granularity; label: string }> = [
  { key: 'week', label: 'Weekly' },
  { key: 'month', label: 'Monthly' },
  { key: 'quarter', label: 'Quarterly' },
  { key: 'year', label: 'Yearly' },
]

const COLOR_WORK = '#f59e0b'
const COLOR_COST = '#3b82f6'
const COLOR_NET = '#10b981'

function bucketKey(w: PortfolioWeek, g: Granularity): string {
  const d = new Date(w.week_ending_date + 'T00:00:00')
  if (g === 'week') return weekLabel(w.year, w.week_number)
  if (g === 'month') return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  if (g === 'quarter') return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`
  return String(d.getFullYear())
}

const compactNaira = (v: number) =>
  Math.abs(v) >= 1_000_000_000 ? `₦${(v / 1_000_000_000).toFixed(1)}b`
    : Math.abs(v) >= 1_000_000 ? `₦${(v / 1_000_000).toFixed(0)}m`
      : Math.abs(v) >= 1_000 ? `₦${(v / 1_000).toFixed(0)}k` : `₦${v}`

const KIND_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  overdue: CalendarClock,
  cash: Banknote,
  reporting: AlertTriangle,
  margin: TrendingDown,
  loss: TrendingDown,
}

export default function ExecutiveSummaryPage() {
  const router = useRouter()
  const { data, isLoading } = useExecutiveSummary()
  const [gran, setGran] = useState<Granularity>('week')
  const [sort, setSort] = useState<'net' | 'margin' | 'pct' | 'unpaid' | 'stale'>('net')

  const buckets = useMemo(() => {
    const map = new Map<string, { label: string; work: number; cost: number; net: number }>()
    for (const w of data?.series ?? []) {
      const key = bucketKey(w, gran)
      const b = map.get(key) ?? { label: key, work: 0, cost: 0, net: 0 }
      b.work += w.works_incl_vat
      b.cost += w.cost
      b.net += w.net
      map.set(key, b)
    }
    return [...map.values()]
  }, [data, gran])

  const projects = useMemo(() => {
    const list = [...(data?.projects ?? [])]
    if (sort === 'net') list.sort((a, b) => b.net - a.net)
    if (sort === 'margin') list.sort((a, b) => (b.margin ?? -Infinity) - (a.margin ?? -Infinity))
    if (sort === 'pct') list.sort((a, b) => (b.pct_complete ?? -1) - (a.pct_complete ?? -1))
    if (sort === 'unpaid') list.sort((a, b) => (b.certified_not_paid ?? 0) - (a.certified_not_paid ?? 0))
    if (sort === 'stale') list.sort((a, b) => (b.days_since_report ?? -1) - (a.days_since_report ?? -1))
    return list
  }, [data, sort])

  if (isLoading) return <PageSkeleton />
  if (!data || data.projects.length === 0) {
    return (
      <div className="rounded-lg border py-16 text-center text-muted-foreground">
        <p className="text-lg font-medium text-foreground">No reporting projects yet</p>
        <p className="mt-1 text-sm">
          The portfolio fills itself as sites start sending weekly reports.
        </p>
      </div>
    )
  }

  const t = data.totals
  const labels = buckets.map((b) => b.label)

  const trendOption = {
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => naira(v) },
    legend: { data: ['Work done (Incl. VAT)', 'Cost', 'Net'], bottom: 0 },
    grid: { left: 64, right: 16, top: 20, bottom: 42 },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value', axisLabel: { formatter: compactNaira } },
    series: [
      { name: 'Work done (Incl. VAT)', type: 'bar', data: buckets.map((b) => Math.round(b.work)), itemStyle: { color: COLOR_WORK } },
      { name: 'Cost', type: 'bar', data: buckets.map((b) => Math.round(b.cost)), itemStyle: { color: COLOR_COST } },
      { name: 'Net', type: 'line', data: buckets.map((b) => Math.round(b.net)), itemStyle: { color: COLOR_NET }, lineStyle: { width: 2.5 } },
    ],
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Executive summary</h1>
        <p className="text-sm text-muted-foreground">
          {t.projects_reporting} active {t.projects_reporting === 1 ? 'project' : 'projects'} reporting
          {' · '}portfolio position as at {fmtDate(data.generated_at)}
        </p>
      </div>

      {/* 1 — where we stand */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Kpi label="Contract value" value={naira(t.contract_sum, true)} sub={naira(t.contract_sum)} />
        <Kpi label="Work done · to date" value={naira(t.works_incl_vat, true)}
          sub={`${pctFmt(t.pct_complete)} of BEME scope`} />
        <Kpi label="Cost · to date" value={naira(t.cost, true)} sub={naira(t.cost)} />
        <Kpi label="Net · to date" value={naira(t.net, true)} sub={naira(t.net)}
          tone={t.net >= 0 ? 'good' : 'bad'} />
        <Kpi label="Margin · to date" value={pctFmt(t.margin)}
          tone={(t.margin ?? 0) < 0 ? 'bad' : 'good'} />
      </div>

      {/* 2 — what we're owed */}
      <Card className="relative">
        <Legend>Cash position</Legend>
        <CardContent className="grid gap-5 pt-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)]">
          <div className="relative rounded-lg border border-amber-300 bg-amber-50/60 p-4 dark:border-amber-700 dark:bg-amber-950/20">
            <LegendSm>Certified, not yet paid</LegendSm>
            <p className="text-3xl font-bold tabular-nums text-amber-900 dark:text-amber-200">
              {naira(t.certified_not_paid, true)}
            </p>
            <p className="mt-0.5 text-xs tabular-nums text-amber-900/70 dark:text-amber-200/70">
              {naira(t.certified_not_paid)}
            </p>
            {t.oldest_unpaid_days != null && (
              <p className="mt-2 text-xs font-medium text-amber-900 dark:text-amber-200">
                Longest wait since a payment landed: {num(t.oldest_unpaid_days)} days
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Certified" value={naira(t.certified, true)} />
            <Kpi label="Paid (gross)" value={naira(t.paid_gross, true)} />
            <Kpi label="Retention held" value={naira(t.retention_held, true)} />
            <Kpi label="Overdue projects" value={String(t.overdue_projects)}
              tone={t.overdue_projects > 0 ? 'bad' : 'good'} />
          </div>
        </CardContent>
      </Card>

      {/* 3 — what needs you */}
      <Card className="relative">
        <Legend>Needs attention</Legend>
        <CardContent className="p-0 pt-2">
          {data.attention.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Nothing flagged — every project is reporting, on programme and collecting.
            </p>
          ) : (
            <ul className="divide-y">
              {data.attention.map((a, i) => (
                <AttentionRow key={i} item={a}
                  onClick={() => router.push(`/projects/${a.project_id}`)} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* the portfolio over time */}
      <Card className="relative">
        <Legend>Portfolio · work done vs cost</Legend>
        <CardContent className="pt-3">
          <div className="mb-2 flex justify-end">
            <Select value={gran} onValueChange={(v) => setGran(v as Granularity)}>
              <SelectTrigger className="h-8 w-36 text-xs font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GRANS.map((g) => (
                  <SelectItem key={g.key} value={g.key}>{g.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ECharts option={trendOption} style={{ height: 300 }} notMerge />
        </CardContent>
      </Card>

      {/* 4 — the projects */}
      <Card className="relative">
        <Legend>Projects</Legend>
        <CardContent className="p-0 pt-2">
          <div className="flex justify-end px-4 pb-2">
            <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
              <SelectTrigger className="h-8 w-48 text-xs font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="net">Net earned</SelectItem>
                <SelectItem value="margin">Margin</SelectItem>
                <SelectItem value="pct">% complete</SelectItem>
                <SelectItem value="unpaid">Certified, not paid</SelectItem>
                <SelectItem value="stale">Longest without a report</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Project</th>
                  <th className="px-4 py-2 font-medium">Client</th>
                  <th className="px-4 py-2 text-right font-medium">% Complete</th>
                  <th className="px-4 py-2 text-right font-medium">Work done (Incl. VAT)</th>
                  <th className="px-4 py-2 text-right font-medium">Net</th>
                  <th className="px-4 py-2 text-right font-medium">Margin</th>
                  <th className="px-4 py-2 text-right font-medium">Not yet paid</th>
                  <th className="px-4 py-2 font-medium">Schedule</th>
                  <th className="px-4 py-2 text-right font-medium">Latest report</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr
                    key={p.id}
                    className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/40"
                    onClick={() => router.push(`/projects/${p.id}`)}
                  >
                    <td className="px-4 py-2 font-medium">
                      {p.short_name || p.project_name}
                      {p.location_name && (
                        <span className="ml-1.5 text-[10px] text-muted-foreground">{p.location_name}</span>
                      )}
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-2 text-muted-foreground">{p.client ?? '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{pctFmt(p.pct_complete)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{naira(p.works_incl_vat)}</td>
                    <td className={`px-4 py-2 text-right tabular-nums font-medium ${p.net < 0 ? 'text-red-600' : ''}`}>
                      {naira(p.net)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{pctFmt(p.margin)}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${p.certified_not_paid ? 'font-medium text-amber-700 dark:text-amber-400' : ''}`}>
                      {p.certified_not_paid ? naira(p.certified_not_paid) : '—'}
                    </td>
                    <td className="px-4 py-2">
                      <ScheduleChip status={p.schedule.status} months={p.schedule.months_overdue} />
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      <span className={p.days_since_report != null && p.days_since_report > 14
                        ? 'font-medium text-amber-700 dark:text-amber-400' : ''}>
                        {p.latest_week_ending ? fmtDate(p.latest_week_ending) : '—'}
                      </span>
                      {p.days_since_report != null && (
                        <span className="ml-1 text-[10px] text-muted-foreground">
                          {num(p.days_since_report)}d
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ScheduleChip({ status, months }: {
  status: 'overdue' | 'on_track' | 'completed' | null
  months: number | null
}) {
  if (status === 'overdue') {
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold text-red-600">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        Overdue{months != null ? ` · ${months.toFixed(1)} mths` : ''}
      </span>
    )
  }
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Completed
      </span>
    )
  }
  if (status === 'on_track') {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        On track
      </span>
    )
  }
  return <span className="text-muted-foreground">—</span>
}

function AttentionRow({ item, onClick }: { item: AttentionItem; onClick: () => void }) {
  const Icon = KIND_ICON[item.kind] ?? AlertTriangle
  const high = item.severity === 'high'
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
      >
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          high ? 'bg-red-500/15 text-red-600' : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
        }`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold">{item.headline}</span>
            {item.kind === 'cash' && item.value != null && (
              <span className="text-sm font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                {naira(item.value)}
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {item.project} · {item.detail}
          </span>
        </span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
    </li>
  )
}

function PageSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-40" />
      <Skeleton className="h-56" />
      <Skeleton className="h-80" />
    </div>
  )
}
