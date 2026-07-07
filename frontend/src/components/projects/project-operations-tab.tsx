'use client'

/**
 * Per-project operations drill-down: recomputed totals + week/month series.
 * Every figure is computed by our SQL from stored this-week facts — the
 * workbook's own Previous/To-Date columns are never used.
 */

import { useState } from 'react'
import { AlertCircle, CalendarRange, Droplets, HardHat, Timer, Truck, Wallet } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  useProjectOperationsSeries,
  useProjectOperationsSummary,
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

      <p className="text-xs text-muted-foreground">
        All figures recomputed from the stored weekly rows — cumulative
        columns in the workbooks are never trusted. Payments reflect the
        ledger in the latest report; weeks may be uploaded in any order.
      </p>
    </div>
  )
}
