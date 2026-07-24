'use client'

/**
 * Plant workbench home — the fleet dashboard, under the Plant tab bar.
 * Management reaches the whole plant module through these tabs rather
 * than through a sidebar section.
 */

import { ProtectedRoute } from '@/components/protected-route'
import { FleetDashboard } from '@/components/dashboard/fleet-dashboard'

export default function PlantDashboardPage() {
  return (
    <ProtectedRoute requiredRole="management">
      <FleetDashboard
        title="Plant"
        subtitle="Fleet position across every site — condition, cost and movement"
      />
    </ProtectedRoute>
  )
}
