'use client'

/**
 * App home. The fleet dashboard for everyone who works the plant module;
 * management lands on the executive summary instead — for them the fleet
 * dashboard lives inside the Plant workbench.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/providers/auth-provider'
import { isManagementRole } from '@/lib/roles'
import { FleetDashboard } from '@/components/dashboard/fleet-dashboard'

export default function HomePage() {
  const router = useRouter()
  const { user, isLoading } = useAuth()
  const toExecutive = !isLoading && isManagementRole(user?.role)

  useEffect(() => {
    if (toExecutive) router.replace('/projects/executive')
  }, [toExecutive, router])

  if (toExecutive) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return <FleetDashboard />
}
