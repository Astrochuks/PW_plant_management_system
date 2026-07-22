'use client'

/**
 * Project hub layout — header + pill navigation (mirrors the workbook:
 * Overview ≈ Contract Summary, Performance ≈ Weekly Summary, then the
 * detail sheets). Unbuilt pages render as muted pills until they ship.
 */

import Link from 'next/link'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { ArrowLeft, Edit2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useAuth } from '@/providers/auth-provider'
import { useProject, useDeleteProject, useProjectIssues, useProjectOverview, useProjectSubmissions } from '@/hooks/use-projects'
import { STATUS_STYLES } from '@/components/projects/projects-table'

const PAGES: Array<{ seg: string; label: string; ready: boolean; adminOnly?: boolean }> = [
  { seg: '', label: 'Overview', ready: true },
  { seg: 'work-cost', label: 'Work & Cost', ready: true },
  { seg: 'plant', label: 'Plant & Diesel', ready: true },
  { seg: 'financials', label: 'Financials', ready: true },
  { seg: 'report', label: 'Report', ready: true },
  { seg: 'submissions', label: 'Submissions', ready: true },
  { seg: 'issues', label: 'Issues', ready: true, adminOnly: true },
]

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
      {/* Three zones: identity · status trio · actions */}
      <div className="grid items-center gap-3 lg:grid-cols-[1fr_auto_1fr]">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/projects')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight">
              {project?.short_name || project?.project_name || '…'}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {project?.client}{project?.state_name ? ` · ${project.state_name}` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-center">
          {statusStyle && (
            <Badge variant={statusStyle.variant} className={statusStyle.className}>
              {statusStyle.label}
            </Badge>
          )}
          {project?.project_type && (
            <Badge variant="outline" className="capitalize">
              {project.project_type}
            </Badge>
          )}
          {scheduleStatus && (
            <Badge className={scheduleStatus === 'overdue'
              ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'}>
              {scheduleStatus === 'overdue' ? 'OVERDUE' : 'ON TRACK'}
            </Badge>
          )}
        </div>
        {isAdmin ? (
          <div className="flex items-center gap-2 lg:justify-end">
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

      {/* Tab bar — button-styled, animated; scrolls sideways on mobile */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {PAGES.filter((p) => !p.adminOnly || isAdmin).map((p) =>
          p.ready ? (
            <Link
              key={p.seg}
              href={p.seg ? `${base}/${p.seg}` : base}
              className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-4 py-2 text-sm font-medium transition-all duration-200 active:scale-95 ${
                activeSeg === p.seg
                  ? 'border-amber-500/50 bg-amber-500/15 text-foreground shadow-sm'
                  : 'border-transparent text-muted-foreground hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:text-foreground hover:shadow-sm'
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
              className="cursor-default whitespace-nowrap rounded-lg border border-transparent px-4 py-2 text-sm text-muted-foreground/50"
            >
              {p.label}
            </span>
          )
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
