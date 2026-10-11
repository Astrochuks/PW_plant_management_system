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
import { homePathForRole } from '@/lib/roles'
import { FleetDashboard } from '@/components/dashboard/fleet-dashboard'

export default function HomePage() {
  const router = useRouter()
  const { user, isLoading } = useAuth()
  // The project manager and the site engineer have their own homes; the
  // fleet dashboard is for the plant-module seats.
  const home = isLoading ? '/' : homePathForRole(user?.role)
  const redirecting = home !== '/'

  useEffect(() => {
    if (redirecting) router.replace(home)
  }, [redirecting, home, router])

  if (redirecting) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return <FleetDashboard />
}
