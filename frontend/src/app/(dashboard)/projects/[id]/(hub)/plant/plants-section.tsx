'use client'

/**
 * Plants — the per-plant register view. Search + sort over every plant
 * seen on this project; each row expands into that plant's own weekly
 * history (hours, breakdown, cost, diesel) with a mini chart. The
 * unresolved fleet queue sits on top so verdicts happen where the
 * plants live.
 */

import { Fragment, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import ECharts from 'echarts-for-react'
import { toast } from 'sonner'
import { ChevronRight, RefreshCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Legend } from '@/components/projects/hub-ui'
import { useQueryClient } from '@tanstack/react-query'
import { useProjectPlantData, useUnmappedFleetNumbers } from '@/hooks/use-projects'
import type { PlantWeekRow, ProjectPlantRollup } from '@/hooks/use-projects'
import { markFleetNumberExternal, reResolveFleetNumbers } from '@/lib/api/projects'
import { getErrorMessage } from '@/lib/api/client'
import { naira, num, pctFmt, weekLabel } from '@/lib/format'

type SortKey = 'worked' | 'breakdown' | 'availability' | 'cost' | 'diesel'

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'worked', label: 'Hours worked' },
  { key: 'breakdown', label: 'Breakdown hours' },
  { key: 'availability', label: 'Lowest availability' },
  { key: 'cost', label: 'Plant cost' },
  { key: 'diesel', label: 'Diesel litres' },
]

// availability = fit to work (standby counts as available);
// utilisation = share of all hours actually worked
const availability = (p: ProjectPlantRollup): number | null => {
  const total = p.hours_worked + p.standby_hours + p.breakdown_hours
  return total > 0 ? (p.hours_worked + p.standby_hours) / total : null
}

const utilisation = (p: ProjectPlantRollup): number | null => {
  const total = p.hours_worked + p.standby_hours + p.breakdown_hours
  return total > 0 ? p.hours_worked / total : null
}

export default function PlantsSection() {
  const params = useParams<{ id: string }>()
  const { data, isLoading } = useProjectPlantData(params.id)
  const { data: unmapped } = useUnmappedFleetNumbers()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('worked')
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const weeksByPlant = useMemo(() => {
    const map = new Map<string, PlantWeekRow[]>()
    for (const pw of data?.plant_weeks ?? []) {
      const list = map.get(pw.fleet_number_raw) ?? []
      list.push(pw)
      map.set(pw.fleet_number_raw, list)
    }
    return map
  }, [data])

  const filtered = useMemo(() => {
    const plants = data?.plants ?? []
    const q = search.trim().toLowerCase()
    const list = q
      ? plants.filter((p) =>
          p.fleet_number_raw.toLowerCase().includes(q)
          || (p.fleet_number ?? '').toLowerCase().includes(q)
          || (p.description ?? '').toLowerCase().includes(q))
      : plants
    const sorted = [...list]
    if (sort === 'worked') sorted.sort((a, b) => b.hours_worked - a.hours_worked)
    if (sort === 'breakdown') sorted.sort((a, b) => b.breakdown_hours - a.breakdown_hours)
    if (sort === 'cost') sorted.sort((a, b) => b.plant_cost_ngn - a.plant_cost_ngn)
    if (sort === 'diesel') sorted.sort((a, b) => b.diesel_litres - a.diesel_litres)
    if (sort === 'availability') {
      // plants that actually ran, worst availability first
      sorted.sort((a, b) => (availability(a) ?? 2) - (availability(b) ?? 2))
    }
    return sorted
  }, [data, search, sort])

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

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-96" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {(unmapped?.length ?? 0) > 0 && (
        <Card className="relative border-amber-300 dark:border-amber-700">
          <Legend>Fleet numbers awaiting a verdict</Legend>
          <CardHeader className="flex-row items-center justify-end pb-2 pt-5">
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
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 pb-1 pt-5">
          <Input
            placeholder="Search fleet number or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 max-w-xs text-xs"
          />
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="h-8 w-44 text-xs font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="w-8 px-2 py-2" />
                  <th className="px-2 py-2 font-medium">Fleet</th>
                  <th className="px-4 py-2 font-medium">Description</th>
                  <th className="px-4 py-2 text-right font-medium">Weeks</th>
                  <th className="px-4 py-2 text-right font-medium">Worked</th>
                  <th className="px-4 py-2 text-right font-medium">Standby</th>
                  <th className="px-4 py-2 text-right font-medium">Breakdown</th>
                  <th className="px-4 py-2 text-right font-medium">Availability</th>
                  <th className="px-4 py-2 text-right font-medium">Utilisation</th>
                  <th className="px-4 py-2 text-right font-medium">Plant cost</th>
                  <th className="px-4 py-2 text-right font-medium">Diesel L</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const avail = availability(p)
                  const util = utilisation(p)
                  const isOpen = open === p.fleet_number_raw
                  const history = weeksByPlant.get(p.fleet_number_raw) ?? []
                  return (
                    <Fragment key={p.fleet_number_raw}>
                      <tr
                        className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/40"
                        onClick={() => setOpen(isOpen ? null : p.fleet_number_raw)}
                      >
                        <td className="px-2 py-1.5">
                          <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                        </td>
                        <td className="px-2 py-1.5 font-medium tabular-nums">
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
                          {avail == null ? '—' : pctFmt(avail, 0)}
                        </td>
                        <td className="px-4 py-1.5 text-right tabular-nums">
                          {util == null ? '—' : pctFmt(util, 0)}
                        </td>
                        <td className="px-4 py-1.5 text-right tabular-nums">{naira(p.plant_cost_ngn)}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums">{num(p.diesel_litres)}</td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b bg-muted/20">
                          <td colSpan={11} className="px-6 py-3">
                            <PlantHistory history={history} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            {filtered.length} of {data?.plants.length ?? 0} plants
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function PlantHistory({ history }: { history: PlantWeekRow[] }) {
  const chartOption = useMemo(() => ({
    tooltip: { trigger: 'axis' },
    legend: { data: ['Worked', 'Breakdown'], bottom: 0 },
    grid: { left: 40, right: 12, top: 12, bottom: 40 },
    xAxis: { type: 'category', data: history.map((h) => weekLabel(h.year, h.week_number)) },
    yAxis: { type: 'value', axisLabel: { formatter: '{value} h' } },
    series: [
      { name: 'Worked', type: 'bar', data: history.map((h) => Math.round(h.worked)), itemStyle: { color: '#10b981' } },
      { name: 'Breakdown', type: 'bar', data: history.map((h) => Math.round(h.breakdown)), itemStyle: { color: '#ef4444' } },
    ],
  }), [history])

  if (history.length === 0) {
    return <p className="text-xs text-muted-foreground">No weekly rows for this plant.</p>
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">Week</th>
              <th className="px-2 py-1.5 text-right font-medium">Worked</th>
              <th className="px-2 py-1.5 text-right font-medium">Standby</th>
              <th className="px-2 py-1.5 text-right font-medium">Breakdown</th>
              <th className="px-2 py-1.5 text-right font-medium">Availability</th>
              <th className="px-2 py-1.5 text-right font-medium">Utilisation</th>
              <th className="px-2 py-1.5 text-right font-medium">Cost</th>
              <th className="px-2 py-1.5 text-right font-medium">Diesel L</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => {
              const total = h.worked + h.standby + h.breakdown
              return (
                <tr key={`${h.year}-${h.week_number}`} className="border-b last:border-0">
                  <td className="px-2 py-1 font-medium tabular-nums">{weekLabel(h.year, h.week_number)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{num(h.worked)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{num(h.standby)}</td>
                  <td className={`px-2 py-1 text-right tabular-nums ${h.breakdown > 0 ? 'text-red-600' : ''}`}>
                    {num(h.breakdown)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {total > 0 ? pctFmt((h.worked + h.standby) / total, 0) : '—'}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {total > 0 ? pctFmt(h.worked / total, 0) : '—'}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{naira(h.plant_cost)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{num(h.diesel_litres)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {history.length > 1 && (
        <ECharts option={chartOption} style={{ height: 200 }} notMerge />
      )}
    </div>
  )
}
