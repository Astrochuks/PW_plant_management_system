'use client'

/**
 * Work & Cost — three views behind a collapsible menu:
 *   Analytics — the period workbench (work / cost / work-vs-cost with filters)
 *   BEME      — the full bill of quantities, as of any stored week
 *   Site      — labour, subcontractors, materials, hired vehicles
 * The view menu (left) and period filter (right) sit on their own row
 * that sticks just below the hub header while scrolling.
 */

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useProjectFinancials } from '@/hooks/use-projects'
import AnalyticsSection, { type Granularity } from './analytics-section'
import WorkDoneSection from './work-done-section'
import SiteSection from './site-section'

const VIEWS = [
  { key: 'analytics', label: 'Analytics' },
  { key: 'beme', label: 'BEME' },
  { key: 'site', label: 'Site' },
] as const

type ViewKey = (typeof VIEWS)[number]['key']

const GRANS: Array<{ key: Granularity; label: string }> = [
  { key: 'week', label: 'Weekly' },
  { key: 'month', label: 'Monthly' },
  { key: 'quarter', label: 'Quarterly' },
  { key: 'year', label: 'Yearly' },
]

export default function WorkCostPage() {
  const params = useParams<{ id: string }>()
  const [view, setView] = useState<ViewKey>('analytics')
  const [gran, setGran] = useState<Granularity>('week')
  const [year, setYear] = useState<string>('all')

  // shared cache with the analytics section — zero extra requests
  const { data: fin } = useProjectFinancials(params.id)
  const years = useMemo(
    () => [...new Set((fin?.weeks ?? []).map((w) => w.year))].sort((a, b) => b - a),
    [fin],
  )

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

        {view === 'analytics' && (
          <div className="flex items-center gap-2">
            <Select value={year} onValueChange={setYear}>
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

      {view === 'analytics' && <AnalyticsSection gran={gran} year={year === 'all' ? 'all' : Number(year)} />}
      {view === 'beme' && <WorkDoneSection />}
      {view === 'site' && <SiteSection />}
    </div>
  )
}
