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
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/providers/auth-provider'
import { useProjects } from '@/hooks/use-projects'
import { STATUS_STYLES, effectiveStatus } from '@/components/projects/projects-table'
import { MapPin, Loader2 } from 'lucide-react'

export default function MySitePage() {
  const { user } = useAuth()
  // the API scopes this list to the engineer's assignments (PRD v2 §3.5)
  const { data, isLoading } = useProjects({ limit: 50 })
  const projects = data?.data ?? []

  return (
    <ProtectedRoute requiredRole="site">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Site</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as {user?.full_name || user?.email}
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your projects…
          </div>
        ) : projects.length === 0 ? (
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
        ) : (
          projects.map((p) => {
            const style = STATUS_STYLES[effectiveStatus(p)] || STATUS_STYLES.active
            return (
              <Card key={p.id}>
                <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                  <div>
                    <CardTitle className="text-base">{p.short_name || p.project_name}</CardTitle>
                    {p.short_name && (
                      <p className="mt-1 text-xs text-muted-foreground">{p.project_name}</p>
                    )}
                  </div>
                  <Badge variant={style.variant} className={style.className}>{style.label}</Badge>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {p.client}{p.state_name ? ` · ${p.state_name}` : ''}
                  <p className="mt-2">Bills and the weekly entry form arrive in the next phase.</p>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>
    </ProtectedRoute>
  )
}
