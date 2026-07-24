'use client'

/**
 * Executive summary — the portfolio landing page.
 *
 * Shape follows PW's own "General Summary Per Site Output": sites down
 * the side, periods across the top, output in the cells, row totals and
 * a grand total. Around it, the dashboard furniture: a filter bar that
 * drives EVERY figure on the page, the portfolio position, the cash
 * position, and the two breakdowns (by state, by type).
 *
 * Every figure is the project-level figure summed up — this page and a
 * project hub can never disagree.
 */

import { Fragment, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import ECharts from 'echarts-for-react'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Kpi, Legend, LegendSm } from '@/components/projects/hub-ui'
import { useExecutiveSummary } from '@/hooks/use-projects'
import type { PortfolioProject, PortfolioWeek } from '@/hooks/use-projects'
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
const TYPE_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#f43f5e', '#06b6d4', '#14b8a6', '#94a3b8']

const ALL = '__all__'
const UNSET = '— unassigned —'

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

// cells stay readable at portfolio scale — full naira lives in the tooltip
const cellMoney = (v: number) =>
  v === 0 ? '—'
    : Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}m`
      : `${(v / 1_000).toFixed(0)}k`

export default function ExecutiveSummaryPage() {
  const router = useRouter()
  const { data, isLoading } = useExecutiveSummary()
  const [gran, setGran] = useState<Granularity>('month')
  const [sort, setSort] = useState<'net' | 'margin' | 'pct' | 'unpaid' | 'stale'>('net')
  const [fState, setFState] = useState(ALL)
  const [fProject, setFProject] = useState(ALL)

  // the executive summary is the LIVE portfolio — active projects only
  const all = useMemo(
    () => (data?.projects ?? []).filter((p) => p.status === 'active'),
    [data],
  )

  // State narrows the pool; the Project drill-down then lists only what
  // survives it, so its options cascade from the State choice.
  const scoped = useMemo(() => all.filter((p) =>
    fState === ALL || (p.state_name || UNSET) === fState
  ), [all, fState])

  const options = useMemo(() => {
    const uniq = (vals: Array<string | null>) =>
      [...new Set(vals.map((v) => v || UNSET))].sort()
    return {
      states: uniq(all.map((p) => p.state_name)),
      // Project options follow the State choice
      projects: scoped
        .map((p) => ({ id: p.id, name: p.short_name || p.project_name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }
  }, [all, scoped])

  // if the State choice drops the chosen project, fall back to All
  useEffect(() => {
    if (fProject !== ALL && !scoped.some((p) => p.id === fProject)) {
      setFProject(ALL)
    }
  }, [scoped, fProject])

  // one filter set drives every figure on the page
  const projects = useMemo(
    () => scoped.filter((p) => fProject === ALL || p.id === fProject),
    [scoped, fProject],
  )

  const ids = useMemo(() => new Set(projects.map((p) => p.id)), [projects])
  const series = useMemo(
    () => (data?.series ?? []).filter((w) => ids.has(w.project_id)),
    [data, ids],
  )

  const t = useMemo(() => {
    const sum = (f: (p: PortfolioProject) => number | null | undefined) =>
      projects.reduce((a, p) => a + (f(p) ?? 0), 0)
    const works = sum((p) => p.works_incl_vat)
    const cost = sum((p) => p.cost)
    const scope = sum((p) => p.scope)
    const oldest = projects
      .filter((p) => p.certified_not_paid && p.days_since_payment != null)
      .map((p) => p.days_since_payment as number)
    return {
      count: projects.length,
      contract: sum((p) => p.contract_sum),
      works, cost,
      net: works - cost,
      margin: works ? (works - cost) / works : null,
      pct: scope ? sum((p) => p.works) / scope : null,
      certified: sum((p) => p.certified),
      paid: sum((p) => p.paid_gross),
      unpaid: sum((p) => p.certified_not_paid),
      retention: sum((p) => p.retention_held),
      oldestUnpaid: oldest.length ? Math.max(...oldest) : null,
      overdue: projects.filter((p) => p.schedule.status === 'overdue').length,
    }
  }, [projects])

  // period columns, shared by the trend chart and the site matrix
  const { periods, byProject, totalsByPeriod, trend } = useMemo(() => {
    const order: string[] = []
    const seen = new Set<string>()
    const cell = new Map<string, number>()          // `${projectId}|${period}`
    const totals = new Map<string, number>()
    const tr = new Map<string, { label: string; work: number; cost: number; net: number }>()
    for (const w of series) {
      const key = bucketKey(w, gran)
      if (!seen.has(key)) { seen.add(key); order.push(key) }
      const ck = `${w.project_id}|${key}`
      cell.set(ck, (cell.get(ck) ?? 0) + w.works_incl_vat)
      totals.set(key, (totals.get(key) ?? 0) + w.works_incl_vat)
      const b = tr.get(key) ?? { label: key, work: 0, cost: 0, net: 0 }
      b.work += w.works_incl_vat
      b.cost += w.cost
      b.net += w.net
      tr.set(key, b)
    }
    return {
      periods: order,
      byProject: cell,
      totalsByPeriod: totals,
      trend: order.map((k) => tr.get(k)!),
    }
  }, [series, gran])

  const sorted = useMemo(() => {
    const list = [...projects]
    if (sort === 'net') list.sort((a, b) => b.net - a.net)
    if (sort === 'margin') list.sort((a, b) => (b.margin ?? -Infinity) - (a.margin ?? -Infinity))
    if (sort === 'pct') list.sort((a, b) => (b.pct_complete ?? -1) - (a.pct_complete ?? -1))
    if (sort === 'unpaid') list.sort((a, b) => (b.certified_not_paid ?? 0) - (a.certified_not_paid ?? 0))
    if (sort === 'stale') list.sort((a, b) => (b.days_since_report ?? -1) - (a.days_since_report ?? -1))
    return list
  }, [projects, sort])

  // matrix rows grouped by state, exactly like the workbook's LOCATION column
  const grouped = useMemo(() => {
    const map = new Map<string, PortfolioProject[]>()
    for (const p of sorted) {
      const k = p.state_name || UNSET
      map.set(k, [...(map.get(k) ?? []), p])
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [sorted])

  const byState = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of projects) {
      const k = p.state_name || UNSET
      m.set(k, (m.get(k) ?? 0) + p.works_incl_vat)
    }
    return [...m.entries()].sort((a, b) => a[1] - b[1])
  }, [projects])

  const byType = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of projects) {
      const k = p.project_type || UNSET
      m.set(k, (m.get(k) ?? 0) + p.works_incl_vat)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [projects])

  if (isLoading) return <PageSkeleton />
  if (!data || all.length === 0) {
    return (
      <div className="rounded-lg border py-16 text-center text-muted-foreground">
        <p className="text-lg font-medium text-foreground">No reporting projects yet</p>
        <p className="mt-1 text-sm">
          The portfolio fills itself as sites start sending weekly reports.
        </p>
      </div>
    )
  }

  const filtered = fState !== ALL || fProject !== ALL

  // matrix totals are always the sum of the periods on screen, so every
  // row and the footer reconcile with the cells beside them
  const rowTotal = (id: string) =>
    periods.reduce((a, per) => a + (byProject.get(`${id}|${per}`) ?? 0), 0)
  const grandTotal = [...totalsByPeriod.values()].reduce((a, v) => a + v, 0)

  const trendOption = {
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => naira(v) },
    legend: { data: ['Work done (Incl. VAT)', 'Cost', 'Net'], bottom: 0 },
    grid: { left: 64, right: 16, top: 20, bottom: 42 },
    xAxis: { type: 'category', data: trend.map((b) => b.label) },
    yAxis: { type: 'value', axisLabel: { formatter: compactNaira } },
    series: [
      { name: 'Work done (Incl. VAT)', type: 'bar', data: trend.map((b) => Math.round(b.work)), itemStyle: { color: COLOR_WORK } },
      { name: 'Cost', type: 'bar', data: trend.map((b) => Math.round(b.cost)), itemStyle: { color: COLOR_COST } },
      { name: 'Net', type: 'line', data: trend.map((b) => Math.round(b.net)), itemStyle: { color: COLOR_NET }, lineStyle: { width: 2.5 } },
    ],
  }

  const stateOption = {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => naira(v) },
    grid: { left: 8, right: 56, top: 10, bottom: 10, containLabel: true },
    xAxis: { type: 'value', axisLabel: { formatter: compactNaira } },
    yAxis: { type: 'category', data: byState.map(([k]) => k) },
    series: [{
      type: 'bar',
      data: byState.map(([, v]) => Math.round(v)),
      itemStyle: { color: COLOR_WORK, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', formatter: (p: { value: number }) => compactNaira(p.value) },
    }],
  }

  const typeOption = {
    tooltip: { trigger: 'item', valueFormatter: (v: number) => naira(v) },
    legend: { orient: 'vertical', right: 0, top: 'center', itemWidth: 10, itemHeight: 10 },
    series: [{
      type: 'pie',
      radius: ['45%', '72%'],
      center: ['38%', '50%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: '#fff', borderWidth: 2 },
      label: { formatter: '{d}%', fontSize: 11 },
      data: byType.map(([k, v], i) => ({
        name: k, value: Math.round(v),
        itemStyle: { color: TYPE_COLORS[i % TYPE_COLORS.length] },
      })),
    }],
  }

  const FilterSelect = ({ label, value, onChange, items, allLabel = 'All' }: {
    label: string
    value: string
    onChange: (v: string) => void
    items: Array<{ value: string; label: string }>
    allLabel?: string
  }) => (
    <div className="min-w-[9rem] flex-1">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-full text-xs font-semibold">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {items.map((i) => (
            <SelectItem key={i.value} value={i.value} className="capitalize">{i.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Executive summary</h1>
        <p className="text-sm text-muted-foreground">
          {t.count} active {t.count === 1 ? 'project' : 'projects'}
          {filtered ? ` of ${all.length}` : ''}
          {' · '}portfolio position as at {fmtDate(data.generated_at)}
        </p>
      </div>

      {/* filter bar — drives every number, chart and table below */}
      <Card className="relative">
        <Legend>Filters</Legend>
        <CardContent className="flex flex-wrap items-end gap-3 pt-4">
          <FilterSelect label="State" value={fState} onChange={setFState}
            items={options.states.map((s) => ({ value: s, label: s }))} />
          <FilterSelect label="Project" value={fProject} onChange={setFProject}
            allLabel="All projects"
            items={options.projects.map((p) => ({ value: p.id, label: p.name }))} />
          <div className="min-w-[9rem] flex-1">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Period</p>
            <Select value={gran} onValueChange={(v) => setGran(v as Granularity)}>
              <SelectTrigger className="h-8 w-full text-xs font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GRANS.map((g) => (
                  <SelectItem key={g.key} value={g.key}>{g.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {filtered && (
            <Button
              variant="outline" size="sm" className="h-8 text-xs"
              onClick={() => { setFState(ALL); setFProject(ALL) }}
            >
              Clear
            </Button>
          )}
        </CardContent>
      </Card>

      {/* where we stand */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Kpi label="Contract value" value={naira(t.contract, true)} sub={naira(t.contract)} />
        <Kpi label="Work done · to date" value={naira(t.works, true)}
          sub={`${pctFmt(t.pct)} of BEME scope`} />
        <Kpi label="Cost · to date" value={naira(t.cost, true)} sub={naira(t.cost)} />
        <Kpi label="Net · to date" value={naira(t.net, true)} sub={naira(t.net)}
          tone={t.net >= 0 ? 'good' : 'bad'} />
        <Kpi label="Margin · to date" value={pctFmt(t.margin)}
          tone={(t.margin ?? 0) < 0 ? 'bad' : 'good'} />
      </div>

      {/* what we're owed */}
      <Card className="relative">
        <Legend>Cash position</Legend>
        <CardContent className="grid gap-5 pt-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)]">
          <div className="relative rounded-lg border border-amber-300 bg-amber-50/60 p-4 dark:border-amber-700 dark:bg-amber-950/20">
            <LegendSm>Certified, not yet paid</LegendSm>
            <p className="text-3xl font-bold tabular-nums text-amber-900 dark:text-amber-200">
              {naira(t.unpaid, true)}
            </p>
            <p className="mt-0.5 text-xs tabular-nums text-amber-900/70 dark:text-amber-200/70">
              {naira(t.unpaid)}
            </p>
            {t.oldestUnpaid != null && (
              <p className="mt-2 text-xs font-medium text-amber-900 dark:text-amber-200">
                Longest wait since a payment landed: {num(t.oldestUnpaid)} days
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Certified" value={naira(t.certified, true)} />
            <Kpi label="Paid (gross)" value={naira(t.paid, true)} />
            <Kpi label="Retention held" value={naira(t.retention, true)} />
            <Kpi label="Overdue projects" value={String(t.overdue)}
              tone={t.overdue > 0 ? 'bad' : 'good'} />
          </div>
        </CardContent>
      </Card>

      {/* PW's own shape: sites down, periods across, output in the cells */}
      <Card className="relative">
        <Legend>Output by site</Legend>
        <CardContent className="p-0 pt-3">
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b text-muted-foreground">
                  <th className="sticky left-0 z-20 min-w-[220px] bg-background px-4 py-2 text-left font-medium">
                    Site
                  </th>
                  {periods.map((p) => (
                    <th key={p} className="whitespace-nowrap px-3 py-2 text-right font-medium">{p}</th>
                  ))}
                  <th className="whitespace-nowrap border-l px-4 py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(([state, rows]) => (
                  <Fragment key={state}>
                    <tr className="border-b bg-muted/40">
                      <td className="sticky left-0 bg-muted/40 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide"
                        colSpan={1}>
                        {state}
                      </td>
                      <td colSpan={periods.length + 1} />
                    </tr>
                    {rows.map((p) => (
                      <tr
                        key={p.id}
                        className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/30"
                        onClick={() => router.push(`/projects/${p.id}`)}
                      >
                        <td className="sticky left-0 z-10 max-w-[260px] truncate bg-background px-4 py-1.5 font-medium"
                          title={p.project_name}>
                          {p.short_name || p.project_name}
                        </td>
                        {periods.map((per) => {
                          const v = byProject.get(`${p.id}|${per}`) ?? 0
                          return (
                            <td key={per}
                              className={`px-3 py-1.5 text-right tabular-nums ${v === 0 ? 'text-muted-foreground/50' : ''}`}
                              title={v ? naira(v) : undefined}>
                              {cellMoney(v)}
                            </td>
                          )
                        })}
                        <td className="border-l px-4 py-1.5 text-right font-semibold tabular-nums"
                          title={naira(rowTotal(p.id))}>
                          {cellMoney(rowTotal(p.id))}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-background">
                <tr className="border-t-2 border-foreground font-bold">
                  <td className="sticky left-0 bg-background px-4 py-2">Total</td>
                  {periods.map((per) => (
                    <td key={per} className="px-3 py-2 text-right tabular-nums"
                      title={naira(totalsByPeriod.get(per) ?? 0)}>
                      {cellMoney(totalsByPeriod.get(per) ?? 0)}
                    </td>
                  ))}
                  <td className="border-l px-4 py-2 text-right tabular-nums" title={naira(grandTotal)}>
                    {cellMoney(grandTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
            Work done Incl. VAT · totals are the sum of the periods shown · hover any cell for the full figure
          </p>
        </CardContent>
      </Card>

      {/* the two breakdowns */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="relative">
          <Legend>Work done by state</Legend>
          <CardContent className="pt-3">
            <ECharts option={stateOption} style={{ height: Math.max(200, byState.length * 46 + 40) }} notMerge />
          </CardContent>
        </Card>
        <Card className="relative">
          <Legend>Work done by project type</Legend>
          <CardContent className="pt-3">
            <ECharts option={typeOption} style={{ height: Math.max(200, byType.length * 46 + 40) }} notMerge />
          </CardContent>
        </Card>
      </div>

      {/* the portfolio over time */}
      <Card className="relative">
        <Legend>Portfolio · work done vs cost</Legend>
        <CardContent className="pt-3">
          <ECharts option={trendOption} style={{ height: 300 }} notMerge />
        </CardContent>
      </Card>

      {/* the projects themselves */}
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
                {sorted.map((p) => (
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

function PageSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-24" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-40" />
      <Skeleton className="h-80" />
      <Skeleton className="h-64" />
    </div>
  )
}
