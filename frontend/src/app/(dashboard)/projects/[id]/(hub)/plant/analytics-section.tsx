'use client'

/**
 * Plant Analytics — the fleet performance workbench. One period lens
 * (week / month / quarter / year) drives period KPIs with deltas, the
 * hours mix (worked / standby / breakdown), the availability trend,
 * plant cost vs diesel spend, and the fuel-efficiency outliers table
 * (litres per hour vs the plant's own fleet-type average).
 */

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import ECharts from 'echarts-for-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Delta, Kpi, Legend } from '@/components/projects/hub-ui'
import { useProjectFinancials, useProjectPlantData } from '@/hooks/use-projects'
import type { ProjectFinancials, ProjectPlantData } from '@/hooks/use-projects'
import { naira, num, pctFmt, weekLabel } from '@/lib/format'
import type { Granularity } from '../work-cost/analytics-section'

const VAT = 1.075

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
  const { efficiency, effStats } = useMemo(() => {
    if (!data) return { efficiency: [], effStats: null }
    const byPlant = new Map<string, { worked: number; diesel: number }>()
    for (const pw of data.plant_weeks) {
      if (year !== 'all' && pw.year !== year) continue
      const t = byPlant.get(pw.fleet_number_raw) ?? { worked: 0, diesel: 0 }
      t.worked += pw.worked
      t.diesel += pw.diesel_litres
      byPlant.set(pw.fleet_number_raw, t)
    }
    // why most plants sit this one out — shown to the user in the footer
    const all = [...byPlant.values()]
    const noFuel = all.filter((t) => t.diesel <= 0).length
    const lowHours = all.filter((t) => t.diesel > 0 && t.worked < 8).length
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
    const efficiency = rows
      .map((r) => {
        const t = typeTotals.get(r.type)!
        // type average excludes single-plant types — nothing to compare against
        const typeAvg = t.n >= 2 && t.worked > 0 ? t.diesel / t.worked : null
        const vsAvg = typeAvg != null && typeAvg > 0 ? (r.lph! / typeAvg - 1) * 100 : null
        return { ...r, typeAvg, vsAvg }
      })
      .sort((a, b) => (b.vsAvg ?? -Infinity) - (a.vsAvg ?? -Infinity))
    return { efficiency, effStats: { total: byPlant.size, noFuel, lowHours } }
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
  // availability = fit to work (standby counts as available);
  // utilisation = actually working. The gap between them is idle-but-healthy plant.
  const avail = (b: HourBucket | null) => {
    const total = b ? b.worked + b.standby + b.breakdown : 0
    return b && total > 0 ? (b.worked + b.standby) / total : null
  }
  const util = (b: HourBucket | null) => {
    const total = b ? b.worked + b.standby + b.breakdown : 0
    return b && total > 0 ? b.worked / total : null
  }

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
    legend: { data: ['Fleet availability', 'Utilisation'], bottom: 0 },
    grid: { left: 44, right: 16, top: 20, bottom: buckets.length > ZOOM_AFTER ? 78 : 42 },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
    series: [
      {
        name: 'Fleet availability',
        type: 'line',
        data: buckets.map((b) => {
          const a = avail(b)
          return a == null ? null : Math.round(a * 100)
        }),
        itemStyle: { color: COLOR_WORKED },
        lineStyle: { width: 2.5 },
      },
      {
        name: 'Utilisation',
        type: 'line',
        data: buckets.map((b) => {
          const u = util(b)
          return u == null ? null : Math.round(u * 100)
        }),
        itemStyle: { color: '#3b82f6' },
        lineStyle: { width: 2.5 },
      },
    ],
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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label={`Hours worked · ${latest.label}`} value={`${num(Math.round(latest.worked))} h`}
          sub={`${num(Math.round(latest.standby))} h standby`}
          extra={<Delta now={latest.worked} prev={prev?.worked ?? null} prevLabel={prev?.label ?? ''} />} />
        <Kpi label={`Fleet availability · ${latest.label}`} value={pctFmt(avail(latest))}
          sub={`${num(Math.round(latest.breakdown))} h breakdown`}
          tone={(avail(latest) ?? 1) < 0.5 ? 'bad' : 'good'}
          extra={<Delta now={avail(latest) ?? 0} prev={avail(prev)} prevLabel={prev?.label ?? ''} pts />} />
        <Kpi label={`Utilisation · ${latest.label}`} value={pctFmt(util(latest))}
          sub={`${num(Math.round(latest.worked))} of ${num(Math.round(latest.worked + latest.standby + latest.breakdown))} h`}
          extra={<Delta now={util(latest) ?? 0} prev={util(prev)} prevLabel={prev?.label ?? ''} pts />} />
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
          <Legend>Fleet availability &amp; utilisation</Legend>
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

      {data && <PlantVsWorkCard data={data} fin={fin} gran={gran} year={year} />}

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
                  <th className="px-4 py-2 text-right font-medium">Hours worked</th>
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
            Comparing {efficiency.length} of {effStats?.total ?? efficiency.length} plants — the ones
            with fuel logged to them and at least a day&apos;s work (8 h).
            {(effStats?.noFuel ?? 0) > 0 && ` ${effStats!.noFuel} sit out because no fuel was logged to them (towed or hand-fueled kit).`}
            {(effStats?.lowHours ?? 0) > 0 && ` ${effStats!.lowHours} drew fuel but worked under 8 h.`}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Plant vs Work — fleet effort against project output. Headline metric is
 * work done per machine-hour; the cross-filter reads any bill's work
 * against any fleet type's hours. Hours are never booked to bills in the
 * workbooks, so a filtered view is correlation, not allocation.
 */
function PlantVsWorkCard({ data, fin, gran, year }: {
  data: ProjectPlantData
  fin: ProjectFinancials | undefined
  gran: Granularity
  year: number | 'all'
}) {
  const [bill, setBill] = useState('all')
  const [type, setType] = useState('all')
  const [page, setPage] = useState(0)

  const types = useMemo(
    () => [...new Set(data.plants.map((p) => p.fleet_type).filter((t): t is string => !!t))].sort(),
    [data],
  )
  const bills = (fin?.bills_meta ?? []).filter((b) => b.bill_code != null)

  const rows = useMemo(() => {
    if (!fin) return []
    // hours of the chosen slice of the fleet, per (year, week)
    const typeOf = new Map(data.plants.map((p) => [p.fleet_number_raw, p.fleet_type]))
    const hoursByWeek = new Map<string, { worked: number; standby: number; breakdown: number }>()
    for (const pw of data.plant_weeks) {
      if (year !== 'all' && pw.year !== year) continue
      if (type !== 'all' && typeOf.get(pw.fleet_number_raw) !== type) continue
      const k = `${pw.year}-${pw.week_number}`
      const t = hoursByWeek.get(k) ?? { worked: 0, standby: 0, breakdown: 0 }
      t.worked += pw.worked
      t.standby += pw.standby
      t.breakdown += pw.breakdown
      hoursByWeek.set(k, t)
    }
    const map = new Map<string, {
      label: string; work: number; worked: number; standby: number; breakdown: number
    }>()
    for (const w of fin.weeks) {
      if (year !== 'all' && w.year !== year) continue
      const key = bucketKey(w.year, w.week_number, w.week_ending_date, gran)
      const b = map.get(key) ?? { label: key, work: 0, worked: 0, standby: 0, breakdown: 0 }
      b.work += bill === 'all' ? w.earnings : (w.works_by_bill?.[bill] ?? 0) * VAT
      const h = hoursByWeek.get(`${w.year}-${w.week_number}`)
      if (h) {
        b.worked += h.worked
        b.standby += h.standby
        b.breakdown += h.breakdown
      }
      map.set(key, b)
    }
    return [...map.values()].map((b) => ({
      ...b,
      perHour: b.worked > 0 ? b.work / b.worked : null,
      util: b.worked + b.standby + b.breakdown > 0
        ? b.worked / (b.worked + b.standby + b.breakdown) : null,
    }))
  }, [data, fin, gran, year, bill, type])

  if (rows.length === 0) return null

  const latest = rows[rows.length - 1]
  const prevRow = rows.length > 1 ? rows[rows.length - 2] : null

  const labels = rows.map((r) => r.label)
  const workName = bill === 'all' ? 'Work done (Incl. VAT)' : `Bill ${bill} work (Incl. VAT)`
  const hoursName = type === 'all' ? 'Fleet hours worked' : `${type} hours worked`
  const chartOption = {
    tooltip: { trigger: 'axis' },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    legend: { data: [workName, hoursName], bottom: 0 },
    grid: [
      { left: 64, right: 16, top: 20, height: 140 },
      { left: 64, right: 16, top: 200, height: 115 },
    ],
    xAxis: [
      { type: 'category', data: labels, gridIndex: 0, axisLabel: { show: false }, axisTick: { show: false } },
      { type: 'category', data: labels, gridIndex: 1 },
    ],
    yAxis: [
      { type: 'value', gridIndex: 0, axisLabel: { formatter: compactNaira } },
      { type: 'value', gridIndex: 1, axisLabel: { formatter: '{value} h' } },
    ],
    series: [
      {
        name: workName, type: 'bar', xAxisIndex: 0, yAxisIndex: 0,
        data: rows.map((r) => Math.round(r.work)), itemStyle: { color: COLOR_PLANT_COST },
      },
      {
        name: hoursName, type: 'bar', xAxisIndex: 1, yAxisIndex: 1,
        data: rows.map((r) => Math.round(r.worked)), itemStyle: { color: COLOR_WORKED },
      },
    ],
    ...(rows.length > ZOOM_AFTER
      ? {
          dataZoom: [
            {
              type: 'slider', height: 14, bottom: 26, xAxisIndex: [0, 1],
              start: (1 - ZOOM_AFTER / rows.length) * 100, end: 100,
            },
            { type: 'inside', xAxisIndex: [0, 1] },
          ],
        }
      : {}),
  }

  const pages = Math.max(1, Math.ceil(rows.length / 10))
  const p = Math.min(page, pages - 1)
  const pageRows = rows.slice(p * 10, (p + 1) * 10)
  const pctChange = (now: number | null, prevV: number | null): number | null =>
    now == null || prevV == null || prevV === 0 ? null : ((now - prevV) / prevV) * 100

  return (
    <Card className="relative">
      <Legend>Plant vs Work</Legend>
      <CardContent className="space-y-4 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-xs font-medium uppercase text-muted-foreground">
              Work per machine-hour · {latest.label}
            </span>
            <span className="text-xl font-bold tabular-nums">
              {latest.perHour == null ? '—' : naira(latest.perHour)}
            </span>
            <Delta now={latest.perHour ?? 0} prev={prevRow?.perHour ?? null}
              prevLabel={prevRow?.label ?? ''} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={bill} onValueChange={(v) => { setBill(v); setPage(0) }}>
              <SelectTrigger className="h-8 w-64 text-xs font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All work</SelectItem>
                {bills.map((b) => (
                  <SelectItem key={b.bill_code!} value={b.bill_code!}>
                    Bill {b.bill_code} — {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={type} onValueChange={(v) => { setType(v); setPage(0) }}>
              <SelectTrigger className="h-8 w-56 text-xs font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Whole fleet</SelectItem>
                {types.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <ECharts option={chartOption} style={{ height: 370 }} notMerge />

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-4 py-2 font-medium">Period</th>
                <th className="px-4 py-2 text-right font-medium">Work done (₦)</th>
                <th className="px-4 py-2 text-right font-medium">Hours worked</th>
                <th className="px-4 py-2 text-right font-medium">Work per hour</th>
                <th className="px-4 py-2 text-right font-medium">Utilisation</th>
                <th className="px-4 py-2 text-right font-medium">Work/hr vs Previous</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r, i) => {
                const globalIdx = p * 10 + i
                const prevPerHour = globalIdx > 0 ? rows[globalIdx - 1].perHour : null
                const change = pctChange(r.perHour, prevPerHour)
                return (
                  <tr key={r.label} className="border-b last:border-0">
                    <td className="px-4 py-1.5 font-medium">{r.label}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{naira(r.work)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{num(Math.round(r.worked))}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums font-medium">
                      {r.perHour == null ? '—' : naira(r.perHour)}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums">
                      {r.util == null ? '—' : pctFmt(r.util, 0)}
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      {change == null ? <span className="text-muted-foreground">—</span> : (
                        <span className={`font-medium tabular-nums ${
                          change >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600'
                        }`}>
                          {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}%
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 border-t px-1 pt-2 text-xs">
            <span className="text-muted-foreground">Page {p + 1} of {pages}</span>
            <Button variant="outline" size="sm" className="h-6 px-2 text-xs"
              disabled={p === 0} onClick={() => setPage(p - 1)}>Prev</Button>
            <Button variant="outline" size="sm" className="h-6 px-2 text-xs"
              disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>Next</Button>
          </div>
        )}
        {(bill !== 'all' || type !== 'all') && (
          <p className="text-xs text-muted-foreground">
            Correlation, not allocation — the workbooks never book hours to a bill,
            so this reads the two side by side.
          </p>
        )}
      </CardContent>
    </Card>
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
