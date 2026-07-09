'use client'

/**
 * Per-project operations drill-down: recomputed totals + week/month series.
 * Every figure is computed by our SQL from stored this-week facts — the
 * workbook's own Previous/To-Date columns are never used.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertCircle, CalendarRange, Droplets, HardHat, Search, Timer,
  TrendingDown, TrendingUp, Truck, Wallet,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  useProjectFinancials,
  useProjectOperationsSeries,
  useProjectOperationsSummary,
  useProjectPlantRollups,
  type FinancialWeek,
  type ProjectOperationsMonthRow,
  type ProjectOperationsWeekRow,
} from '@/hooks/use-projects'

const ngn = (v: number | null | undefined) =>
  v == null
    ? '—'
    : new Intl.NumberFormat('en-NG', {
        style: 'currency', currency: 'NGN', maximumFractionDigits: 0,
      }).format(v)

const num = (v: number | null | undefined, suffix = '') =>
  v == null ? '—' : `${new Intl.NumberFormat('en-NG').format(v)}${suffix}`

function StatCard({ icon: Icon, label, value, hint }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  hint?: string
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-lg bg-primary/10 p-2">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="truncate text-lg font-semibold tabular-nums">{value}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

/** Tiny horizontal bar scaled against the series max — no chart lib needed. */
function Bar({ value, max, className }: { value: number; max: number; className: string }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 shrink-0 rounded-full bg-muted sm:w-24">
        <div className={`h-1.5 rounded-full ${className}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums">{num(Math.round(value))}</span>
    </div>
  )
}

export function ProjectOperationsTab({ projectId }: { projectId: string }) {
  const [granularity, setGranularity] = useState<'week' | 'month'>('week')
  const { data: summary, isLoading, isError } = useProjectOperationsSummary(projectId)
  const { data: series, isLoading: seriesLoading } =
    useProjectOperationsSeries(projectId, granularity)

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }
  if (isError || !summary) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <AlertCircle className="h-4 w-4" />
        Could not load operations data — check the backend and try again.
      </div>
    )
  }

  const t = summary.totals
  if (!t.weeks_received) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No weekly reports ingested for this project yet. Upload them under
        Projects → Weekly Reports.
      </div>
    )
  }

  const snap = summary.latest_snapshot
  const certifiedPct =
    snap?.works_certified != null && snap?.current_contract_amount
      ? (snap.works_certified / snap.current_contract_amount) * 100
      : null
  const availability =
    t.hours_worked + t.breakdown_hours > 0
      ? (t.hours_worked / (t.hours_worked + t.breakdown_hours)) * 100
      : null

  const rows = series ?? []
  const maxHours = Math.max(...rows.map((r) => r.hours_worked), 1)
  const maxDiesel = Math.max(...rows.map((r) => r.diesel_litres), 1)
  const maxCost = Math.max(...rows.map((r) => r.plant_cost_ngn), 1)

  return (
    <div className="space-y-6">
      {/* Headline totals — all weeks received */}
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">
            Totals across {t.weeks_received} week{t.weeks_received !== 1 ? 's' : ''}
          </h3>
          {t.last_week_ending && (
            <Badge variant="outline" className="text-xs">
              last report w/e {new Date(t.last_week_ending).toLocaleDateString('en-NG', {
                day: '2-digit', month: 'short', year: 'numeric',
              })}
            </Badge>
          )}
          {summary.latest_pct?.beme_pct_complete != null && (
            <Badge variant="secondary" className="text-xs">
              {summary.latest_pct.beme_pct_complete.toFixed(1)}% complete (BEME, W
              {summary.latest_pct.week_number})
            </Badge>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={Timer} label="Hours worked" value={num(Math.round(t.hours_worked), ' hrs')} />
          <StatCard
            icon={AlertCircle} label="Breakdown hours"
            value={num(Math.round(t.breakdown_hours), ' hrs')}
            hint={availability != null ? `${availability.toFixed(1)}% availability` : undefined}
          />
          <StatCard icon={Droplets} label="Diesel used" value={num(Math.round(t.diesel_litres), ' L')} />
          <StatCard icon={Truck} label="Plant cost" value={ngn(t.plant_cost_ngn)} hint={`${t.fleet_count} plants on site`} />
          <StatCard
            icon={Wallet} label="Payments received"
            value={ngn(t.payments_net_ngn)}
            hint={`${t.payments_count} payments (latest ledger)`}
          />
          <StatCard
            icon={HardHat} label="Certificates"
            value={ngn(t.certificates_net_ngn)}
            hint={`${t.certificates_count} certificates`}
          />
          <StatCard
            icon={Wallet} label="Works certified"
            value={ngn(snap?.works_certified ?? null)}
            hint={certifiedPct != null ? `${certifiedPct.toFixed(1)}% of contract` : undefined}
          />
          <StatCard
            icon={CalendarRange} label="Contract sum"
            value={ngn(snap?.current_contract_amount ?? summary.project.current_contract_sum)}
          />
        </div>
      </div>

      {/* Certified progress bar */}
      {certifiedPct != null && (
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>Works certified vs contract</span>
            <span>{certifiedPct.toFixed(1)}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary"
              style={{ width: `${Math.min(100, certifiedPct)}%` }}
            />
          </div>
        </div>
      )}

      {/* Series */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="text-sm">
            {granularity === 'week' ? 'Week by week' : 'Month by month'}
          </CardTitle>
          <div className="flex rounded-md border p-0.5">
            {(['week', 'month'] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  granularity === g
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {g === 'week' ? 'Weekly' : 'Monthly'}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {seriesLoading ? (
            <Skeleton className="h-48" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{granularity === 'week' ? 'Week' : 'Month'}</TableHead>
                  <TableHead>Hours worked</TableHead>
                  <TableHead>B/D hrs</TableHead>
                  <TableHead>Diesel (L)</TableHead>
                  <TableHead>Plant cost</TableHead>
                  {granularity === 'week' && <TableHead>Plants</TableHead>}
                  {granularity === 'week' && <TableHead>Labour</TableHead>}
                  <TableHead>% complete</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const isWeek = 'week_number' in r
                  const w = r as ProjectOperationsWeekRow
                  const m = r as ProjectOperationsMonthRow
                  return (
                    <TableRow key={isWeek ? `${w.year}-W${w.week_number}` : m.month}>
                      <TableCell className="whitespace-nowrap font-medium">
                        {isWeek
                          ? `W${String(w.week_number).padStart(2, '0')} · ${new Date(
                              w.week_ending_date,
                            ).toLocaleDateString('en-NG', { day: '2-digit', month: 'short' })}`
                          : `${m.month} (${m.weeks_in_month} wks)`}
                      </TableCell>
                      <TableCell><Bar value={r.hours_worked} max={maxHours} className="bg-emerald-500" /></TableCell>
                      <TableCell className="tabular-nums">{num(Math.round(r.breakdown_hours))}</TableCell>
                      <TableCell><Bar value={r.diesel_litres} max={maxDiesel} className="bg-sky-500" /></TableCell>
                      <TableCell><Bar value={r.plant_cost_ngn} max={maxCost} className="bg-amber-500" /></TableCell>
                      {isWeek && <TableCell className="tabular-nums">{num(w.plants_on_site)}</TableCell>}
                      {isWeek && <TableCell className="tabular-nums">{num(w.labour_total)}</TableCell>}
                      <TableCell className="tabular-nums">
                        {r.beme_pct_complete != null ? `${Number(r.beme_pct_complete).toFixed(1)}%` : '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Financials: earnings vs cost, gaining/losing */}
      <FinancialsSection projectId={projectId} />

      {/* Per-plant totals */}
      <PlantsSection projectId={projectId} />

      <p className="text-xs text-muted-foreground">
        All figures recomputed from the stored weekly rows — cumulative
        columns in the workbooks are never trusted. Payments reflect the
        ledger in the latest report; weeks may be uploaded in any order.
      </p>
    </div>
  )
}

function FinancialsSection({ projectId }: { projectId: string }) {
  const { data, isLoading, isError } = useProjectFinancials(projectId)

  if (isLoading) return <Skeleton className="h-72" />
  if (isError || !data) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <AlertCircle className="h-4 w-4" /> Could not load financials.
      </div>
    )
  }
  if (!data.weeks.length) return null

  const t = data.totals
  const gaining = t.net >= 0
  const maxAbsNet = Math.max(...data.weeks.map((w) => Math.abs(w.net)), 1)

  return (
    <div className="space-y-4">
      {/* Headline: are we gaining or losing? */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Wallet} label="Earnings (works + VAT)" value={ngn(t.earnings)} />
        <StatCard icon={Truck} label="Total costs" value={ngn(t.cost_total)} />
        <Card className={gaining ? 'border-emerald-300' : 'border-red-300'}>
          <CardContent className="flex items-center gap-3 p-4">
            <div className={`rounded-lg p-2 ${gaining ? 'bg-emerald-100' : 'bg-red-100'}`}>
              {gaining
                ? <TrendingUp className="h-4 w-4 text-emerald-700" />
                : <TrendingDown className="h-4 w-4 text-red-700" />}
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">
                Net {gaining ? '— gaining' : '— losing'}
              </p>
              <p className={`truncate text-lg font-semibold tabular-nums ${
                gaining ? 'text-emerald-700' : 'text-red-700'
              }`}>
                {ngn(t.net)}
              </p>
              <p className="text-xs text-muted-foreground">
                {t.weeks_gaining} wks gaining · {t.weeks_losing} losing
              </p>
            </div>
          </CardContent>
        </Card>
        <StatCard
          icon={Droplets} label="Diesel cost (AGO)"
          value={ngn(t.diesel_cost)}
          hint={`${num(Math.round(t.diesel_litres))} L charged${
            data.weeks.at(-1)?.diesel_rate
              ? ` · latest ₦${num(data.weeks.at(-1)!.diesel_rate!)}/L` : ''}`}
        />
      </div>

      {/* Data quality — what the system caught in the workbooks */}
      <DataQualityPanel weeks={data.weeks} />

      {/* Weekly earnings vs cost */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Earnings vs cost, week by week</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Week</TableHead>
                <TableHead>Earnings</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Diesel ₦</TableHead>
                <TableHead>Net</TableHead>
                <TableHead>Cumulative net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.weeks.map((w) => {
                const pos = w.net >= 0
                const barPct = Math.max(3, (Math.abs(w.net) / maxAbsNet) * 100)
                return (
                  <TableRow key={`${w.year}-${w.week_number}`}>
                    <TableCell className="whitespace-nowrap font-medium">
                      <span className="flex items-center gap-1.5">
                        W{String(w.week_number).padStart(2, '0')} · {new Date(
                          w.week_ending_date,
                        ).toLocaleDateString('en-NG', { day: '2-digit', month: 'short' })}
                        {w.flags.some((f) => f.severity !== 'info') && (
                          <AlertCircle
                            className="h-3.5 w-3.5 text-amber-500"
                            aria-label="data-quality flags"
                          />
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums">{ngn(w.earnings)}</TableCell>
                    <TableCell className="tabular-nums">{ngn(w.cost_total)}</TableCell>
                    <TableCell className="tabular-nums">{ngn(w.diesel_cost)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-14 shrink-0 rounded-full bg-muted sm:w-20">
                          <div
                            className={`h-1.5 rounded-full ${pos ? 'bg-emerald-500' : 'bg-red-500'}`}
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                        <span className={`tabular-nums font-medium ${
                          pos ? 'text-emerald-700' : 'text-red-700'
                        }`}>
                          {ngn(w.net)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">{ngn(w.cumulative_net)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          {data.cross_check_warnings.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              ✓ Every week reconciles with the workbook&apos;s own Net Earnings row
              — recomputed independently from the atomic cost rows.
            </p>
          ) : (
            <div className="mt-2 space-y-1">
              {data.cross_check_warnings.map((w) => (
                <p key={w} className="text-xs text-amber-700">⚠ {w}</p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cost by category + BEME bills side by side */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Costs by category (all weeks)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(t.cost_by_category).map(([cat, v]) => {
              const pct = t.cost_total > 0 ? (v / t.cost_total) * 100 : 0
              return (
                <div key={cat}>
                  <div className="mb-0.5 flex justify-between text-xs">
                    <span>{cat === 'AGO' ? 'AGO (diesel)' : cat}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {ngn(v)} · {pct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted">
                    <div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.max(1, pct)}%` }} />
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">BEME bills — % complete (latest week)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.bills.map((b) => {
              const pct = b.pct_complete != null ? b.pct_complete * 100 : null
              return (
                <div key={b.item}>
                  <div className="mb-0.5 flex justify-between gap-2 text-xs">
                    <span className="truncate">{b.item}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {pct != null ? `${pct.toFixed(1)}%` : '—'}
                      {b.this_week ? ` · ${ngn(b.this_week)} this wk` : ''}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted">
                    <div
                      className="h-1.5 rounded-full bg-sky-500"
                      style={{ width: `${Math.min(100, Math.max(1, pct ?? 0))}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function PlantsSection({ projectId }: { projectId: string }) {
  const { data, isLoading, isError } = useProjectPlantRollups(projectId)
  const [search, setSearch] = useState('')

  const rows = useMemo(() => {
    if (!data) return []
    const q = search.trim().toUpperCase()
    if (!q) return data
    return data.filter((p) =>
      (p.fleet_number ?? p.fleet_number_raw).toUpperCase().includes(q) ||
      (p.description ?? '').toUpperCase().includes(q),
    )
  }, [data, search])

  if (isLoading) return <Skeleton className="h-72" />
  if (isError || !data) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <AlertCircle className="h-4 w-4" /> Could not load per-plant totals.
      </div>
    )
  }
  if (!data.length) return null

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-sm">
          Plants on site — totals across all weeks ({data.length})
        </CardTitle>
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search fleet or description"
            className="h-8 w-56 pl-8 text-xs"
          />
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fleet</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Weeks</TableHead>
              <TableHead className="text-right">Hrs worked</TableHead>
              <TableHead className="text-right">B/D hrs</TableHead>
              <TableHead className="text-right">Standby</TableHead>
              <TableHead className="text-right">Plant cost</TableHead>
              <TableHead className="text-right">Diesel (L)</TableHead>
              <TableHead>Condition</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.fleet_number_raw}>
                <TableCell className="font-medium">
                  {p.plant_id ? (
                    <Link
                      href={`/plants/${p.plant_id}`}
                      className="text-primary hover:underline"
                    >
                      {p.fleet_number ?? p.fleet_number_raw}
                    </Link>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      {p.fleet_number_raw}
                      <Badge variant="outline" className="border-amber-300 px-1 py-0 text-[10px] text-amber-700">
                        unmatched
                      </Badge>
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground max-w-[220px]">
                  <span className="line-clamp-1 text-xs">{p.description ?? '—'}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{p.weeks_seen}</TableCell>
                <TableCell className="text-right tabular-nums">{num(Math.round(p.hours_worked))}</TableCell>
                <TableCell className="text-right tabular-nums">{num(Math.round(p.breakdown_hours))}</TableCell>
                <TableCell className="text-right tabular-nums">{num(Math.round(p.standby_hours))}</TableCell>
                <TableCell className="text-right tabular-nums">{ngn(p.plant_cost_ngn)}</TableCell>
                <TableCell className="text-right tabular-nums">{num(Math.round(p.diesel_litres))}</TableCell>
                <TableCell>
                  {p.condition ? (
                    <Badge variant="secondary" className="text-[10px] capitalize">
                      {p.condition.replace(/_/g, ' ')}
                    </Badge>
                  ) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}


function DataQualityPanel({ weeks }: { weeks: FinancialWeek[] }) {
  const items = useMemo(() => {
    const out: { key: string; weeks: number[]; message: string; type: string }[] = []
    const by = new Map<string, { weeks: number[]; message: string; type: string }>()
    for (const w of weeks) {
      for (const f of w.flags) {
        if (f.severity === 'info') continue
        const key = `${f.sheet}|${f.type}`
        const cur = by.get(key) ?? { weeks: [], message: f.message, type: f.type }
        cur.weeks.push(w.week_number)
        by.set(key, cur)
      }
    }
    for (const [key, v] of by) out.push({ key, ...v })
    return out
  }, [weeks])

  if (!items.length) return null
  return (
    <Card className="border-amber-300/60">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <AlertCircle className="h-4 w-4 text-amber-500" />
          Data quality — caught automatically in the site&apos;s workbooks
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {items.map((it) => (
          <p key={it.key} className="text-xs">
            <Badge variant="outline" className="mr-1.5 border-amber-300 px-1 py-0 text-[10px] text-amber-700">
              {it.type.replace(/_/g, ' ')} · W{it.weeks.join(', W')}
            </Badge>
            <span className="text-muted-foreground">{it.message}</span>
          </p>
        ))}
      </CardContent>
    </Card>
  )
}
