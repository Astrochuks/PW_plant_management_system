'use client'

/**
 * Plant & Diesel — three views behind a collapsible menu:
 *   Analytics — fleet performance over time (hours mix, availability,
 *               cost vs diesel, fuel-efficiency outliers)
 *   Plants    — per-plant register with weekly drill-down + fleet verdicts
 *   Diesel    — the fuel ledger (charged vs logged, attribution, consumers)
 * The view menu (left) and period filters (right) sit on their own row
 * that sticks just below the hub header while scrolling.
 */

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useProjectPlantData } from '@/hooks/use-projects'
import type { Granularity } from '../work-cost/analytics-section'
import PlantAnalyticsSection from './analytics-section'
import PlantsSection from './plants-section'
import DieselSection from './diesel-section'

const VIEWS = [
  { key: 'analytics', label: 'Analytics' },
  { key: 'plants', label: 'Plants' },
  { key: 'diesel', label: 'Diesel' },
] as const

type ViewKey = (typeof VIEWS)[number]['key']

const GRANS: Array<{ key: Granularity; label: string }> = [
  { key: 'week', label: 'Weekly' },
  { key: 'month', label: 'Monthly' },
  { key: 'quarter', label: 'Quarterly' },
  { key: 'year', label: 'Yearly' },
]

export default function PlantDieselPage() {
  const params = useParams<{ id: string }>()
  const [view, setView] = useState<ViewKey>('analytics')
  const [gran, setGran] = useState<Granularity>('week')
  // 'auto' resolves to the latest stored year once data arrives
  const [year, setYear] = useState<string>('auto')

  // shared cache with the sections — zero extra requests
  const { data } = useProjectPlantData(params.id)
  const years = useMemo(
    () => [...new Set((data?.weekly ?? []).map((w) => w.year))].sort((a, b) => b - a),
    [data],
  )
  const effectiveYear = year === 'auto'
    ? (years[0] != null ? String(years[0]) : 'all')
    : year
  const scopedYear = effectiveYear === 'all' ? ('all' as const) : Number(effectiveYear)

  // pin the control row exactly below the hub's sticky header
  const [top, setTop] = useState(64)
  useEffect(() => {
    const el = document.getElementById('hub-sticky')
    if (!el) return
    const update = () => setTop(64 + el.offsetHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="space-y-5">
      <div
        className="sticky z-[15] -mx-6 flex flex-wrap items-center justify-between gap-2 bg-background px-6 py-2 shadow-sm"
        style={{ top }}
      >
        <Select value={view} onValueChange={(v) => setView(v as ViewKey)}>
          <SelectTrigger className="h-9 w-44 font-semibold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VIEWS.map((v) => (
              <SelectItem key={v.key} value={v.key}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {view !== 'plants' && (
          <div className="flex items-center gap-2">
            <Select value={effectiveYear} onValueChange={setYear}>
              <SelectTrigger className="h-9 w-32 font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All years</SelectItem>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={gran} onValueChange={(v) => setGran(v as Granularity)}>
              <SelectTrigger className="h-9 w-36 font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GRANS.map((g) => (
                  <SelectItem key={g.key} value={g.key}>{g.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {view === 'analytics' && <PlantAnalyticsSection gran={gran} year={scopedYear} />}
      {view === 'plants' && <PlantsSection />}
      {view === 'diesel' && <DieselSection year={scopedYear} gran={gran} />}
    </div>
  )
}
