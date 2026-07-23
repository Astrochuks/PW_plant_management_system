'use client'

/**
 * Plant Analytics — the fleet performance workbench. One period lens
 * (week / month / quarter / year) drives period KPIs with deltas, the
 * hours mix (worked / standby / breakdown), the availability trend,
 * plant cost vs diesel spend, and the fuel-efficiency outliers table
 * (litres per hour vs the plant's own fleet-type average).
 */

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import ECharts from 'echarts-for-react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Delta, Kpi, Legend } from '@/components/projects/hub-ui'
import { useProjectFinancials, useProjectPlantData } from '@/hooks/use-projects'
import { naira, num, pctFmt, weekLabel } from '@/lib/format'
import type { Granularity } from '../work-cost/analytics-section'

const COLOR_WORKED = '#10b981'
const COLOR_STANDBY = '#94a3b8'
const COLOR_BREAKDOWN = '#ef4444'
const COLOR_PLANT_COST = '#f59e0b'
const COLOR_DIESEL = '#8b5cf6'

interface HourBucket {
  label: string
  worked: number
  standby: number
  breakdown: number
  plantCost: number
  dieselCost: number
}

function bucketKey(year: number, week: number, endingDate: string, g: Granularity): string {
  const d = new Date(endingDate + 'T00:00:00')
  if (g === 'week') return weekLabel(year, week)
  if (g === 'month') return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  if (g === 'quarter') return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`
  return String(d.getFullYear())
}

const ZOOM_AFTER = 30
const zoomProps = (count: number) =>
  count > ZOOM_AFTER
    ? {
        dataZoom: [
          {
            type: 'slider', height: 16, bottom: 4,
            start: (1 - ZOOM_AFTER / count) * 100, end: 100,
          },
          { type: 'inside' },
        ],
      }
    : {}

const compactNaira = (v: number) =>
  Math.abs(v) >= 1_000_000 ? `₦${(v / 1_000_000).toFixed(0)}m`
    : Math.abs(v) >= 1_000 ? `₦${(v / 1_000).toFixed(0)}k` : `₦${v}`

export default function PlantAnalyticsSection({ gran, year }: {
  gran: Granularity
  year: number | 'all'
}) {
  const params = useParams<{ id: string }>()
  const { data, isLoading } = useProjectPlantData(params.id)
  const { data: fin } = useProjectFinancials(params.id)

  const scopedWeekly = useMemo(
    () => (data?.weekly ?? []).filter((w) => year === 'all' || w.year === year),
    [data, year],
  )

  const buckets: HourBucket[] = useMemo(() => {
    // diesel ₦ per (year, week) from the financials weeks — money truth
    const dieselByWeek = new Map<string, number>()
    for (const w of fin?.weeks ?? []) {
      dieselByWeek.set(`${w.year}-${w.week_number}`, w.diesel_cost)
    }
    const map = new Map<string, HourBucket>()
    for (const w of scopedWeekly) {
      const key = bucketKey(w.year, w.week_number, w.week_ending_date, gran)
      const b = map.get(key) ?? {
        label: key, worked: 0, standby: 0, breakdown: 0, plantCost: 0, dieselCost: 0,
      }
      b.worked += w.worked
      b.standby += w.standby
      b.breakdown += w.breakdown
      b.plantCost += w.plant_cost
      b.dieselCost += dieselByWeek.get(`${w.year}-${w.week_number}`) ?? 0
      map.set(key, b)
    }
    return [...map.values()]
  }, [scopedWeekly, fin, gran])

  // Fuel efficiency: per plant L/hr vs its fleet-type average, year-scoped
  const efficiency = useMemo(() => {
    if (!data) return []
    const byPlant = new Map<string, { worked: number; diesel: number }>()
    for (const pw of data.plant_weeks) {
      if (year !== 'all' && pw.year !== year) continue
      const t = byPlant.get(pw.fleet_number_raw) ?? { worked: 0, diesel: 0 }
      t.worked += pw.worked
      t.diesel += pw.diesel_litres
      byPlant.set(pw.fleet_number_raw, t)
    }
    const meta = new Map(data.plants.map((p) => [p.fleet_number_raw, p]))
    const rows = [...byPlant.entries()]
      .map(([raw, t]) => {
        const p = meta.get(raw)
        return {
          raw,
          fleet: p?.fleet_number ?? raw,
          description: p?.description ?? null,
          type: p?.fleet_type ?? 'Untyped',
          worked: t.worked,
          diesel: t.diesel,
          lph: t.worked > 0 ? t.diesel / t.worked : null,
        }
      })
      // meaningful comparisons only: real running hours and real fuel
      .filter((r) => r.worked >= 8 && r.diesel > 0 && r.lph != null)

    const typeTotals = new Map<string, { worked: number; diesel: number; n: number }>()
    for (const r of rows) {
      const t = typeTotals.get(r.type) ?? { worked: 0, diesel: 0, n: 0 }
      t.worked += r.worked
      t.diesel += r.diesel
      t.n += 1
      typeTotals.set(r.type, t)
    }
    return rows
      .map((r) => {
        const t = typeTotals.get(r.type)!
        // type average excludes single-plant types — nothing to compare against
        const typeAvg = t.n >= 2 && t.worked > 0 ? t.diesel / t.worked : null
        const vsAvg = typeAvg != null && typeAvg > 0 ? (r.lph! / typeAvg - 1) * 100 : null
        return { ...r, typeAvg, vsAvg }
      })
      .sort((a, b) => (b.vsAvg ?? -Infinity) - (a.vsAvg ?? -Infinity))
  }, [data, year])

  if (isLoading) return <SectionSkeleton />
  if (buckets.length === 0) {
    return (
      <div className="rounded-lg border py-12 text-center text-muted-foreground">
        <p className="text-lg font-medium text-foreground">
          {(data?.weekly.length ?? 0) > 0 ? `No stored weeks in ${year}` : 'No plant returns yet'}
        </p>
        <p className="mt-1 text-sm">Fleet analytics builds itself from uploaded weeks.</p>
      </div>
    )
  }

  const latest = buckets[buckets.length - 1]
  const prev = buckets.length > 1 ? buckets[buckets.length - 2] : null
  const avail = (b: HourBucket | null) =>
    b && b.worked + b.breakdown > 0 ? b.worked / (b.worked + b.breakdown) : null

  const labels = buckets.map((b) => b.label)

  const hoursOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['Worked', 'Standby', 'Breakdown'], bottom: 0 },
    grid: { left: 56, right: 16, top: 20, bottom: buckets.length > ZOOM_AFTER ? 64 : 42 },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value', axisLabel: { formatter: '{value} h' } },
    series: [
      { name: 'Worked', type: 'bar', stack: 'h', data: buckets.map((b) => Math.round(b.worked)), itemStyle: { color: COLOR_WORKED } },
      { name: 'Standby', type: 'bar', stack: 'h', data: buckets.map((b) => Math.round(b.standby)), itemStyle: { color: COLOR_STANDBY } },
      { name: 'Breakdown', type: 'bar', stack: 'h', data: buckets.map((b) => Math.round(b.breakdown)), itemStyle: { color: COLOR_BREAKDOWN } },
    ],
    ...zoomProps(buckets.length),
  }

  const availOption = {
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${v}%` },
    grid: { left: 44, right: 16, top: 20, bottom: buckets.length > ZOOM_AFTER ? 56 : 30 },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
    series: [{
      type: 'line',
      data: buckets.map((b) => {
        const a = avail(b)
        return a == null ? null : Math.round(a * 100)
      }),
      itemStyle: { color: COLOR_WORKED },
      lineStyle: { width: 2.5 },
    }],
    ...zoomProps(buckets.length),
  }

  const costOption = {
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => naira(v) },
    legend: { data: ['Plant cost', 'Diesel (AGO)'], bottom: 0 },
    grid: { left: 64, right: 16, top: 20, bottom: buckets.length > ZOOM_AFTER ? 64 : 42 },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value', axisLabel: { formatter: compactNaira } },
    series: [
      { name: 'Plant cost', type: 'bar', data: buckets.map((b) => Math.round(b.plantCost)), itemStyle: { color: COLOR_PLANT_COST } },
      { name: 'Diesel (AGO)', type: 'bar', data: buckets.map((b) => Math.round(b.dieselCost)), itemStyle: { color: COLOR_DIESEL } },
    ],
    ...zoomProps(buckets.length),
  }

  return (
    <div className="space-y-6">
      {/* Period KPIs, each vs the previous bucket */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label={`Hours worked · ${latest.label}`} value={`${num(Math.round(latest.worked))} h`}
          sub={`${num(Math.round(latest.standby))} h standby`}
          extra={<Delta now={latest.worked} prev={prev?.worked ?? null} prevLabel={prev?.label ?? ''} />} />
        <Kpi label={`Availability · ${latest.label}`} value={pctFmt(avail(latest))}
          sub={`${num(Math.round(latest.breakdown))} h breakdown`}
          tone={(avail(latest) ?? 1) < 0.5 ? 'bad' : 'good'}
          extra={<Delta now={avail(latest) ?? 0} prev={avail(prev)} prevLabel={prev?.label ?? ''} pts />} />
        <Kpi label={`Plant cost · ${latest.label}`} value={naira(latest.plantCost, true)}
          sub={naira(latest.plantCost)}
          extra={<Delta now={latest.plantCost} prev={prev?.plantCost ?? null} prevLabel={prev?.label ?? ''} downIsGood />} />
        <Kpi label={`Diesel · ${latest.label}`} value={naira(latest.dieselCost, true)}
          sub={naira(latest.dieselCost)}
          extra={<Delta now={latest.dieselCost} prev={prev?.dieselCost ?? null} prevLabel={prev?.label ?? ''} downIsGood />} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="relative">
          <Legend>Fleet hours · worked vs standby vs breakdown</Legend>
          <CardContent className="pt-3">
            <ECharts option={hoursOption} style={{ height: 280 }} notMerge />
          </CardContent>
        </Card>
        <Card className="relative">
          <Legend>Availability trend</Legend>
          <CardContent className="pt-3">
            <ECharts option={availOption} style={{ height: 280 }} notMerge />
          </CardContent>
        </Card>
      </div>

      <Card className="relative">
        <Legend>Plant cost vs diesel spend</Legend>
        <CardContent className="pt-3">
          <ECharts option={costOption} style={{ height: 280 }} notMerge />
        </CardContent>
      </Card>

      <Card className="relative">
        <Legend>Fuel efficiency · litres per hour vs fleet-type average</Legend>
        <CardContent className="p-0 pt-2">
          <div className="max-h-[440px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Fleet</th>
                  <th className="px-4 py-2 font-medium">Description</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 text-right font-medium">Hours</th>
                  <th className="px-4 py-2 text-right font-medium">Diesel L</th>
                  <th className="px-4 py-2 text-right font-medium">L/hr</th>
                  <th className="px-4 py-2 text-right font-medium">Type avg</th>
                  <th className="px-4 py-2 text-right font-medium">vs Type avg</th>
                </tr>
              </thead>
              <tbody>
                {efficiency.map((r) => (
                  <tr key={r.raw} className="border-b last:border-0">
                    <td className="px-4 py-1.5 font-medium tabular-nums">{r.fleet}</td>
                    <td className="max-w-[220px] truncate px-4 py-1.5 text-muted-foreground">{r.description ?? '—'}</td>
                    <td className="px-4 py-1.5 text-muted-foreground">{r.type}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{num(Math.round(r.worked))}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{num(Math.round(r.diesel))}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums font-medium">{r.lph!.toFixed(1)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-muted-foreground">
                      {r.typeAvg == null ? '—' : r.typeAvg.toFixed(1)}
                    </td>
                    <td className={`px-4 py-1.5 text-right tabular-nums font-medium ${
                      r.vsAvg == null ? 'text-muted-foreground'
                        : r.vsAvg > 25 ? 'text-red-600'
                        : r.vsAvg < -10 ? 'text-emerald-700 dark:text-emerald-400'
                        : ''
                    }`}>
                      {r.vsAvg == null ? '—' : `${r.vsAvg > 0 ? '+' : ''}${r.vsAvg.toFixed(0)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            {efficiency.length} plants with ≥8 hours and fuel drawn
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function SectionSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
      <Skeleton className="h-96" />
    </div>
  )
}
