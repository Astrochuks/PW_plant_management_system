'use client'

/**
 * Issues — the admin data-quality tab. Everything wrong or unverified
 * about this project's data in one place. Derived issues (missing
 * weeks, unresolved fleet, scope > contract, template-copied register
 * dates) clear themselves when the data is fixed; sheet flags are
 * resolved by an admin — stamped who/when/why, never deleted.
 */

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import {
  AlertTriangle, CalendarX2, CheckCircle2, FileWarning, Scale, Truck, Undo2,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Legend } from '@/components/projects/hub-ui'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/providers/auth-provider'
import { useProjectIssues, projectsKeys } from '@/hooks/use-projects'
import { resolveSheetFlag, unresolveSheetFlag, type SheetFlag } from '@/lib/api/projects'
import { getErrorMessage } from '@/lib/api/client'
import { ProtectedRoute } from '@/components/protected-route'
import { fmtDate, nairaM, weekLabel } from '@/lib/format'

const SEVERITY_BADGE: Record<string, string> = {
  error: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  info: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
}

export default function ProjectIssuesPage() {
  // The tab is hidden for everyone but admins; gate the URL too.
  return (
    <ProtectedRoute requiredRole="admin">
      <IssuesContent />
    </ProtectedRoute>
  )
}

function IssuesContent() {
  const params = useParams<{ id: string }>()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { data: issues, isLoading } = useProjectIssues(params.id)
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)

  if (isLoading || !issues) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
      </div>
    )
  }

  const refresh = () =>
    qc.invalidateQueries({ queryKey: projectsKeys.detail(params.id) })

  const handleResolve = async (flag: SheetFlag) => {
    setBusy(flag.id)
    try {
      await resolveSheetFlag(flag.id)
      toast.success('Flag resolved — stamped, not deleted')
      refresh()
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const handleUnresolve = async (flag: SheetFlag) => {
    setBusy(flag.id)
    try {
      await unresolveSheetFlag(flag.id)
      toast.success('Flag reopened')
      refresh()
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const openFlags = issues.flags.filter((f) => !f.resolved_at)
  const resolvedFlags = issues.flags.filter((f) => f.resolved_at)
  const base = `/projects/${params.id}`

  const allClear =
    issues.open_count === 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {allClear
            ? 'Nothing open — every known issue is resolved or the data is clean.'
            : `${issues.open_count} open issue${issues.open_count === 1 ? '' : 's'} — derived ones clear when the data is fixed; flags clear when you resolve them.`}
        </p>
      </div>

      {allClear && (
        <Card className="border-emerald-300 dark:border-emerald-800">
          <CardContent className="flex items-center gap-3 py-6">
            <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            <p className="text-sm">All clear. New uploads re-run every check automatically.</p>
          </CardContent>
        </Card>
      )}

      {/* Missing weeks */}
      {issues.missing_weeks.length > 0 && (
        <IssueCard
          icon={CalendarX2}
          title={`Missing weeks (${issues.missing_weeks.length})`}
          subtitle="Holes inside the stored range, plus ranges bridged by gap adjustments. Clears when the week is uploaded."
        >
          <div className="flex flex-wrap gap-1.5">
            {issues.missing_weeks.map(([y, w]) => (
              <Badge key={`${y}-${w}`} variant="outline" className="tabular-nums">
                {weekLabel(y, w)}
              </Badge>
            ))}
          </div>
          <Button asChild size="sm" variant="outline" className="mt-3">
            <Link href="/projects/upload">Upload a missing week</Link>
          </Button>
        </IssueCard>
      )}

      {/* Sheet flags */}
      {(openFlags.length > 0 || resolvedFlags.length > 0) && (
        <IssueCard
          icon={FileWarning}
          title={`Sheet flags (${openFlags.length} open)`}
          subtitle="Raised by the parsers during ingest — cross-check failures, chain breaks, stale copies, frozen columns."
        >
          <FlagsTable
            flags={openFlags}
            isAdmin={isAdmin}
            busy={busy}
            action="resolve"
            onAction={handleResolve}
          />
          {resolvedFlags.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                className="text-xs text-muted-foreground underline hover:text-foreground"
                onClick={() => setShowResolved((s) => !s)}
              >
                {showResolved ? 'Hide' : 'Show'} {resolvedFlags.length} resolved
              </button>
              {showResolved && (
                <div className="mt-2">
                  <FlagsTable
                    flags={resolvedFlags}
                    isAdmin={isAdmin}
                    busy={busy}
                    action="unresolve"
                    onAction={handleUnresolve}
                  />
                </div>
              )}
            </div>
          )}
        </IssueCard>
      )}

      {/* Unresolved fleet */}
      {issues.unresolved_fleet.length > 0 && (
        <IssueCard
          icon={Truck}
          title={`Fleet numbers awaiting a verdict (${issues.unresolved_fleet.length})`}
          subtitle="Seen on Plant Return / Diesel sheets but not linked to the register or settled as external. Verdicts live on the Plant & Diesel tab."
        >
          <div className="flex flex-wrap gap-1.5">
            {issues.unresolved_fleet.map((f) => (
              <Badge key={f.fleet_number_raw} variant="outline" className="tabular-nums">
                {f.fleet_number_raw} · {f.occurrences}×
              </Badge>
            ))}
          </div>
          <Button asChild size="sm" variant="outline" className="mt-3">
            <Link href={`${base}/plant`}>Open the verdict queue</Link>
          </Button>
        </IssueCard>
      )}

      {/* Scope exceeds contract */}
      {issues.scope_exceeds_contract && (
        <IssueCard
          icon={Scale}
          title="BEME scope exceeds contract sum — variation pending"
          subtitle="The priced scope is bigger than the registered contract. Clears when the register's contract sum is revised."
        >
          <p className="text-sm tabular-nums">
            BEME scope <b>₦{nairaM(issues.scope_exceeds_contract.scope)}m</b> vs
            contract <b>₦{nairaM(issues.scope_exceeds_contract.contract)}m</b>{' '}
            — over by ₦{nairaM(issues.scope_exceeds_contract.scope - issues.scope_exceeds_contract.contract)}m
          </p>
        </IssueCard>
      )}

      {/* Register dates suspect */}
      {issues.register_dates_suspect && (
        <IssueCard
          icon={AlertTriangle}
          title="Register dates look like template copies"
          subtitle={`Award, commencement and completion dates are byte-identical to: ${issues.register_dates_suspect.twins.join(', ')}. Verify against the real award letter, then edit the project.`}
        >
          <p className="text-sm">
            Award {fmtDate(issues.register_dates_suspect.award_date)} · Commencement{' '}
            {fmtDate(issues.register_dates_suspect.commencement_date)} · Completion{' '}
            {fmtDate(issues.register_dates_suspect.revised_completion_date)}
          </p>
          <Button asChild size="sm" variant="outline" className="mt-3">
            <Link href={`${base}/edit`}>Edit register dates</Link>
          </Button>
        </IssueCard>
      )}

      {/* Young ledgers — informational */}
      {(issues.young_ledger.certificates || issues.young_ledger.payments) && (
        <Card>
          <CardContent className="py-4 text-xs text-muted-foreground">
            Young ledger:{' '}
            {issues.young_ledger.certificates && 'no certificates recorded yet'}
            {issues.young_ledger.certificates && issues.young_ledger.payments && ' · '}
            {issues.young_ledger.payments && 'no payments recorded yet'}
            {' '}— informational only, not counted as an open issue.
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function IssueCard({ icon: Icon, title, subtitle, children }: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <Card className="relative">
      <Legend><Icon className="h-4 w-4 text-amber-600" /> {title}</Legend>
      <CardHeader className="pb-1 pt-5">
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function FlagsTable({ flags, isAdmin, busy, action, onAction }: {
  flags: SheetFlag[]
  isAdmin: boolean
  busy: string | null
  action: 'resolve' | 'unresolve'
  onAction: (f: SheetFlag) => void
}) {
  if (flags.length === 0) {
    return <p className="text-xs text-muted-foreground">No open flags.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs bg-primary text-primary-foreground">
            <th className="py-1.5 pr-3 font-bold">Week</th>
            <th className="py-1.5 pr-3 font-bold">Sheet</th>
            <th className="py-1.5 pr-3 font-bold">Severity</th>
            <th className="py-1.5 pr-3 font-bold">Message</th>
            <th className="py-1.5 text-right font-bold" />
          </tr>
        </thead>
        <tbody>
          {flags.map((f) => (
            <tr key={f.id} className="border-b align-top last:border-0">
              <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">
                {weekLabel(f.year, f.week_number)}
              </td>
              <td className="whitespace-nowrap py-1.5 pr-3">{f.sheet_name}</td>
              <td className="py-1.5 pr-3">
                <Badge className={SEVERITY_BADGE[f.severity] ?? SEVERITY_BADGE.info}>
                  {f.severity}
                </Badge>
              </td>
              <td className="min-w-[260px] break-words py-1.5 pr-3 text-xs">
                {f.message}
                {f.resolved_at && (
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    resolved by {f.resolved_by ?? '—'} · {fmtDate(f.resolved_at)}
                    {f.resolution_note ? ` · ${f.resolution_note}` : ''}
                  </span>
                )}
              </td>
              <td className="py-1 text-right">
                {isAdmin && (
                  action === 'resolve' ? (
                    <Button
                      size="sm" variant="outline" className="h-7"
                      disabled={busy === f.id}
                      onClick={() => onAction(f)}
                    >
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                      Resolve
                    </Button>
                  ) : (
                    <Button
                      size="sm" variant="ghost" className="h-7"
                      title="Reopen"
                      disabled={busy === f.id}
                      onClick={() => onAction(f)}
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                    </Button>
                  )
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
