'use client'

/**
 * Project hub layout — header + pill navigation (mirrors the workbook:
 * Overview ≈ Contract Summary, Performance ≈ Weekly Summary, then the
 * detail sheets). Unbuilt pages render as muted pills until they ship.
 */

import Link from 'next/link'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { ArrowLeft, CalendarDays, ChevronRight, Edit2, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useAuth } from '@/providers/auth-provider'
import { useProject, useDeleteProject, usePrefetchHubData, useProjectIssues, useProjectOverview, useProjectSubmissions } from '@/hooks/use-projects'
import { STATUS_STYLES, effectiveStatus } from '@/components/projects/project-status'
import { InfoChip } from '@/components/projects/hub-ui'
import { fmtDate, num } from '@/lib/format'

// Four tabs by decision of 2026-10-12: the project's dashboard, its bill of
// quantities, its dated timeline, its weekly submissions. The other routes
// (work-cost, plant, financials, report, documents, team, activity, issues)
// still exist but are off the bar until the sheets behind them return.
const PAGES: Array<{ seg: string; label: string; ready: boolean; adminOnly?: boolean }> = [
  { seg: '', label: 'Overview', ready: true },
  { seg: 'bills', label: 'Bill of Quantities', ready: true },
  { seg: 'history', label: 'Timeline', ready: true },
  { seg: 'submissions', label: 'Submissions', ready: true },
]

function StatusDot({ dot, label, className = '' }: {
  dot: string; label: string; className?: string
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${className}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      {label}
    </span>
  )
}

export default function ProjectHubLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>()
  const pathname = usePathname()
  const router = useRouter()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const projectId = params.id

  const { data: project, isError: projectMissing } = useProject(projectId)
  const { data: issues } = useProjectIssues(projectId, isAdmin)
  // Watches for workbooks finishing in the background worker: polls only
  // while one is queued/parsing, then invalidates every projects query so
  // the dashboard updates without a manual refresh.
  useProjectSubmissions({ project_id: projectId, limit: 20 }, { watch: true })
  // shared cache with the Overview page — powers the OVERDUE badge here
  const { data: overview } = useProjectOverview(projectId)
  const scheduleStatus = overview?.schedule.status
  // warm every tab's data so switching tabs is instant
  usePrefetchHubData(projectId)
  const deleteMutation = useDeleteProject()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const base = `/projects/${projectId}`
  const activeSeg = pathname === base ? '' : pathname.slice(base.length + 1).split('/')[0]
  const effStatus = project ? effectiveStatus(project) : null
  const statusStyle = effStatus ? (STATUS_STYLES[effStatus] || STATUS_STYLES.active) : null

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(projectId)
      toast.success('Project deleted')
      router.push('/projects/ongoing')
    } catch {
      toast.error('Failed to delete project')
    }
  }

  // A stale link or a deleted project would otherwise sit on skeletons
  // forever — say so instead.
  if (projectMissing) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <p className="text-lg font-medium">Project not found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          It may have been deleted, or the link is out of date.
        </p>
        <Button className="mt-4" variant="outline" asChild>
          <Link href="/projects/ongoing">Back to Ongoing Projects</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Sticky context header: identity + nav + latest-report strip */}
      <div id="hub-sticky" className="sticky top-16 z-20 -mx-6 bg-background px-6 pt-1 shadow-sm">
      {/* Row 1 — navigation. Two controls, both unmistakably controls:
          "Back" (one step) and the register link in the link colour.
          The project name after the chevron is text, not a link. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
        <Button variant="outline" size="sm" className="h-8" onClick={() => router.back()} title="Back one step">
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back
        </Button>
        <span className="hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm">
          <Link
            href={project?.status === 'archived' ? '/projects/archive' : '/projects/ongoing'}
            className="shrink-0 font-medium text-primary underline-offset-4 hover:underline"
          >
            {project?.status === 'archived' ? 'Archive' : 'Ongoing Projects'}
          </Link>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate text-muted-foreground" aria-current="page">
            {project?.short_name || project?.project_name || '…'}
          </span>
        </nav>
      </div>

      {/* Row 2 — identity on the left; status and actions on the right
          (they drop below the title on narrow screens) */}
      <div className="flex flex-col gap-3 pb-1 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-bold tracking-tight">
            {project?.short_name || project?.project_name || '…'}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {project?.client}{project?.state_name ? ` · ${project.state_name}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 lg:shrink-0 lg:justify-end lg:pt-1">
          {statusStyle && (
            <StatusDot
              dot={effStatus === 'active' ? 'bg-emerald-500' : 'bg-slate-400'}
              label={statusStyle.label}
            />
          )}
          {project?.project_type && (
            <StatusDot dot="bg-sky-500" label={project.project_type} className="capitalize" />
          )}
          {scheduleStatus && (
            <StatusDot
              dot={scheduleStatus === 'overdue' ? 'bg-red-500' : 'bg-emerald-500'}
              label={scheduleStatus === 'overdue' ? 'Overdue'
                : scheduleStatus === 'completed' ? 'Completed' : 'On track'}
              className={scheduleStatus === 'overdue' ? 'font-semibold text-red-600'
                : scheduleStatus === 'completed' ? 'text-emerald-700 dark:text-emerald-400' : ''}
            />
          )}
          {isAdmin && (
            <div className="flex items-center gap-2 lg:ml-1 lg:border-l lg:border-border lg:pl-5">
              <Button variant="outline" size="sm" asChild>
                <Link href={`${base}/edit`}>
                  <Edit2 className="h-4 w-4 mr-2" />
                  Edit
                </Link>
              </Button>
              <Button
                variant="outline" size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
                title="Delete project"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Tab bar — folder-style: tabs sit ON the line; the active one
          opens into the page (bottom border removed, background merged) */}
      <div className="mt-5 flex items-end gap-0.5 overflow-x-auto border-b [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {PAGES.filter((p) => !p.adminOnly || isAdmin).map((p) =>
          p.ready ? (
            <Link
              key={p.seg}
              href={p.seg ? `${base}/${p.seg}` : base}
              className={`relative -mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-lg border px-3 py-1.5 text-[13px] font-medium transition-all duration-200 ${
                activeSeg === p.seg
                  ? 'border-primary border-b-transparent bg-primary font-semibold text-primary-foreground shadow-[0_-4px_10px_-4px_rgba(0,0,0,0.25)]'
                  : 'border-border/40 border-b-border bg-muted/50 text-muted-foreground shadow-sm hover:-translate-y-0.5 hover:bg-muted hover:text-foreground hover:shadow-md'
              }`}
            >
              {p.label}
              {p.seg === 'issues' && (issues?.open_count ?? 0) > 0 && (
                <span className="rounded-full bg-amber-500/90 px-1.5 text-[11px] font-semibold leading-4 text-white tabular-nums">
                  {issues!.open_count}
                </span>
              )}
            </Link>
          ) : (
            <span
              key={p.seg}
              title="Coming soon"
              className="-mb-px cursor-default whitespace-nowrap rounded-t-lg border border-transparent px-3 py-1.5 text-[13px] text-muted-foreground/50"
            >
              {p.label}
            </span>
          )
        )}
      </div>

      {/* Latest-report context strip — visible on every hub tab */}
      {overview?.latest_week && (
        <div className="mt-6 mb-8 flex flex-wrap items-center gap-x-6 gap-y-1">
          <InfoChip icon={CalendarDays} label="Latest report"
            value={`W${String(overview.latest_week.week_number).padStart(2, '0')} · Date: ${fmtDate(overview.latest_week.week_ending_date)}`} />
          <InfoChip icon={Users} label="Total headcount"
            value={num(overview.resources.labour_direct + overview.resources.labour_casual)} />
        </div>
      )}
      </div>

      {children}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this project?</DialogTitle>
            <DialogDescription>
              This removes the project, its weekly reports and all parsed data.
              Original workbook files remain in storage.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
              Delete project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
