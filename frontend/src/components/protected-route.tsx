'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/providers/auth-provider'
import { Skeleton } from '@/components/ui/skeleton'
import { isProjectManagerRole, isSiteEngineerRole } from '@/lib/roles'

/**
 * Route tiers (roles v3, 2026-10-11):
 *   admin      — admins only
 *   management — the PLANT module: admin or plant officer (name kept — many
 *                pages pass it; the project manager has no plant access)
 *   projects   — the PROJECTS module: admin or project manager
 *   site       — the site engineer's own area
 *   both       — any signed-in user
 */
export type RouteTier = 'admin' | 'management' | 'projects' | 'site' | 'both'

export const roleMayEnter = (role: string | undefined | null, tier: RouteTier): boolean => {
  if (!role) return false
  switch (tier) {
    case 'admin':
      return role === 'admin'
    case 'management':
      return role === 'admin' || role === 'plant_officer'
    case 'projects':
      return role === 'admin' || isProjectManagerRole(role)
    case 'site':
      return isSiteEngineerRole(role)
    case 'both':
      return true
  }
}

interface ProtectedRouteProps {
  requiredRole: RouteTier
  children: React.ReactNode
}

export function ProtectedRoute({ requiredRole, children }: ProtectedRouteProps) {
  const router = useRouter()
  const { user, isLoading } = useAuth()

  useEffect(() => {
    if (isLoading) return
    if (!user) {
      router.push('/login')
      return
    }
    if (!roleMayEnter(user.role, requiredRole)) {
      router.push('/access-denied')
    }
  }, [user, isLoading, requiredRole, router])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-10 w-64" />
        <div className="space-y-4 max-w-3xl">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    )
  }

  if (user && roleMayEnter(user.role, requiredRole)) {
    return <>{children}</>
  }

  // Not authorized — the effect above is redirecting
  return null
}
