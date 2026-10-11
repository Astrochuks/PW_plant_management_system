'use client'

/**
 * Team — who works this project (PRD v2 §3.5): users assigned to it, and
 * the General Project Managers who see every project by scope. Assignments
 * are made on Admin → Users & Roles.
 */

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/providers/auth-provider'
import { useProjectTeam } from '@/hooks/use-projects'
import { roleLabel } from '@/lib/roles'
import { fmtDate } from '@/lib/format'

export default function ProjectTeamPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { data, isLoading } = useProjectTeam(id)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Team</h2>
          <p className="text-sm text-muted-foreground">Who may see and work this project.</p>
        </div>
        {user?.role === 'admin' && (
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/users"><Users className="mr-2 h-4 w-4" /> Manage on Users &amp; Roles</Link>
          </Button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Assigned to this project</CardTitle></CardHeader>
            <CardContent>
              {!data?.assigned.length ? (
                <p className="text-sm text-muted-foreground">Nobody assigned yet.</p>
              ) : (
                <ul className="divide-y">
                  {data.assigned.map((m) => (
                    <li key={m.id} className="flex items-center justify-between py-2">
                      <div>
                        <div className="text-sm font-medium">{m.full_name || m.email}</div>
                        <div className="text-xs text-muted-foreground">
                          {m.email}{m.assigned_at ? ` · since ${fmtDate(m.assigned_at.slice(0, 10))}` : ''}
                        </div>
                      </div>
                      <Badge variant="secondary">{roleLabel(m.role)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">General project managers</CardTitle></CardHeader>
            <CardContent>
              {!data?.general_managers.length ? (
                <p className="text-sm text-muted-foreground">None.</p>
              ) : (
                <ul className="divide-y">
                  {data.general_managers.map((m) => (
                    <li key={m.id} className="flex items-center justify-between py-2">
                      <div>
                        <div className="text-sm font-medium">{m.full_name || m.email}</div>
                        <div className="text-xs text-muted-foreground">{m.email} · all projects</div>
                      </div>
                      <Badge variant="outline">{roleLabel(m.role)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
