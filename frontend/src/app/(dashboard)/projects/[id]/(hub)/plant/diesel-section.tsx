'use client'

/**
 * Diesel — the fuel ledger. Charged (Cost Report AGO row — money truth)
 * vs logged (per-plant attribution), the attribution rate over time,
 * and the top consumers for the scoped period.
 */

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import ECharts from 'echarts-for-react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Delta, Kpi, Legend } from '@/components/projects/hub-ui'
import { useProjectFinancials, useProjectPlantData } from '@/hooks/use-projects'
import { naira, num, pctFmt } from '@/lib/format'
import type { Granularity } from '../work-cost/analytics-section'
import { bucketKey } from './analytics-section'

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

export default function DieselSection({ year, gran }: {
  year: number | 'all'
  gran: Granularity
}) {
  const params = useParams<{ id: string }>()
  const { data, isLoading } = useProjectPlantData(params.id)
  const { data: fin } = useProjectFinancials(params.id)

  const weeks = useMemo(
    () => (fin?.weeks ?? []).filter((w) => year === 'all' || w.year === year),
    [fin, year],
  )

  // one period lens drives everything: KPIs read the latest bucket vs the
  // previous one, the charts plot every bucket
  const buckets = useMemo(() => {
    const map = new Map<string, { label: string; cost: number; charged: number; logged: number }>()
    for (const w of weeks) {
      const key = bucketKey(w.year, w.week_number, w.week_ending_date, gran)
      const b = map.get(key) ?? { label: key, cost: 0, charged: 0, logged: 0 }
      b.cost += w.diesel_cost
      b.charged += w.diesel_litres
      b.logged += w.diesel_logged_litres
      map.set(key, b)
    }
    return [...map.values()]
  }, [weeks, gran])

  // top consumers for the latest bucket of the lens — same period the
  // KPIs read, so the whole view answers for one stretch of time
  const latestLabel = useMemo(
    () => (buckets.length ? buckets[buckets.length - 1].label : null),
    [buckets],
  )
  const consumers = useMemo(() => {
    if (!data || !latestLabel) return []
    const dateOf = new Map(
      (fin?.weeks ?? []).map((w) => [`${w.year}-${w.week_number}`, w.week_ending_date]),
    )
    const byPlant = new Map<string, { diesel: number; worked: number }>()
    for (const pw of data.plant_weeks) {
      if (year !== 'all' && pw.year !== year) continue
      const ending = dateOf.get(`${pw.year}-${pw.week_number}`)
      if (!ending) continue
      if (bucketKey(pw.year, pw.week_number, ending, gran) !== latestLabel) continue
      if (pw.diesel_litres === 0 && pw.worked === 0) continue
      const t = byPlant.get(pw.fleet_number_raw) ?? { diesel: 0, worked: 0 }
      t.diesel += pw.diesel_litres
      t.worked += pw.worked
      byPlant.set(pw.fleet_number_raw, t)
    }
    const meta = new Map(data.plants.map((p) => [p.fleet_number_raw, p]))
    const totalLogged = [...byPlant.values()].reduce((a, t) => a + t.diesel, 0)
    return [...byPlant.entries()]
      .filter(([, t]) => t.diesel > 0)
      .map(([raw, t]) => {
        const p = meta.get(raw)
        return {
          raw,
          fleet: p?.fleet_number ?? raw,
          description: p?.description ?? null,
          diesel: t.diesel,
          worked: t.worked,
          share: totalLogged > 0 ? t.diesel / totalLogged : null,
          lph: t.worked > 0 ? t.diesel / t.worked : null,
        }
      })
      .sort((a, b) => b.diesel - a.diesel)
  }, [data, fin, year, gran, latestLabel])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-72" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  if (weeks.length === 0) {
    return (
      <div className="rounded-lg border py-12 text-center text-muted-foreground">
        <p className="text-lg font-medium text-foreground">
          {(fin?.weeks.length ?? 0) > 0 ? `No stored weeks in ${year}` : 'No weekly reports yet'}
        </p>
        <p className="mt-1 text-sm">The fuel ledger builds itself from uploaded weeks.</p>
      </div>
    )
  }

  const latest = buckets[buckets.length - 1]
  const prevB = buckets.length > 1 ? buckets[buckets.length - 2] : null
  const labels = buckets.map((b) => b.label)

  const litresOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['Charged (AGO row)', 'Logged (per plant)'], bottom: 0 },
    grid: { left: 60, right: 20, top: 20, bottom: buckets.length > ZOOM_AFTER ? 64 : 42 },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value', axisLabel: { formatter: '{value} L' } },
    series: [
      { name: 'Charged (AGO row)', type: 'line', data: buckets.map((b) => Math.round(b.charged)), itemStyle: { color: '#f59e0b' }, lineStyle: { width: 2.5 } },
      { name: 'Logged (per plant)', type: 'line', data: buckets.map((b) => Math.round(b.logged)), itemStyle: { color: '#6b7280' }, lineStyle: { width: 2, type: 'dashed' } },
    ],
    ...zoomProps(buckets.length),
  }

  const attributionOption = {
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${v}%` },
    grid: { left: 44, right: 16, top: 20, bottom: buckets.length > ZOOM_AFTER ? 56 : 30 },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value', axisLabel: { formatter: '{value}%' } },
    series: [{
      type: 'line',
      data: buckets.map((b) =>
        b.charged > 0 ? Math.round((b.logged / b.charged) * 100) : null),
      itemStyle: { color: '#8b5cf6' },
      lineStyle: { width: 2.5 },
    }],
    ...zoomProps(buckets.length),
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label={`Diesel (AGO) · ${latest.label}`} value={naira(latest.cost, true)}
          sub={naira(latest.cost)}
          extra={<Delta now={latest.cost} prev={prevB?.cost ?? null} prevLabel={prevB?.label ?? ''} downIsGood />} />
        <Kpi label={`Charged · ${latest.label}`} value={`${num(Math.round(latest.charged))} L`}
          extra={<Delta now={latest.charged} prev={prevB?.charged ?? null} prevLabel={prevB?.label ?? ''} downIsGood />} />
        <Kpi label={`Attribution · ${latest.label}`}
          value={latest.charged > 0 ? pctFmt(latest.logged / latest.charged, 0) : '—'}
          sub={`${num(Math.round(latest.logged))} L of ${num(Math.round(latest.charged))} L logged`}
          extra={<Delta
            now={latest.charged > 0 ? latest.logged / latest.charged : 0}
            prev={prevB && prevB.charged > 0 ? prevB.logged / prevB.charged : null}
            prevLabel={prevB?.label ?? ''} pts />} />
        <Kpi label={`Avg rate · ${latest.label}`}
          value={latest.charged > 0 ? `${naira(latest.cost / latest.charged)}/L` : '—'}
          extra={<Delta
            now={latest.charged > 0 ? latest.cost / latest.charged : 0}
            prev={prevB && prevB.charged > 0 ? prevB.cost / prevB.charged : null}
            prevLabel={prevB?.label ?? ''} downIsGood />} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="relative">
          <Legend>Diesel · charged vs logged</Legend>
          <CardContent className="pt-3">
            <ECharts option={litresOption} style={{ height: 280 }} notMerge />
          </CardContent>
        </Card>
        <Card className="relative">
          <Legend>Attribution rate · logged ÷ charged</Legend>
          <CardContent className="pt-3">
            <ECharts option={attributionOption} style={{ height: 280 }} notMerge />
          </CardContent>
        </Card>
      </div>

      <Card className="relative">
        <Legend>Top consumers{latestLabel ? ` · ${latestLabel}` : ''}</Legend>
        <CardContent className="p-0 pt-2">
          <div className="max-h-[440px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b bg-primary text-left text-primary-foreground">
                  <th className="px-4 py-2 font-bold">Fleet</th>
                  <th className="px-4 py-2 font-bold">Description</th>
                  <th className="px-4 py-2 text-right font-bold">Diesel L</th>
                  <th className="px-4 py-2 text-right font-bold">Share</th>
                  <th className="px-4 py-2 text-right font-bold">Hours worked</th>
                  <th className="px-4 py-2 text-right font-bold">L/hr</th>
                </tr>
              </thead>
              <tbody>
                {consumers.map((c) => (
                  <tr key={c.raw} className="border-b last:border-0">
                    <td className="px-4 py-1.5 font-medium tabular-nums">{c.fleet}</td>
                    <td className="max-w-[240px] truncate px-4 py-1.5 text-muted-foreground">{c.description ?? '—'}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{num(Math.round(c.diesel))}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{c.share == null ? '—' : pctFmt(c.share)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{num(Math.round(c.worked))}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{c.lph == null ? '—' : c.lph.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            {consumers.length} plants drew fuel in {latestLabel ?? 'this period'}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
