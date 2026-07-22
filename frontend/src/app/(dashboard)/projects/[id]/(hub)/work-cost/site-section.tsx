'use client'

/**
 * Site — people and materials, latest week + trend: labour strength by
 * department, subcontractor ledgers (latest report carries the truth),
 * materials usage/stock with the sheet's own variance, hired vehicles.
 */

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import ECharts from 'echarts-for-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Kpi, Legend } from '@/components/projects/hub-ui'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjectSite } from '@/hooks/use-projects'
import { naira, num, weekLabel } from '@/lib/format'

export default function SitePage() {
  const params = useParams<{ id: string }>()
  const { data: site, isLoading } = useProjectSite(params.id)

  const labourTotals = useMemo(() => {
    if (!site) return null
    const permanent = site.labour.filter((l) => l.block === 'permanent')
      .reduce((a, l) => a + (l.manning_this_week ?? 0), 0)
    const casual = site.labour.filter((l) => l.block === 'casual')
      .reduce((a, l) => a + (l.manning_this_week ?? 0), 0)
    const movement = site.labour.reduce((a, l) => a + (l.movement ?? 0), 0)
    return { permanent, casual, total: permanent + casual, movement }
  }, [site])

  if (isLoading) return <PageSkeleton />
  if (!site) {
    return (
      <div className="rounded-lg border py-12 text-center text-muted-foreground">
        <p className="text-lg font-medium text-foreground">No site data yet</p>
        <p className="mt-1 text-sm">Upload a weekly report to populate labour, subcontractors and materials.</p>
      </div>
    )
  }

  const trendOption = {
    tooltip: { trigger: 'axis' },
    grid: { left: 44, right: 20, top: 16, bottom: 24 },
    xAxis: { type: 'category', data: site.labour_trend.map((t) => weekLabel(t.year, t.week_number)) },
    yAxis: { type: 'value' },
    series: [{
      name: 'Headcount', type: 'line', smooth: true, areaStyle: { opacity: 0.12 },
      data: site.labour_trend.map((t) => t.total),
      itemStyle: { color: '#f59e0b' }, lineStyle: { width: 2.5 },
    }],
  }

  const subsByName = new Map<string, typeof site.subcontractors>()
  for (const s of site.subcontractors) {
    const k = String(s.subcontractor_name ?? '—')
    subsByName.set(k, [...(subsByName.get(k) ?? []), s])
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Labour · latest week" value={num(labourTotals?.total ?? 0)}
          sub={`${num(labourTotals?.permanent ?? 0)} permanent · ${num(labourTotals?.casual ?? 0)} casual`}
          lineage="Labour Strength head-count" />
        <Kpi label="Movement · latest week"
          value={`${(labourTotals?.movement ?? 0) >= 0 ? '+' : ''}${num(labourTotals?.movement ?? 0)}`}
          lineage="this week − previous (identity)" />
        <Kpi label="Subcontractors" value={String(subsByName.size)}
          sub={`${site.subcontractors.length} work items`} lineage="latest report ledger" />
        <Kpi label="Hired vehicles · stored weeks" value={naira(site.hired_to_date_stored, true)}
          sub={`${site.hired_vehicles.length} arrangements this week`} lineage="days × rate" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="relative">
          <Legend>Labour strength · trend</Legend>
          <CardContent>
            <ECharts option={trendOption} style={{ height: 220 }} notMerge />
          </CardContent>
        </Card>

        <Card className="relative">
          <Legend>Departments · latest week</Legend>
          <CardContent className="max-h-[260px] overflow-y-auto p-0">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Department</th>
                  <th className="px-4 py-2 text-right font-medium">Previous</th>
                  <th className="px-4 py-2 text-right font-medium">This week</th>
                  <th className="px-4 py-2 text-right font-medium">Movement</th>
                </tr>
              </thead>
              <tbody>
                {site.labour.filter((l) => (l.manning_this_week ?? 0) > 0 || (l.movement ?? 0) !== 0).map((l, i) => (
                  <tr key={`${l.block}-${l.dept_slot}-${i}`} className="border-b last:border-0">
                    <td className="px-4 py-1.5">
                      {l.department}
                      <span className="ml-1.5 text-[10px] text-muted-foreground">{l.block}</span>
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{num(l.manning_previous_week)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums font-medium">{num(l.manning_this_week)}</td>
                    <td className={`px-4 py-1.5 text-right tabular-nums ${
                      (l.movement ?? 0) > 0 ? 'text-emerald-700' : (l.movement ?? 0) < 0 ? 'text-red-600' : 'text-muted-foreground'
                    }`}>
                      {(l.movement ?? 0) > 0 ? '+' : ''}{num(l.movement)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <Card className="relative">
        <Legend>Subcontractors · latest ledger</Legend>
        <CardHeader className="pb-1 pt-5">
          <p className="text-xs text-muted-foreground">the latest report carries each ledger&apos;s cumulative truth</p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium min-w-[200px]">Description</th>
                  <th className="px-4 py-2 font-medium">Unit</th>
                  <th className="px-4 py-2 text-right font-medium">Agreed rate</th>
                  <th className="px-4 py-2 text-right font-medium">Qty to date</th>
                  <th className="px-4 py-2 text-right font-medium">Balance</th>
                  <th className="px-4 py-2 text-right font-medium">Value this week</th>
                  <th className="px-4 py-2 text-right font-medium">Value to date</th>
                </tr>
              </thead>
              <tbody>
                {[...subsByName.entries()].map(([name, rows]) => (
                  <SubGroup key={name} name={name} rows={rows} />
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="relative">
        <Legend>Materials · latest week</Legend>
        <CardHeader className="pb-1 pt-5">
          <p className="text-xs text-muted-foreground">
            Variance is the sheet&apos;s own loss detector (available − used), shown verbatim
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium min-w-[180px]">Description</th>
                  <th className="px-4 py-2 font-medium">Unit</th>
                  <th className="px-4 py-2 text-right font-medium">Current price</th>
                  <th className="px-4 py-2 text-right font-medium">Received</th>
                  <th className="px-4 py-2 text-right font-medium">On site works</th>
                  <th className="px-4 py-2 text-right font-medium">Total used</th>
                  <th className="px-4 py-2 text-right font-medium">Variance qty</th>
                  <th className="px-4 py-2 text-right font-medium">Variance value</th>
                </tr>
              </thead>
              <tbody>
                {site.materials
                  .filter((m) => Number(m.used ?? 0) !== 0 || Number(m.received ?? 0) !== 0 || Number(m.variance_qty ?? 0) !== 0)
                  .map((m, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-4 py-1.5">
                        {String(m.material_name ?? '')}
                        <span className="ml-1.5 text-[10px] uppercase text-muted-foreground">{String(m.sheet_source ?? '')}</span>
                      </td>
                      <td className="px-4 py-1.5">{String(m.unit ?? '—')}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{naira(m.unit_cost == null ? null : Number(m.unit_cost))}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{num(m.received == null ? null : Number(m.received), 2)}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{num(m.used_works == null ? null : Number(m.used_works), 2)}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{num(m.used == null ? null : Number(m.used), 2)}</td>
                      <td className={`px-4 py-1.5 text-right tabular-nums ${Number(m.variance_qty ?? 0) < 0 ? 'text-red-600' : ''}`}>
                        {num(m.variance_qty == null ? null : Number(m.variance_qty), 2)}
                      </td>
                      <td className={`px-4 py-1.5 text-right tabular-nums ${Number(m.variance_value ?? 0) < 0 ? 'text-red-600' : ''}`}>
                        {naira(m.variance_value == null ? null : Number(m.variance_value))}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {site.materials.length > 0 && !site.materials[0].stock_maintained && (
            <p className="border-t px-4 py-2 text-xs text-amber-700">
              Stock side not maintained by this site (openings/closings empty) — usage recorded, loss detection unavailable.
            </p>
          )}
        </CardContent>
      </Card>

      {site.hired_vehicles.length > 0 && (
        <Card className="relative">
          <Legend>Hired vehicles · latest week</Legend>
          <CardContent className="p-0">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Description</th>
                  <th className="px-4 py-2 font-medium">Owners</th>
                  <th className="px-4 py-2 text-right font-medium">Days</th>
                  <th className="px-4 py-2 text-right font-medium">Rate ₦</th>
                  <th className="px-4 py-2 text-right font-medium">Amount ₦</th>
                </tr>
              </thead>
              <tbody>
                {site.hired_vehicles.map((h, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-4 py-1.5">{String(h.description ?? '—')}</td>
                    <td className="px-4 py-1.5 text-muted-foreground">{String(h.owners ?? '—')}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{num(h.days_worked == null ? null : Number(h.days_worked))}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{naira(h.rate_ngn == null ? null : Number(h.rate_ngn))}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{naira(h.amount_ngn == null ? null : Number(h.amount_ngn))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function SubGroup({ name, rows }: { name: string; rows: Array<Record<string, unknown>> }) {
  const toDate = rows.reduce((a, r) => a + Number(r.amount_to_date ?? 0), 0)
  const thisWeek = rows.reduce((a, r) => a + Number(r.amount_this_week ?? 0), 0)
  return (
    <>
      <tr className="border-b bg-muted/40">
        <td colSpan={5} className="px-4 py-1.5 font-semibold">{name}</td>
        <td className="px-4 py-1.5 text-right font-semibold tabular-nums">{naira(thisWeek)}</td>
        <td className="px-4 py-1.5 text-right font-semibold tabular-nums">{naira(toDate)}</td>
      </tr>
      {rows.map((r, i) => (
        <tr key={i} className="border-b last:border-0">
          <td className="max-w-[280px] truncate px-4 py-1.5 pl-7">{String(r.description ?? '—')}</td>
          <td className="px-4 py-1.5">{String(r.unit ?? '—')}</td>
          <td className="px-4 py-1.5 text-right tabular-nums">{naira(r.agreed_rate == null ? null : Number(r.agreed_rate))}</td>
          <td className="px-4 py-1.5 text-right tabular-nums">{num(r.qty_to_date == null ? null : Number(r.qty_to_date), 2)}</td>
          <td className="px-4 py-1.5 text-right tabular-nums">{num(r.balance_remaining == null ? null : Number(r.balance_remaining), 2)}</td>
          <td className="px-4 py-1.5 text-right tabular-nums">{naira(r.amount_this_week == null ? null : Number(r.amount_this_week))}</td>
          <td className="px-4 py-1.5 text-right tabular-nums">{naira(r.amount_to_date == null ? null : Number(r.amount_to_date))}</td>
        </tr>
      ))}
    </>
  )
}


function PageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-64" /><Skeleton className="h-64" />
      </div>
      <Skeleton className="h-72" />
    </div>
  )
}
