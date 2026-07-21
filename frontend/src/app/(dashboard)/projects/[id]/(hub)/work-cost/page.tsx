'use client'

/**
 * Work & Cost — production vs spend on one page. Scaffold: the four
 * former tabs (Performance, Work done, Costs, Site) live here as
 * sections until the merged layout is finalised.
 */

import { useState } from 'react'
import PerformanceSection from './performance-section'
import WorkDoneSection from './work-done-section'
import CostsSection from './costs-section'
import SiteSection from './site-section'

const SECTIONS = [
  { key: 'performance', label: 'Performance' },
  { key: 'work-done', label: 'Work done' },
  { key: 'costs', label: 'Costs' },
  { key: 'site', label: 'Site' },
] as const

type SectionKey = (typeof SECTIONS)[number]['key']

export default function WorkCostPage() {
  const [section, setSection] = useState<SectionKey>('performance')

  return (
    <div className="space-y-4">
      <div className="inline-flex items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSection(s.key)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              section === s.key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === 'performance' && <PerformanceSection />}
      {section === 'work-done' && <WorkDoneSection />}
      {section === 'costs' && <CostsSection />}
      {section === 'site' && <SiteSection />}
    </div>
  )
}
