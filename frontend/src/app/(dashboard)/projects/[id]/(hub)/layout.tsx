'use client'

/**
 * Project hub layout — header + pill navigation (mirrors the workbook:
 * Overview ≈ Contract Summary, Performance ≈ Weekly Summary, then the
 * detail sheets). Unbuilt pages render as muted pills until they ship.
 */

import Link from 'next/link'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { ArrowLeft, CalendarDays, Edit2, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useAuth } from '@/providers/auth-provider'
import { useProject, useDeleteProject, useProjectIssues, useProjectOverview, useProjectSubmissions } from '@/hooks/use-projects'
import { STATUS_STYLES } from '@/components/projects/projects-table'
import { InfoChip } from '@/components/projects/hub-ui'
import { fmtDate, num } from '@/lib/format'

const PAGES: Array<{ seg: string; label: string; ready: boolean; adminOnly?: boolean }> = [
  { seg: '', label: 'Overview', ready: true },
  { seg: 'work-cost', label: 'Work & Cost', ready: true },
  { seg: 'plant', label: 'Plant & Diesel', ready: true },
  { seg: 'financials', label: 'Financials', ready: true },
  { seg: 'report', label: 'Report', ready: true },
  { seg: 'submissions', label: 'Submissions', ready: true },
  { seg: 'issues', label: 'Issues', ready: true, adminOnly: true },
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

  const { data: project } = useProject(projectId)
  const { data: issues } = useProjectIssues(projectId, isAdmin)
  // Watches for workbooks finishing in the background worker: polls only
  // while one is queued/parsing, then invalidates every projects query so
  // the dashboard updates without a manual refresh.
  useProjectSubmissions({ project_id: projectId, limit: 20 }, { watch: true })
  // shared cache with the Overview page — powers the OVERDUE badge here
  const { data: overview } = useProjectOverview(projectId)
  const scheduleStatus = overview?.schedule.status
  const deleteMutation = useDeleteProject()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const base = `/projects/${projectId}`
  const activeSeg = pathname === base ? '' : pathname.slice(base.length + 1).split('/')[0]
  const statusStyle = project ? (STATUS_STYLES[project.status] || STATUS_STYLES.active) : null

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(projectId)
      toast.success('Project deleted')
      router.push('/projects')
    } catch {
      toast.error('Failed to delete project')
    }
  }

  return (
    <div className="space-y-4">
      {/* Sticky context header: identity + nav + latest-report strip */}
      <div className="sticky top-16 z-20 -mx-6 bg-background px-6 pt-1 shadow-sm">
      {/* Three zones: identity · status trio (centered in the leftover space) · actions */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/projects')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {project?.short_name || project?.project_name || '…'}
            </h1>
            <p className="text-xs text-muted-foreground">
              {project?.client}{project?.state_name ? ` · ${project.state_name}` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-start gap-x-5 gap-y-1 lg:justify-center">
          {statusStyle && (
            <StatusDot
              dot={project?.status === 'active' ? 'bg-emerald-500' : 'bg-slate-400'}
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
        </div>
        {isAdmin ? (
          <div className="flex shrink-0 items-center gap-2">
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
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ) : <div />}
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
        <div className="mt-3 mb-4 flex flex-wrap items-center gap-x-6 gap-y-1">
          <InfoChip icon={CalendarDays} label="Latest report"
            value={`W${String(overview.latest_week.week_number).padStart(2, '0')} · Date: ${fmtDate(overview.latest_week.week_ending_date)}`} />
          <InfoChip icon={Users} label="Labour on site"
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
