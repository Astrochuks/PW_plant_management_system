'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/providers/auth-provider'
import { Skeleton } from '@/components/ui/skeleton'

interface ProtectedRouteProps {
  requiredRole: 'admin' | 'management' | 'both'
  children: React.ReactNode
}

export function ProtectedRoute({ requiredRole, children }: ProtectedRouteProps) {
  const router = useRouter()
  const { user, isLoading } = useAuth()

  useEffect(() => {
    if (isLoading) return

    if (!user) {
      // Not authenticated, redirect to login
      router.push('/login')
      return
    }

    if (requiredRole === 'admin' && user.role !== 'admin') {
      // Admin-only route, user is not admin
      router.push('/access-denied')
      return
    }

    if (requiredRole === 'management' && !['admin', 'management'].includes(user.role)) {
      // Management+ route, user doesn't have permission
      router.push('/access-denied')
      return
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

  // User is authorized
  if (user) {
    return <>{children}</>
  }

  // Not authorized, will be redirected
  return null
}
