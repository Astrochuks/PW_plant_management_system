'use client'

/**
 * The site engineer's home (roles v3).
 *
 * Today a placeholder: project assignments arrive with the register work
 * (PRD v2 §3.5), then this page shows the engineer's project, its bills,
 * and — once the form exists — this week's quantities. Until then it says
 * so plainly rather than showing an empty table.
 */

import { ProtectedRoute } from '@/components/protected-route'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/providers/auth-provider'
import { MapPin } from 'lucide-react'

export default function MySitePage() {
  const { user } = useAuth()

  return (
    <ProtectedRoute requiredRole="site">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Site</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as {user?.full_name || user?.email}
          </p>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center gap-3 space-y-0">
            <MapPin className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">No project assigned yet</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Your project, its bills and the weekly entry form will appear here
            once the admin assigns you to a project. Nothing to do on your side.
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  )
}
