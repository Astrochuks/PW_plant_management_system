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
import { useProject, useDeleteProject } from '@/hooks/use-projects'
import { STATUS_STYLES } from '@/components/projects/projects-table'

const PAGES = [
  { seg: '', label: 'Overview', ready: true },
  { seg: 'performance', label: 'Performance', ready: true },
  { seg: 'work-done', label: 'Work done', ready: true },
  { seg: 'costs', label: 'Costs', ready: true },
  { seg: 'plant', label: 'Plant & diesel', ready: true },
  { seg: 'site', label: 'Site', ready: true },
  { seg: 'financials', label: 'Financials', ready: true },
]

export default function ProjectHubLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>()
  const pathname = usePathname()
  const router = useRouter()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const projectId = params.id

  const { data: project } = useProject(projectId)
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
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
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
          {statusStyle && (
            <Badge variant={statusStyle.variant} className={statusStyle.className}>
              {statusStyle.label}
            </Badge>
          )}
          {project?.project_type && (
            <Badge variant="outline" className="capitalize hidden sm:inline-flex">
              {project.project_type}
            </Badge>
          )}
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
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
        )}
      </div>

      {/* Pill navigation */}
      <div className="flex flex-wrap items-center gap-1 border-b pb-2">
        {PAGES.map((p) =>
          p.ready ? (
            <Link
              key={p.seg}
              href={p.seg ? `${base}/${p.seg}` : base}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                activeSeg === p.seg
                  ? 'bg-primary/20 text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {p.label}
            </Link>
          ) : (
            <span
              key={p.seg}
              title="Coming soon"
              className="cursor-default rounded-full px-3.5 py-1.5 text-sm text-muted-foreground/50"
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
