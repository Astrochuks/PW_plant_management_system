'use client'

/**
 * Executive summary — the portfolio landing page, built for one job:
 * comparing projects over a chosen window.
 *
 * The Period filter is a TIME WINDOW — "To date" (default) or a single
 * year — and it scopes EVERY figure on the page: the KPI strip, the
 * site × period output matrix (PW's own "General Summary Per Site
 * Output" shape), the breakdowns, the trend, and the projects table.
 * "To date" compares by year; drill into a year to compare by month.
 *
 * Every figure is the project-level figure summed up — this page and a
 * project hub can never disagree.
 */

import { Fragment, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Kpi, Legend, LegendSm } from '@/components/projects/hub-ui'
import { useExecutiveSummary } from '@/hooks/use-projects'
import type { PortfolioProject, PortfolioWeek } from '@/hooks/use-projects'
import { naira, num, pctFmt, fmtDate } from '@/lib/format'

const ALL = '__all__'
const TO_DATE = 'todate'
const UNSET = '— unassigned —'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// To date → compare by YEAR; a single year → compare by MONTH
function bucketKey(w: PortfolioWeek, window: string): string {
  if (window === TO_DATE) return String(w.year)
  const d = new Date(w.week_ending_date + 'T00:00:00')
  return MONTHS[d.getMonth()]
}

// order of the matrix columns for a window
function bucketOrder(window: string, present: Set<string>): string[] {
  if (window === TO_DATE) return [...present].sort()
  return MONTHS.filter((m) => present.has(m))
}

// cells stay readable at portfolio scale — full naira lives in the tooltip
const cellMoney = (v: number) =>
  v === 0 ? '—'
    : Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}m`
      : `${(v / 1_000).toFixed(0)}k`

interface Win { work: number; cost: number; net: number }
type Row = PortfolioProject & { win: Win; winMargin: number | null }

export default function ExecutiveSummaryPage() {
  const router = useRouter()
  const { data, isLoading } = useExecutiveSummary()
  // default to the current year; the guard below falls back if it has no data
  const [period, setPeriod] = useState<string>(() => String(new Date().getFullYear()))
  const [sort, setSort] = useState<'net' | 'work' | 'cost' | 'margin' | 'pct' | 'unpaid'>('work')
  const [fState, setFState] = useState(ALL)
  const [fProject, setFProject] = useState(ALL)

  // the executive summary is the LIVE portfolio — active projects only
  const all = useMemo(
    () => (data?.projects ?? []).filter((p) => p.status === 'active'),
    [data],
  )

  // State narrows the pool; the Project drill-down lists only what
  // survives it, so its options cascade from the State choice.
  const scoped = useMemo(() => all.filter((p) =>
    fState === ALL || (p.state_name || UNSET) === fState
  ), [all, fState])

  const years = useMemo(
    () => [...new Set((data?.series ?? []).map((w) => w.year))].sort((a, b) => b - a),
    [data],
  )

  const options = useMemo(() => {
    const uniq = (vals: Array<string | null>) =>
      [...new Set(vals.map((v) => v || UNSET))].sort()
    return {
      states: uniq(all.map((p) => p.state_name)),
      projects: scoped
        .map((p) => ({ id: p.id, name: p.short_name || p.project_name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }
  }, [all, scoped])

  useEffect(() => {
    if (fProject !== ALL && !scoped.some((p) => p.id === fProject)) setFProject(ALL)
  }, [scoped, fProject])

  // if the current-year default (or any year) has no data, fall back to
  // the latest year that does — never leave the page on an empty window
  useEffect(() => {
    if (period !== TO_DATE && years.length > 0 && !years.includes(Number(period))) {
      setPeriod(String(years[0]))
    }
  }, [years, period])

  const projects = useMemo(
    () => scoped.filter((p) => fProject === ALL || p.id === fProject),
    [scoped, fProject],
  )

  // the window's per-project rows + the shared period columns
  const { rows, periods, byProject, totalsByPeriod, totals } = useMemo(() => {
    const ids = new Set(projects.map((p) => p.id))
    const cumulative = period === TO_DATE
    const yearNum = cumulative ? null : Number(period)

    const scopedSeries = (data?.series ?? []).filter((w) => ids.has(w.project_id))
    // the series only holds reported weekly MOVEMENT; a project's true
    // to-date includes work executed before its first uploaded week
    const winSeries = scopedSeries.filter((w) => cumulative || w.year === yearNum)

    // per-project reported movement inside the window
    const move = new Map<string, Win>()
    for (const w of winSeries) {
      const m = move.get(w.project_id) ?? { work: 0, cost: 0, net: 0 }
      m.work += w.works_incl_vat; m.cost += w.cost; m.net += w.net
      move.set(w.project_id, m)
    }

    // To date → the project's own cumulative totals (movement + baseline
    // + gap adjustments, kobo-exact with the hub). A year → its movement.
    const rows: Row[] = projects.map((p) => {
      const m = move.get(p.id) ?? { work: 0, cost: 0, net: 0 }
      const win: Win = cumulative
        ? { work: p.works_incl_vat, cost: p.cost, net: p.net }
        : m
      return { ...p, win, winMargin: win.work ? win.net / win.work : null }
    })

    // matrix cells + period columns (movement per bucket)
    const present = new Set<string>()
    const cell = new Map<string, number>()          // `${projectId}|${bucket}`
    const byPeriod = new Map<string, number>()
    for (const w of winSeries) {
      const key = bucketKey(w, period)
      present.add(key)
      const ck = `${w.project_id}|${key}`
      cell.set(ck, (cell.get(ck) ?? 0) + w.works_incl_vat)
      byPeriod.set(key, (byPeriod.get(key) ?? 0) + w.works_incl_vat)
    }
    let cols = bucketOrder(period, present)

    // To date: a leading "Prior" column carries pre-reporting work, so
    // each row's Prior + years reconciles to its true cumulative total
    if (cumulative) {
      let anyPrior = false
      for (const p of projects) {
        const m = move.get(p.id) ?? { work: 0, cost: 0, net: 0 }
        const prior = p.works_incl_vat - m.work
        if (Math.abs(prior) > 1) {
          cell.set(`${p.id}|Prior`, prior)
          byPeriod.set('Prior', (byPeriod.get('Prior') ?? 0) + prior)
          anyPrior = true
        }
      }
      if (anyPrior) cols = ['Prior', ...cols]
    }

    const sum = (f: (r: Row) => number | null | undefined) =>
      rows.reduce((a, r) => a + (f(r) ?? 0), 0)
    const work = sum((r) => r.win.work)
    const cost = sum((r) => r.win.cost)
    const scope = sum((r) => r.scope)
    const oldest = rows
      .filter((r) => r.certified_not_paid && r.days_since_payment != null)
      .map((r) => r.days_since_payment as number)

    return {
      rows,
      periods: cols,
      byProject: cell,
      totalsByPeriod: byPeriod,
      totals: {
        count: rows.length,
        contract: sum((r) => r.contract_sum),
        work, cost, net: work - cost,
        margin: work ? (work - cost) / work : null,
        pct: scope ? sum((r) => r.works) / scope : null,   // % complete stays cumulative
        certified: sum((r) => r.certified),
        paid: sum((r) => r.paid_gross),
        unpaid: sum((r) => r.certified_not_paid),
        retention: sum((r) => r.retention_held),
        oldestUnpaid: oldest.length ? Math.max(...oldest) : null,
        overdue: rows.filter((r) => r.schedule.status === 'overdue').length,
      },
    }
  }, [data, projects, period])

  const sorted = useMemo(() => {
    const list = [...rows]
    if (sort === 'work') list.sort((a, b) => b.win.work - a.win.work)
    if (sort === 'cost') list.sort((a, b) => b.win.cost - a.win.cost)
    if (sort === 'net') list.sort((a, b) => b.win.net - a.win.net)
    if (sort === 'margin') list.sort((a, b) => (b.winMargin ?? -Infinity) - (a.winMargin ?? -Infinity))
    if (sort === 'pct') list.sort((a, b) => (b.pct_complete ?? -1) - (a.pct_complete ?? -1))
    if (sort === 'unpaid') list.sort((a, b) => (b.certified_not_paid ?? 0) - (a.certified_not_paid ?? 0))
    return list
  }, [rows, sort])

  // matrix rows grouped by state, like the workbook's LOCATION column
  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>()
    for (const r of sorted) {
      const k = r.state_name || UNSET
      map.set(k, [...(map.get(k) ?? []), r])
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [sorted])

  if (isLoading) return <PageSkeleton />
  if (!data || all.length === 0) {
    return (
      <div className="rounded-lg border py-16 text-center text-muted-foreground">
        <p className="text-lg font-medium text-foreground">No active projects yet</p>
        <p className="mt-1 text-sm">
          The portfolio fills itself as projects are created and start reporting.
        </p>
      </div>
    )
  }

  const t = totals
  const winLabel = period === TO_DATE ? 'to date' : period
  const filtered = fState !== ALL || fProject !== ALL
  // every money card says what it is summed across, honouring the filter
  const scopeName = fProject !== ALL ? 'this project'
    : fState !== ALL ? `${fState}` : 'the portfolio'
  const across = t.count === 1
    ? (fProject !== ALL ? '1 project' : `across ${scopeName}`)
    : `across ${t.count} projects`
  const acrossLabel = fProject !== ALL ? 'the drill-down'
    : fState !== ALL ? `in ${fState}` : 'all active'

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
        <SelectTrigger className="h-9 w-full text-xs font-semibold">
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
          Comparing {t.count} active {t.count === 1 ? 'project' : 'projects'}
          {filtered ? ` of ${all.length}` : ''}
          {' · '}{period === TO_DATE ? 'all time to date' : `year ${period}`}
          {' · '}as at {fmtDate(data.generated_at)}
        </p>
      </div>

      {/* filter bar — State · Project · Period(window) drive everything */}
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
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="h-9 w-full text-xs font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TO_DATE}>To date</SelectItem>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(filtered || period !== TO_DATE) && (
            <Button
              variant="outline" size="sm" className="h-9 text-xs"
              onClick={() => { setFState(ALL); setFProject(ALL); setPeriod(TO_DATE) }}
            >
              Clear
            </Button>
          )}
        </CardContent>
      </Card>

      {/* where we stand — all metrics scoped to the window, and every
          money card says what it is summed across */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Projects" value={String(t.count)}
          sub={filtered ? `of ${all.length} active` : `active ${all.length === 1 ? 'project' : 'projects'}`}
          lineage={acrossLabel} />
        <Kpi label="Contract value" value={naira(t.contract, true)} sub={naira(t.contract)}
          lineage={across} />
        <Kpi label={`Work done · ${winLabel}`} value={naira(t.work, true)}
          sub={period === TO_DATE ? `${pctFmt(t.pct)} of BEME scope` : naira(t.work)}
          lineage={across} />
        <Kpi label={`Cost · ${winLabel}`} value={naira(t.cost, true)} sub={naira(t.cost)}
          lineage={across} />
        <Kpi label={`Net · ${winLabel}`} value={naira(t.net, true)} sub={naira(t.net)}
          tone={t.net >= 0 ? 'good' : 'bad'} lineage={across} />
        <Kpi label={`Margin · ${winLabel}`} value={pctFmt(t.margin)}
          tone={(t.margin ?? 0) < 0 ? 'bad' : 'good'} lineage={across} />
      </div>

      {/* what we're owed — a current snapshot (cumulative ledgers) */}
      <Card className="relative">
        <Legend>Cash position · to date</Legend>
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
        <Legend>Output by site · {winLabel}</Legend>
        <CardContent className="p-0 pt-3">
          {periods.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No output recorded in this window.
            </p>
          ) : (
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
                  {grouped.map(([state, rs]) => (
                    <Fragment key={state}>
                      <tr className="border-b bg-muted/40">
                        <td className="sticky left-0 z-10 bg-muted/40 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide">
                          {state}
                        </td>
                        <td colSpan={periods.length + 1} className="bg-muted/40" />
                      </tr>
                      {rs.map((p) => (
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
                                className={`px-3 py-1.5 text-right tabular-nums ${v === 0 ? 'text-muted-foreground/40' : ''}`}
                                title={v ? naira(v) : undefined}>
                                {cellMoney(v)}
                              </td>
                            )
                          })}
                          <td className="border-l px-4 py-1.5 text-right font-semibold tabular-nums"
                            title={naira(p.win.work)}>
                            {cellMoney(p.win.work)}
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
                    <td className="border-l px-4 py-2 text-right tabular-nums" title={naira(t.work)}>
                      {cellMoney(t.work)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
            Work done Incl. VAT · hover any cell for the full figure
          </p>
        </CardContent>
      </Card>

      {/* the projects themselves — every metric per project, for the window */}
      <Card className="relative">
        <Legend>Projects · {winLabel}</Legend>
        <CardContent className="p-0 pt-2">
          <div className="flex justify-end px-4 pb-2">
            <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
              <SelectTrigger className="h-8 w-48 text-xs font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="work">Work done</SelectItem>
                <SelectItem value="cost">Cost</SelectItem>
                <SelectItem value="net">Net earned</SelectItem>
                <SelectItem value="margin">Margin</SelectItem>
                <SelectItem value="pct">% complete</SelectItem>
                <SelectItem value="unpaid">Certified, not paid</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Project</th>
                  <th className="px-4 py-2 text-right font-medium">% Complete</th>
                  <th className="px-4 py-2 text-right font-medium">Work done</th>
                  <th className="px-4 py-2 text-right font-medium">Cost</th>
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
                      {p.state_name && (
                        <span className="ml-1.5 text-[10px] text-muted-foreground">{p.state_name}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{pctFmt(p.pct_complete)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{naira(p.win.work)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{naira(p.win.cost)}</td>
                    <td className={`px-4 py-2 text-right tabular-nums font-medium ${p.win.net < 0 ? 'text-red-600' : ''}`}>
                      {naira(p.win.net)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{pctFmt(p.winMargin)}</td>
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
          <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
            Work, cost, net and margin are for {period === TO_DATE ? 'all time to date' : period}
            {' · '}% complete and not-yet-paid are cumulative
          </p>
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
