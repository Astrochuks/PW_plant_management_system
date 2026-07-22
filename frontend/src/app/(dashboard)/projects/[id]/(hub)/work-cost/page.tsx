'use client'

/**
 * Work & Cost — three views:
 *   Analytics — the period workbench (work / cost / work-vs-cost with filters)
 *   BEME      — the full bill of quantities, as of any stored week
 *   Site      — labour, subcontractors, materials, hired vehicles
 */

import { useState } from 'react'
import AnalyticsSection from './analytics-section'
import WorkDoneSection from './work-done-section'
import SiteSection from './site-section'

const VIEWS = [
  { key: 'analytics', label: 'Analytics' },
  { key: 'beme', label: 'BEME' },
  { key: 'site', label: 'Site' },
] as const

type ViewKey = (typeof VIEWS)[number]['key']

export default function WorkCostPage() {
  const [view, setView] = useState<ViewKey>('analytics')

  return (
    <div className="space-y-5">
      <div className="flex w-fit items-center gap-1 rounded-lg bg-muted p-1">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setView(v.key)}
            className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${
              view === v.key
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === 'analytics' && <AnalyticsSection />}
      {view === 'beme' && <WorkDoneSection />}
      {view === 'site' && <SiteSection />}
    </div>
  )
}
