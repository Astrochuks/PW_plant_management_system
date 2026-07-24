'use client'

/**
 * Executive summary — the project comparison page. Tables and cards only.
 *
 * State + Project filters scope the whole page. Then:
 *  · a headline card strip (to date)
 *  · the Projects table — every metric per project, to-date AND this-year
 *    side by side, plus certificates, payments and schedule
 *  · the period matrices — site output (work Incl. VAT), cost, and cost
 *    by category — each site/category down the side, periods across the
 *    top, on a shared Year + granularity lens (PW's site-output shape)
 *
 * Every figure is the project-level figure summed up.
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
import type { PortfolioProject } from '@/hooks/use-projects'
import { naira, nairaM, num, pctFmt, fmtDate } from '@/lib/format'

type Gran = 'week' | 'month' | 'quarter' | 'year'
type Unit = 'm' | 'full'

const GRANS: Array<{ key: Gran; label: string }> = [
  { key: 'week', label: 'Weekly' },
  { key: 'month', label: 'Monthly' },
  { key: 'quarter', label: 'Quarterly' },
  { key: 'year', label: 'Yearly' },
]

const ALL = '__all__'
const UNSET = '— unassigned —'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const CURRENT_YEAR = new Date().getFullYear()

function bucketOf(year: number, week: number, ending: string, g: Gran, singleYear: boolean): string {
  const d = new Date(ending + 'T00:00:00')
  const q = Math.floor(d.getMonth() / 3) + 1
  if (g === 'week') return singleYear ? `W${String(week).padStart(2, '0')}` : `${year} W${String(week).padStart(2, '0')}`
  if (g === 'month') return singleYear ? MONTHS[d.getMonth()] : `${MONTHS[d.getMonth()]} ${year}`
  if (g === 'quarter') return singleYear ? `Q${q}` : `Q${q} ${year}`
  return String(year)
}

interface SeriesLike {
  project_id: string; year: number; week_number: number; week_ending_date: string
}

export default function ExecutiveSummaryPage() {
  const router = useRouter()
  const { data, isLoading } = useExecutiveSummary()
  const [fState, setFState] = useState(ALL)
  const [fProject, setFProject] = useState(ALL)
  const [sort, setSort] = useState<'workTd' | 'costTd' | 'netTd' | 'marginTd' | 'pct' | 'unpaid' | 'workYr'>('workTd')

  // shared lens for the three matrices
  const [matYear, setMatYear] = useState<string>(ALL)
  const [matGran, setMatGran] = useState<Gran>('month')

  // ₦m / Full money toggle — drives every figure in the tables & matrices.
  // Defaults to Full (show every digit); ₦ millions is the compact option.
  const [unit, setUnitState] = useState<Unit>('full')
  useEffect(() => {
    const v = localStorage.getItem('exec-money-unit')
    if (v === 'm' || v === 'full') setUnitState(v)
  }, [])
  const setUnit = (v: Unit) => { setUnitState(v); localStorage.setItem('exec-money-unit', v) }
  // dense-cell formatter (plain number; the toggle button carries the unit)
  const fm = (v: number | null | undefined) =>
    v == null || v === 0 ? '—'
      : unit === 'm' ? nairaM(v) : Math.round(v).toLocaleString('en-NG')

  const all = useMemo(
    () => (data?.projects ?? []).filter((p) => p.status === 'active'),
    [data],
  )

  const scoped = useMemo(() => all.filter((p) =>
    fState === ALL || (p.state_name || UNSET) === fState
  ), [all, fState])

  const years = useMemo(
    () => [...new Set((data?.series ?? []).map((w) => w.year))].sort((a, b) => b - a),
    [data],
  )

  const options = useMemo(() => {
    const uniqStates = [...new Set(all.map((p) => p.state_name || UNSET))].sort()
    return {
      states: uniqStates,
      projects: scoped
        .map((p) => ({ id: p.id, name: p.short_name || p.project_name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }
  }, [all, scoped])

  useEffect(() => {
    if (fProject !== ALL && !scoped.some((p) => p.id === fProject)) setFProject(ALL)
  }, [scoped, fProject])

  const projects = useMemo(
    () => scoped.filter((p) => fProject === ALL || p.id === fProject),
    [scoped, fProject],
  )
  const ids = useMemo(() => new Set(projects.map((p) => p.id)), [projects])

  // ── this-year movement per project (from the weekly series) ──────────
  const thisYear = useMemo(() => {
    const m = new Map<string, { work: number; cost: number; net: number }>()
    for (const w of data?.series ?? []) {
      if (!ids.has(w.project_id) || w.year !== CURRENT_YEAR) continue
      const t = m.get(w.project_id) ?? { work: 0, cost: 0, net: 0 }
      t.work += w.works_incl_vat; t.cost += w.cost; t.net += w.net
      m.set(w.project_id, t)
    }
    return m
  }, [data, ids])

  // ── headline totals (to date) ────────────────────────────────────────
  const t = useMemo(() => {
    const sum = (f: (p: PortfolioProject) => number | null | undefined) =>
      projects.reduce((a, p) => a + (f(p) ?? 0), 0)
    const work = sum((p) => p.works_incl_vat)
    const cost = sum((p) => p.cost)
    const scope = sum((p) => p.scope)
    const oldest = projects
      .filter((p) => p.certified_not_paid && p.days_since_payment != null)
      .map((p) => p.days_since_payment as number)
    return {
      count: projects.length,
      contract: sum((p) => p.contract_sum),
      work, cost, net: work - cost,
      margin: work ? (work - cost) / work : null,
      pct: scope ? sum((p) => p.works) / scope : null,
      certified: sum((p) => p.certified),
      paid: sum((p) => p.paid_gross),
      unpaid: sum((p) => p.certified_not_paid),
      retention: sum((p) => p.retention_held),
      oldestUnpaid: oldest.length ? Math.max(...oldest) : null,
      overdue: projects.filter((p) => p.schedule.status === 'overdue').length,
    }
  }, [projects])

  const rows = useMemo(() => {
    const list = projects.map((p) => ({ p, yr: thisYear.get(p.id) ?? { work: 0, cost: 0, net: 0 } }))
    const key = {
      workTd: (x: typeof list[0]) => x.p.works_incl_vat,
      costTd: (x: typeof list[0]) => x.p.cost,
      netTd: (x: typeof list[0]) => x.p.net,
      marginTd: (x: typeof list[0]) => x.p.margin ?? -Infinity,
      pct: (x: typeof list[0]) => x.p.pct_complete ?? -1,
      unpaid: (x: typeof list[0]) => x.p.certified_not_paid ?? 0,
      workYr: (x: typeof list[0]) => x.yr.work,
    }[sort]
    return [...list].sort((a, b) => key(b) - key(a))
  }, [projects, thisYear, sort])

  // ── the period matrices (shared lens) ────────────────────────────────
  const singleYear = matYear !== ALL
  const yearNum = singleYear ? Number(matYear) : null

  const inLens = <T extends SeriesLike>(w: T) => ids.has(w.project_id) && (!singleYear || w.year === yearNum)

  const periods = useMemo(() => {
    const order: string[] = []
    const seen = new Set<string>()
    for (const w of data?.series ?? []) {
      if (!inLens(w)) continue
      const k = bucketOf(w.year, w.week_number, w.week_ending_date, matGran, singleYear)
      if (!seen.has(k)) { seen.add(k); order.push(k) }
    }
    return order
  }, [data, ids, matGran, singleYear, yearNum])

  // work + cost matrices: value per (project, bucket)
  const siteMatrix = useMemo(() => {
    const work = new Map<string, number>()
    const cost = new Map<string, number>()
    const workCol = new Map<string, number>()
    const costCol = new Map<string, number>()
    for (const w of data?.series ?? []) {
      if (!inLens(w)) continue
      const k = bucketOf(w.year, w.week_number, w.week_ending_date, matGran, singleYear)
      const wk = `${w.project_id}|${k}`
      work.set(wk, (work.get(wk) ?? 0) + w.works_incl_vat)
      cost.set(wk, (cost.get(wk) ?? 0) + w.cost)
      workCol.set(k, (workCol.get(k) ?? 0) + w.works_incl_vat)
      costCol.set(k, (costCol.get(k) ?? 0) + w.cost)
    }
    return { work, cost, workCol, costCol }
  }, [data, ids, matGran, singleYear, yearNum])

  // the company's cost taxonomy — a stable axis (all categories that
  // exist in the data, ordered by overall spend), so every one shows even
  // when its movement rounds to zero in the chosen window (e.g. Sub
  // Contractors, whose spend lives mostly in the pre-reporting baseline)
  const allCats = useMemo(() => {
    const tot = new Map<string, number>()
    for (const c of data?.cost_series ?? []) tot.set(c.category, (tot.get(c.category) ?? 0) + c.amount)
    return [...tot.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)
  }, [data])

  // cost-category matrix: rows are categories
  const catMatrix = useMemo(() => {
    const cell = new Map<string, number>()          // `${category}|${bucket}`
    const rowTotal = new Map<string, number>()
    const colTotal = new Map<string, number>()
    for (const c of data?.cost_series ?? []) {
      if (!inLens(c)) continue
      const k = bucketOf(c.year, c.week_number, c.week_ending_date, matGran, singleYear)
      const ck = `${c.category}|${k}`
      cell.set(ck, (cell.get(ck) ?? 0) + c.amount)
      rowTotal.set(c.category, (rowTotal.get(c.category) ?? 0) + c.amount)
      colTotal.set(k, (colTotal.get(k) ?? 0) + c.amount)
    }
    return { cell, rowTotal, colTotal }
  }, [data, ids, matGran, singleYear, yearNum])

  // site × category cost (no time axis — uses the Year, ignores granularity)
  const siteCat = useMemo(() => {
    const cell = new Map<string, number>()          // `${projectId}|${category}`
    const catTotal = new Map<string, number>()
    const projTotal = new Map<string, number>()
    for (const c of data?.cost_series ?? []) {
      if (!ids.has(c.project_id) || (singleYear && c.year !== yearNum)) continue
      const ck = `${c.project_id}|${c.category}`
      cell.set(ck, (cell.get(ck) ?? 0) + c.amount)
      catTotal.set(c.category, (catTotal.get(c.category) ?? 0) + c.amount)
      projTotal.set(c.project_id, (projTotal.get(c.project_id) ?? 0) + c.amount)
    }
    return { cell, catTotal, projTotal }
  }, [data, ids, singleYear, yearNum])

  // sites grouped by state (shared by the work + cost matrices)
  const groups = useMemo(() => {
    const map = new Map<string, PortfolioProject[]>()
    for (const p of rows.map((r) => r.p)) {
      const k = p.state_name || UNSET
      map.set(k, [...(map.get(k) ?? []), p])
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows])

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

  const filtered = fState !== ALL || fProject !== ALL
  const scopeName = fProject !== ALL ? 'this project'
    : fState !== ALL ? `${fState}` : 'the portfolio'
  const across = t.count === 1
    ? (fProject !== ALL ? '1 project' : `across ${scopeName}`)
    : `across ${t.count} projects`
  const acrossLabel = fProject !== ALL ? 'the drill-down'
    : fState !== ALL ? `in ${fState}` : 'all active'
  const lensLabel = singleYear ? matYear : 'all years'

  const money = (v: number | null | undefined) =>
    <span title={v != null ? naira(v) : undefined}>{fm(v)}</span>

  return (
    <div className="space-y-5">
      {/* sticky header + control bar — State/Project (left), Year/Gran
          (middle), figures toggle (right); scrolls under the app header */}
      <div className="sticky top-16 z-20 -mx-6 space-y-3 border-b bg-background/95 px-6 pb-3 pt-1 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[1.7rem] font-bold leading-none tracking-tight">Executive summary</h1>
          <span className="hidden text-xs text-muted-foreground sm:inline">as at {fmtDate(data.generated_at)}</span>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 rounded-xl border bg-card px-4 py-3 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <FilterSelect label="State" value={fState} onChange={setFState}
              items={options.states.map((s) => ({ value: s, label: s }))} />
            <FilterSelect label="Project" value={fProject} onChange={setFProject}
              allLabel="All projects"
              items={options.projects.map((p) => ({ value: p.id, label: p.name }))} />
            {filtered && (
              <Button variant="ghost" size="sm" className="h-9 text-xs text-muted-foreground"
                onClick={() => { setFState(ALL); setFProject(ALL) }}>
                Clear
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <BarSelect label="Year" value={matYear} onValueChange={setMatYear}>
              <SelectItem value={ALL}>All years</SelectItem>
              {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </BarSelect>
            <BarSelect label="Granularity" value={matGran} onValueChange={(v) => setMatGran(v as Gran)}>
              {GRANS.map((g) => <SelectItem key={g.key} value={g.key}>{g.label}</SelectItem>)}
            </BarSelect>
          </div>

          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Figures</p>
            <span className="inline-flex h-9 overflow-hidden rounded-md border bg-card text-[11px] font-bold shadow-sm">
              {(['m', 'full'] as const).map((u) => (
                <button key={u} type="button" onClick={() => setUnit(u)}
                  className={`px-3 transition-colors ${
                    unit === u ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                  }`}>
                  {u === 'm' ? '₦m' : 'Full'}
                </button>
              ))}
            </span>
          </div>
        </div>
      </div>

      <SectionHeader aside="to date">Portfolio position</SectionHeader>

      {/* headline — to date */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Projects" value={String(t.count)}
          sub={filtered ? `of ${all.length} active` : `active ${all.length === 1 ? 'project' : 'projects'}`}
          lineage={acrossLabel} />
        <Kpi label="Contract value" value={naira(t.contract, true)} sub={naira(t.contract)} lineage={across} />
        <Kpi label="Work done · to date" value={naira(t.work, true)}
          sub={`${pctFmt(t.pct)} of BEME scope`} lineage={across} />
        <Kpi label="Cost · to date" value={naira(t.cost, true)} sub={naira(t.cost)} lineage={across} />
        <Kpi label="Net · to date" value={naira(t.net, true)} sub={naira(t.net)}
          tone={t.net >= 0 ? 'good' : 'bad'} lineage={across} />
        <Kpi label="Margin · to date" value={pctFmt(t.margin)}
          tone={(t.margin ?? 0) < 0 ? 'bad' : 'good'} lineage={across} />
      </div>

      {/* cash — a current snapshot */}
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

      {/* THE comparison table — every metric per project */}
      <Card className="relative">
        <Legend>Projects</Legend>
        <CardContent className="p-0 pt-2">
          <div className="flex items-center justify-end px-4 pb-2">
            <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
              <SelectTrigger className="h-8 w-52 text-xs font-semibold"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="workTd">Work done · to date</SelectItem>
                <SelectItem value="costTd">Cost · to date</SelectItem>
                <SelectItem value="netTd">Net · to date</SelectItem>
                <SelectItem value="marginTd">Margin · to date</SelectItem>
                <SelectItem value="pct">% complete</SelectItem>
                <SelectItem value="unpaid">Certified, not paid</SelectItem>
                <SelectItem value="workYr">{`Work done · ${CURRENT_YEAR}`}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th rowSpan={2} className="sticky left-0 z-10 min-w-[180px] bg-background px-4 py-2 text-left align-bottom font-medium">Project</th>
                  <th colSpan={5} className="border-l px-3 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide">To date</th>
                  <th colSpan={4} className="border-l px-3 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide">Certificates &amp; payments</th>
                  <th colSpan={4} className="border-l px-3 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide">{CURRENT_YEAR}</th>
                  <th colSpan={2} className="border-l px-3 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide">Status</th>
                </tr>
                <tr className="border-b text-left text-[11px] text-muted-foreground">
                  <th className="border-l px-3 py-1.5 text-right font-medium">% Compl.</th>
                  <th className="px-3 py-1.5 text-right font-medium">Work done</th>
                  <th className="px-3 py-1.5 text-right font-medium">Cost</th>
                  <th className="px-3 py-1.5 text-right font-medium">Net</th>
                  <th className="px-3 py-1.5 text-right font-medium">Margin</th>
                  <th className="border-l px-3 py-1.5 text-right font-medium">Certified</th>
                  <th className="px-3 py-1.5 text-right font-medium">Not paid</th>
                  <th className="px-3 py-1.5 text-right font-medium">Paid</th>
                  <th className="px-3 py-1.5 text-right font-medium">Retention</th>
                  <th className="border-l px-3 py-1.5 text-right font-medium">Work done</th>
                  <th className="px-3 py-1.5 text-right font-medium">Cost</th>
                  <th className="px-3 py-1.5 text-right font-medium">Net</th>
                  <th className="px-3 py-1.5 text-right font-medium">Margin</th>
                  <th className="border-l px-3 py-1.5 text-left font-medium">Schedule</th>
                  <th className="px-3 py-1.5 text-right font-medium">Latest</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, yr }) => {
                  const yrMargin = yr.work ? yr.net / yr.work : null
                  return (
                    <tr key={p.id}
                      className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/40"
                      onClick={() => router.push(`/projects/${p.id}`)}>
                      <td className="sticky left-0 z-10 max-w-[220px] truncate bg-background px-4 py-2 font-medium"
                        title={p.project_name}>
                        {p.short_name || p.project_name}
                        {p.state_name && <span className="ml-1.5 text-[10px] text-muted-foreground">{p.state_name}</span>}
                      </td>
                      <td className="border-l px-3 py-2 text-right tabular-nums">{pctFmt(p.pct_complete)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(p.works_incl_vat)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(p.cost)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${p.net < 0 ? 'text-red-600' : ''}`}>{money(p.net)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pctFmt(p.margin)}</td>
                      <td className="border-l px-3 py-2 text-right tabular-nums">{money(p.certified)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${p.certified_not_paid ? 'font-medium text-amber-700 dark:text-amber-400' : ''}`}>{money(p.certified_not_paid)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(p.paid_gross)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(p.retention_held)}</td>
                      <td className="border-l px-3 py-2 text-right tabular-nums">{money(yr.work)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(yr.cost)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${yr.net < 0 ? 'text-red-600' : ''}`}>{money(yr.net)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{yr.work ? pctFmt(yrMargin) : '—'}</td>
                      <td className="border-l px-3 py-2"><ScheduleChip status={p.schedule.status} months={p.schedule.months_overdue} /></td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className={p.days_since_report != null && p.days_since_report > 14 ? 'font-medium text-amber-700 dark:text-amber-400' : ''}>
                          {p.latest_week_ending ? fmtDate(p.latest_week_ending) : '—'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
            To-date, certificates and payments are cumulative · {CURRENT_YEAR} is this year&apos;s reported movement · hover any figure for the full amount
          </p>
        </CardContent>
      </Card>

      <SectionHeader aside={lensLabel}>Compare over time</SectionHeader>

      <SiteMatrix title={`Site output · work done (Incl. VAT) · ${lensLabel}`}
        groups={groups} periods={periods}
        cell={(id, per) => siteMatrix.work.get(`${id}|${per}`) ?? 0}
        rowTotalFromSeries={(id) => periods.reduce((a, per) => a + (siteMatrix.work.get(`${id}|${per}`) ?? 0), 0)}
        colTotal={(per) => siteMatrix.workCol.get(per) ?? 0}
        fmt={fm} onRow={(id) => router.push(`/projects/${id}`)} />

      <SiteMatrix title={`Site cost · ${lensLabel}`}
        groups={groups} periods={periods}
        cell={(id, per) => siteMatrix.cost.get(`${id}|${per}`) ?? 0}
        rowTotalFromSeries={(id) => periods.reduce((a, per) => a + (siteMatrix.cost.get(`${id}|${per}`) ?? 0), 0)}
        colTotal={(per) => siteMatrix.costCol.get(per) ?? 0}
        fmt={fm} onRow={(id) => router.push(`/projects/${id}`)} />

      {/* site × category cost cross-tab */}
      <SiteMatrix title={`Site cost by category · ${lensLabel}`}
        groups={groups} periods={allCats}
        cell={(id, cat) => siteCat.cell.get(`${id}|${cat}`) ?? 0}
        rowTotalFromSeries={(id) => siteCat.projTotal.get(id) ?? 0}
        colTotal={(cat) => siteCat.catTotal.get(cat) ?? 0}
        fmt={fm} onRow={(id) => router.push(`/projects/${id}`)}
        note="Total cost per category over the window · hover any cell for the full figure" />

      {/* cost by category */}
      <Card className="relative">
        <Legend>Cost by category · {lensLabel}</Legend>
        <CardContent className="p-0 pt-3">
          {periods.length === 0 || allCats.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">No cost recorded in this window.</p>
          ) : (
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-background">
                  <tr className="border-b text-muted-foreground">
                    <th className="sticky left-0 z-20 min-w-[180px] bg-background px-4 py-2 text-left font-medium">Category</th>
                    {periods.map((p) => <th key={p} className="whitespace-nowrap px-3 py-2 text-right font-medium">{p}</th>)}
                    <th className="whitespace-nowrap border-l px-4 py-2 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {allCats.map((c) => (
                    <tr key={c} className="border-b last:border-0">
                      <td className="sticky left-0 z-10 bg-background px-4 py-1.5 font-medium">{c}</td>
                      {periods.map((per) => {
                        const v = catMatrix.cell.get(`${c}|${per}`) ?? 0
                        return <td key={per} className={`px-3 py-1.5 text-right tabular-nums ${v === 0 ? 'text-muted-foreground/40' : ''}`} title={v ? naira(v) : undefined}>{fm(v)}</td>
                      })}
                      <td className="border-l px-4 py-1.5 text-right font-semibold tabular-nums" title={naira(catMatrix.rowTotal.get(c) ?? 0)}>{fm(catMatrix.rowTotal.get(c) ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0 bg-background">
                  <tr className="border-t-2 border-foreground font-bold">
                    <td className="sticky left-0 bg-background px-4 py-2">Total</td>
                    {periods.map((per) => <td key={per} className="px-3 py-2 text-right tabular-nums" title={naira(catMatrix.colTotal.get(per) ?? 0)}>{fm(catMatrix.colTotal.get(per) ?? 0)}</td>)}
                    <td className="border-l px-4 py-2 text-right tabular-nums" title={naira(t.cost)}>
                      {fm([...catMatrix.rowTotal.values()].reduce((a, v) => a + v, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
            Cost per category per period · hover any cell for the full figure
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

// ── the site × columns matrix (period or category) ─────────────────────
function SiteMatrix({ title, groups, periods, cell, rowTotalFromSeries, colTotal, fmt, onRow,
  note = 'Reported movement per period · hover any cell for the full figure' }: {
  title: string
  groups: Array<[string, PortfolioProject[]]>
  periods: string[]
  cell: (id: string, per: string) => number
  rowTotalFromSeries: (id: string) => number
  colTotal: (per: string) => number
  fmt: (v: number) => string
  onRow: (id: string) => void
  note?: string
}) {
  const grand = periods.reduce((a, per) => a + colTotal(per), 0)
  return (
    <Card className="relative">
      <Legend>{title}</Legend>
      <CardContent className="p-0 pt-3">
        {periods.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">No output recorded in this window.</p>
        ) : (
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b text-muted-foreground">
                  <th className="sticky left-0 z-20 min-w-[220px] bg-background px-4 py-2 text-left font-medium">Site</th>
                  {periods.map((p) => <th key={p} className="whitespace-nowrap px-3 py-2 text-right font-medium">{p}</th>)}
                  <th className="whitespace-nowrap border-l px-4 py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(([state, rs]) => (
                  <Fragment key={state}>
                    <tr className="border-b bg-muted/40">
                      <td className="sticky left-0 z-10 bg-muted/40 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide">{state}</td>
                      <td colSpan={periods.length + 1} className="bg-muted/40" />
                    </tr>
                    {rs.map((p) => (
                      <tr key={p.id} className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/30"
                        onClick={() => onRow(p.id)}>
                        <td className="sticky left-0 z-10 max-w-[260px] truncate bg-background px-4 py-1.5 font-medium" title={p.project_name}>
                          {p.short_name || p.project_name}
                        </td>
                        {periods.map((per) => {
                          const v = cell(p.id, per)
                          return <td key={per} className={`px-3 py-1.5 text-right tabular-nums ${v === 0 ? 'text-muted-foreground/40' : ''}`} title={v ? naira(v) : undefined}>{fmt(v)}</td>
                        })}
                        <td className="border-l px-4 py-1.5 text-right font-semibold tabular-nums" title={naira(rowTotalFromSeries(p.id))}>{fmt(rowTotalFromSeries(p.id))}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-background">
                <tr className="border-t-2 border-foreground font-bold">
                  <td className="sticky left-0 bg-background px-4 py-2">Total</td>
                  {periods.map((per) => <td key={per} className="px-3 py-2 text-right tabular-nums" title={naira(colTotal(per))}>{fmt(colTotal(per))}</td>)}
                  <td className="border-l px-4 py-2 text-right tabular-nums" title={naira(grand)}>{fmt(grand)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  )
}

function SectionHeader({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <h2 className="whitespace-nowrap text-sm font-semibold tracking-tight">{children}</h2>
      {aside && <span className="whitespace-nowrap text-xs text-muted-foreground">{aside}</span>}
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

function FilterSelect({ label, value, onChange, items, allLabel = 'All' }: {
  label: string
  value: string
  onChange: (v: string) => void
  items: Array<{ value: string; label: string }>
  allLabel?: string
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-40 text-xs font-semibold sm:w-44"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {items.map((i) => <SelectItem key={i.value} value={i.value} className="capitalize">{i.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

function BarSelect({ label, value, onValueChange, children }: {
  label: string
  value: string
  onValueChange: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="h-9 w-36 text-xs font-semibold"><SelectValue /></SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  )
}

function ScheduleChip({ status, months }: {
  status: 'overdue' | 'on_track' | 'completed' | null
  months: number | null
}) {
  if (status === 'overdue') {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-semibold text-red-600">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        Overdue{months != null ? ` · ${months.toFixed(1)}m` : ''}
      </span>
    )
  }
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Completed
      </span>
    )
  }
  if (status === 'on_track') {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />On track
      </span>
    )
  }
  return <span className="text-muted-foreground">—</span>
}

function PageSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-20" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
        {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-40" />
      <Skeleton className="h-72" />
      <Skeleton className="h-72" />
    </div>
  )
}
