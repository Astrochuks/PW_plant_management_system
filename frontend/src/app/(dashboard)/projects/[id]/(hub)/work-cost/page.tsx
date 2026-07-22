'use client'

/**
 * Work & Cost — time and depth. The Overview owns to-date positions;
 * this page owns trends (week/month/quarter/year buckets), item-level
 * BEME drill-down, cost movement by category, and the site inputs
 * (labour, subcontractors, materials, hired vehicles).
 */

import PerformanceSection from './performance-section'
import WorkDoneSection from './work-done-section'
import CostsSection from './costs-section'
import SiteSection from './site-section'

export default function WorkCostPage() {
  return (
    <div className="space-y-8">
      <PerformanceSection />
      <WorkDoneSection />
      <CostsSection />
      <SiteSection />
    </div>
  )
}
