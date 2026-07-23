'use client'

/**
 * Plant & diesel — per-plant hours/availability/cost across stored
 * weeks, the diesel money truth (Cost Report AGO row) vs the per-plant
 * log, and the unresolved fleet queue with durable verdicts.
 */

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import ECharts from 'echarts-for-react'
import { toast } from 'sonner'
import { RefreshCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Kpi, Legend } from '@/components/projects/hub-ui'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useQueryClient } from '@tanstack/react-query'
import {
  useProjectPlantRollups, useProjectFinancials, useUnmappedFleetNumbers,
} from '@/hooks/use-projects'
import { markFleetNumberExternal, reResolveFleetNumbers } from '@/lib/api/projects'
import { getErrorMessage } from '@/lib/api/client'
import { naira, num, pctFmt, weekLabel } from '@/lib/format'

export default function PlantDieselPage() {
  const params = useParams<{ id: string }>()
  const { data: plants, isLoading } = useProjectPlantRollups(params.id)
  const { data: fin } = useProjectFinancials(params.id)
  const { data: unmapped } = useUnmappedFleetNumbers()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const totals = useMemo(() => {
    if (!plants) return null
    const worked = plants.reduce((a, p) => a + p.hours_worked, 0)
    const breakdown = plants.reduce((a, p) => a + p.breakdown_hours, 0)
    const cost = plants.reduce((a, p) => a + p.plant_cost_ngn, 0)
    const litres = plants.reduce((a, p) => a + p.diesel_litres, 0)
    return {
      worked, breakdown, cost, litres,
      availability: worked + breakdown > 0 ? worked / (worked + breakdown) : null,
      count: plants.length,
    }
  }, [plants])

  const filtered = useMemo(() => {
    if (!plants) return []
    const q = search.trim().toLowerCase()
    const list = q
      ? plants.filter((p) =>
          p.fleet_number_raw.toLowerCase().includes(q)
          || (p.description ?? '').toLowerCase().includes(q))
      : plants
    return [...list].sort((a, b) => b.hours_worked - a.hours_worked)
  }, [plants, search])

  const dieselOption = useMemo(() => {
    const weeks = fin?.weeks ?? []
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['Charged (AGO row)', 'Logged (per plant)'], bottom: 0 },
      grid: { left: 60, right: 20, top: 20, bottom: 42 },
      xAxis: { type: 'category', data: weeks.map((w) => weekLabel(w.year, w.week_number)) },
      yAxis: { type: 'value', axisLabel: { formatter: '{value} L' } },
      series: [
        { name: 'Charged (AGO row)', type: 'line', data: weeks.map((w) => Math.round(w.diesel_litres)), itemStyle: { color: '#f59e0b' }, lineStyle: { width: 2.5 } },
        { name: 'Logged (per plant)', type: 'line', data: weeks.map((w) => Math.round(w.diesel_logged_litres)), itemStyle: { color: '#6b7280' }, lineStyle: { width: 2, type: 'dashed' } },
      ],
    }
  }, [fin])

  const handleExternal = async (raw: string) => {
    setBusy(raw)
    try {
      await markFleetNumberExternal(raw)
      toast.success(`${raw} marked external — it leaves the queue for good`)
      qc.invalidateQueries({ queryKey: ['projects', 'unmapped-fleet'] })
      qc.invalidateQueries()
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const handleReResolve = async () => {
    setBusy('__re')
    try {
      const r = await reResolveFleetNumbers()
      toast.success(`Re-resolved: ${r.rows_backfilled} rows linked`)
      qc.invalidateQueries()
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  if (isLoading) return <PageSkeleton />

  const dieselCost = fin?.totals.diesel_cost ?? 0
  const charged = fin?.weeks.reduce((a, w) => a + w.diesel_litres, 0) ?? 0
  const logged = fin?.weeks.reduce((a, w) => a + w.diesel_logged_litres, 0) ?? 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Plants seen" value={String(totals?.count ?? 0)}
          sub={`${num(totals?.worked ?? 0)} hrs worked`} />
        <Kpi label="Availability" value={pctFmt(totals?.availability)}
          sub={`${num(totals?.breakdown ?? 0)} hrs breakdown`} />
        <Kpi label="Plant cost" value={naira(totals?.cost ?? 0, true)}
          sub={naira(totals?.cost ?? 0)} />
        <Kpi label="Diesel (AGO)" value={naira(dieselCost, true)}
          sub={`${num(charged)} L charged · ${logged > 0 && charged > 0 ? pctFmt(logged / charged, 0) : '—'} attributed`} />
      </div>

      <Card className="relative">
        <Legend>Diesel · charged vs logged, per week</Legend>
        <CardContent className="pt-3">
          <ECharts option={dieselOption} style={{ height: 260 }} notMerge />
        </CardContent>
      </Card>

      {(unmapped?.length ?? 0) > 0 && (
        <Card className="relative border-amber-300 dark:border-amber-700">
          <Legend>Fleet numbers awaiting a verdict</Legend>
          <CardHeader className="flex-row items-center justify-between pb-2 pt-5">
            <div>
              <p className="text-xs text-muted-foreground">
                Rows are saved either way — a verdict links them to the register (or settles
                them as external) for every past and future week.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleReResolve} disabled={busy === '__re'}>
              <RefreshCcw className="mr-2 h-3.5 w-3.5" />
              Re-resolve
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Raw number</th>
                  <th className="px-4 py-2 font-medium">Seen as</th>
                  <th className="px-4 py-2 text-right font-medium">Rows</th>
                  <th className="px-4 py-2 text-right font-medium">Weeks</th>
                  <th className="px-4 py-2 text-right font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {unmapped!.map((u) => (
                  <tr key={u.fleet_number_raw} className="border-b last:border-0">
                    <td className="px-4 py-2 font-medium tabular-nums">{u.fleet_number_raw}</td>
                    <td className="max-w-[220px] truncate px-4 py-2 text-muted-foreground">{u.description ?? '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{u.occurrences}</td>
                    <td className="px-4 py-2 text-right tabular-nums">W{u.first_week}–W{u.last_week}</td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        variant="outline" size="sm" className="h-7 text-xs"
                        disabled={busy === u.fleet_number_raw}
                        onClick={() => handleExternal(u.fleet_number_raw)}
                        title="Not company plant (hired / contractor kit)"
                      >
                        Mark external
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              Company plant under a different spelling? Add or correct it in the fleet
              register, then hit Re-resolve — every historical row backfills.
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="relative">
        <Legend>Per-plant totals · stored weeks</Legend>
        <CardHeader className="pb-1 pt-5">
          <Input
            placeholder="Search fleet number or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 max-w-xs text-xs"
          />
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Fleet</th>
                  <th className="px-4 py-2 font-medium">Description</th>
                  <th className="px-4 py-2 text-right font-medium">Weeks</th>
                  <th className="px-4 py-2 text-right font-medium">Worked</th>
                  <th className="px-4 py-2 text-right font-medium">Standby</th>
                  <th className="px-4 py-2 text-right font-medium">Breakdown</th>
                  <th className="px-4 py-2 text-right font-medium">Availability</th>
                  <th className="px-4 py-2 text-right font-medium">Plant cost</th>
                  <th className="px-4 py-2 text-right font-medium">Diesel L</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const denom = p.hours_worked + p.breakdown_hours
                  return (
                    <tr key={p.fleet_number_raw} className="border-b last:border-0">
                      <td className="px-4 py-1.5 font-medium tabular-nums">
                        {p.fleet_number ?? p.fleet_number_raw}
                        {!p.plant_id && (
                          <Badge variant="outline" className="ml-1.5 px-1 text-[9px]">unlinked</Badge>
                        )}
                      </td>
                      <td className="max-w-[240px] truncate px-4 py-1.5 text-muted-foreground">{p.description ?? '—'}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{p.weeks_seen}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{num(p.hours_worked)}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{num(p.standby_hours)}</td>
                      <td className={`px-4 py-1.5 text-right tabular-nums ${p.breakdown_hours > 0 ? 'text-red-600' : ''}`}>
                        {num(p.breakdown_hours)}
                      </td>
                      <td className="px-4 py-1.5 text-right tabular-nums">
                        {denom > 0 ? pctFmt(p.hours_worked / denom, 0) : '—'}
                      </td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{naira(p.plant_cost_ngn)}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{num(p.diesel_litres)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            {filtered.length} of {plants?.length ?? 0} plants
          </p>
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
      <Skeleton className="h-64" />
      <Skeleton className="h-96" />
    </div>
  )
}
