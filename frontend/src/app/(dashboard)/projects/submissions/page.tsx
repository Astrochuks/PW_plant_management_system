'use client'

/**
 * Project weekly-report submissions (T2.19) — upload + watch processing.
 * Mirrors the plant upload PATTERN; entirely separate pipeline.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  ArrowLeft, CheckCircle2, ClipboardX, Download, FileSpreadsheet, Loader2,
  RefreshCcw, Trash2, UploadCloud, XCircle,
} from 'lucide-react'
import { getSubmissionDownloadUrl } from '@/lib/api/projects'

import { useAuth } from '@/providers/auth-provider'
import { ProtectedRoute } from '@/components/protected-route'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  useDeleteProjectSubmission,
  usePreviewWeeklyReport,
  useProjects,
  useProjectSubmissions,
  useRetryProjectSubmission,
  useUploadWeeklyReport,
  type ProjectSubmission,
  type ReportPreview,
} from '@/hooks/use-projects'
import { ReportPreviewDialog } from '@/components/projects/report-preview-dialog'

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  queued: { label: 'Queued', className: 'bg-slate-100 text-slate-700' },
  parsing: { label: 'Parsing…', className: 'bg-blue-100 text-blue-700' },
  success: { label: 'Success', className: 'bg-emerald-100 text-emerald-700' },
  partial: { label: 'Partial', className: 'bg-amber-100 text-amber-800' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-700' },
  deleted: { label: 'Deleted', className: 'bg-gray-100 text-gray-500' },
}

function UploadDialog() {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [projectId, setProjectId] = useState('')
  const [year, setYear] = useState(new Date().getFullYear())
  const [week, setWeek] = useState(1)
  const [preview, setPreview] = useState<ReportPreview | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const upload = useUploadWeeklyReport()
  const previewMutation = usePreviewWeeklyReport()

  const { data: projectsData } = useProjects({ is_legacy: false, limit: 100 })
  const projects = projectsData?.data ?? []

  // Step 1: parse in memory and show every sheet — nothing stored yet
  const runPreview = () => {
    if (!file || !projectId) return
    previewMutation.mutate(
      { file, projectId },
      {
        onSuccess: (data) => {
          setPreview(data)
          setPreviewOpen(true)
        },
        onError: (err: Error) =>
          toast.error('Could not preview the workbook', {
            description: err.message, duration: 12000,
          }),
      },
    )
  }

  // Step 2: the admin has reviewed the sheets — ingest for real
  const submit = () => {
    if (!file || !projectId) return
    upload.mutate(
      { file, projectId, year, weekNumber: week },
      {
        onSuccess: () => {
          toast.success('Report queued for processing', {
            description: `${year} · Week ${week} — watch the table below`,
          })
          setPreviewOpen(false)
          setOpen(false)
          setFile(null)
          setPreview(null)
        },
        onError: (err: Error) =>
          toast.error('Upload failed', { description: err.message, duration: 12000 }),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UploadCloud className="h-4 w-4 mr-2" />
          Upload Weekly Report
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Project Weekly Report</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Select active project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.short_name || p.project_name.slice(0, 50)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Year</Label>
              <Input type="number" value={year}
                     onChange={(e) => setYear(Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>Week Number</Label>
              <Input type="number" min={1} max={53} value={week}
                     onChange={(e) => setWeek(Number(e.target.value))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Workbook (.xlsx — the 16-sheet weekly report)</Label>
            <Input
              type="file"
              accept=".xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file && (
              <p className="text-muted-foreground flex items-center gap-1 text-xs">
                <FileSpreadsheet className="h-3.5 w-3.5" />
                {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
              </p>
            )}
          </div>
          <Button
            className="w-full"
            disabled={!file || !projectId || previewMutation.isPending}
            onClick={runPreview}
          >
            {previewMutation.isPending
              ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Parsing all 16 sheets…</>
              : 'Preview Sheets'}
          </Button>
          <p className="text-muted-foreground text-xs">
            Every sheet is parsed and shown for review first — nothing is
            saved until you confirm.
          </p>
        </div>
      </DialogContent>
      <ReportPreviewDialog
        preview={preview}
        fileName={file?.name ?? ''}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        onConfirm={submit}
        confirming={upload.isPending}
      />
    </Dialog>
  )
}

function SubmissionRow({ sub, isAdmin }: { sub: ProjectSubmission; isAdmin: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const retry = useRetryProjectSubmission()
  const deleteSub = useDeleteProjectSubmission()
  const badge = STATUS_BADGE[sub.status] ?? STATUS_BADGE.queued
  const counts = (sub.row_counts ?? {}) as Record<string, unknown>
  const warnings = (counts._warnings ?? []) as string[]
  const rowTotal = Object.entries(counts)
    .filter(([k, v]) => !k.startsWith('_') && typeof v === 'number')
    .reduce((a, [, v]) => a + (v as number), 0)

  return (
    <>
      <TableRow className="cursor-pointer" onClick={() => setExpanded((e) => !e)}>
        <TableCell className="font-medium">
          {sub.year} · W{String(sub.week_number).padStart(2, '0')}
        </TableCell>
        <TableCell className="max-w-[220px]">
          <span className="line-clamp-1 text-sm">{sub.short_name || sub.project_name}</span>
        </TableCell>
        <TableCell>
          <Badge className={badge.className}>{badge.label}</Badge>
        </TableCell>
        <TableCell className="text-center text-sm tabular-nums">
          {rowTotal || '—'}
        </TableCell>
        <TableCell className="text-muted-foreground max-w-[200px]">
          {sub.file_name ? (
            <button
              type="button"
              className="group/file flex max-w-full items-center gap-1.5 text-xs hover:text-foreground hover:underline"
              title="Download the original workbook"
              onClick={async (e) => {
                e.stopPropagation()
                try {
                  const { url } = await getSubmissionDownloadUrl(sub.id)
                  window.open(url, '_blank', 'noopener')
                } catch {
                  toast.error('Could not fetch the file — it may have been removed from storage')
                }
              }}
            >
              <Download className="h-3 w-3 shrink-0 opacity-60 group-hover/file:opacity-100" />
              <span className="line-clamp-1 text-left">{sub.file_name}</span>
            </button>
          ) : (
            <span className="line-clamp-1 text-xs">—</span>
          )}
        </TableCell>
        <TableCell className="text-muted-foreground text-xs">
          {new Date(sub.uploaded_at).toLocaleString('en-NG', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
          })}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1">
            {isAdmin && (sub.status === 'failed' || sub.status === 'partial') && (
              <Button
                size="sm" variant="ghost" className="h-7"
                title="Retry processing"
                onClick={(e) => {
                  e.stopPropagation()
                  retry.mutate(sub.id, {
                    onSuccess: () => toast.success('Re-queued'),
                    onError: (err: Error) => toast.error(err.message),
                  })
                }}
              >
                <RefreshCcw className="h-3.5 w-3.5" />
              </Button>
            )}
            {isAdmin && sub.status !== 'queued' && sub.status !== 'parsing' && (
              <Button
                size="sm" variant="ghost"
                className="text-destructive hover:text-destructive h-7"
                title="Delete this week's data"
                disabled={deleteSub.isPending}
                onClick={(e) => {
                  e.stopPropagation()
                  const wk = `W${String(sub.week_number).padStart(2, '0')}/${sub.year}`
                  if (!window.confirm(
                    `Delete ${wk} for ${sub.short_name || sub.project_name}?\n\n` +
                    'This removes ALL data ingested from this file. ' +
                    'You can re-upload the week afterwards.'
                  )) return
                  deleteSub.mutate(sub.id, {
                    onSuccess: (r) => toast.success(
                      r.deleted_week_data
                        ? `${wk} deleted — week data removed`
                        : `${wk} submission deleted (no week data existed)`
                    ),
                    onError: (err: Error) => toast.error(err.message),
                  })
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={7} className="bg-muted/30 whitespace-normal">
            <div className="grid max-w-full gap-4 p-2 text-xs md:grid-cols-2">
              <div className="min-w-0">
                <p className="mb-1 font-semibold">Sheets</p>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(sub.sheets_processed ?? {}).map(([name, st]) => (
                    <Badge
                      key={name} variant="outline"
                      className={
                        st === 'ok' ? 'border-emerald-300 text-emerald-700'
                        : st === 'partial' ? 'border-amber-300 text-amber-700'
                        : 'border-red-300 text-red-700'
                      }
                    >
                      {st === 'ok' ? <CheckCircle2 className="mr-1 h-3 w-3" />
                       : st === 'partial' ? <ClipboardX className="mr-1 h-3 w-3" />
                       : <XCircle className="mr-1 h-3 w-3" />}
                      {name}
                    </Badge>
                  ))}
                </div>
                {sub.error_message && (
                  <p className="text-destructive mt-2">{sub.error_message}</p>
                )}
              </div>
              <div className="min-w-0">
                <p className="mb-1 font-semibold">
                  Rows{sub.parse_duration_ms ? ` · ${(sub.parse_duration_ms / 1000).toFixed(1)}s` : ''}
                </p>
                <div className="text-muted-foreground grid grid-cols-2 gap-x-4">
                  {Object.entries(counts)
                    .filter(([k, v]) => !k.startsWith('_') && typeof v === 'number')
                    .map(([k, v]) => (
                      <span key={k}>
                        {k.replace('project_', '').replace(/_/g, ' ')}: <b>{String(v)}</b>
                      </span>
                    ))}
                </div>
                {warnings.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer font-medium text-amber-700">
                      {warnings.length} warning{warnings.length > 1 ? 's' : ''}
                    </summary>
                    <ul className="text-muted-foreground mt-1 list-disc break-words pl-4">
                      {warnings.slice(0, 12).map((w, i) => <li key={i}>{w}</li>)}
                      {warnings.length > 12 && (
                        <li className="list-none text-[11px] italic">
                          + {warnings.length - 12} more — stored as sheet flags, queryable per week
                        </li>
                      )}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

function SubmissionsContent() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [status, setStatus] = useState('all')

  const params = useMemo(
    () => ({
      status: status === 'all' ? undefined : (status as ProjectSubmission['status']),
      limit: 50,
    }),
    [status],
  )
  const { data, isLoading } = useProjectSubmissions(params, { poll: true })
  const hasActive = (data?.data ?? []).some(
    (s) => s.status === 'queued' || s.status === 'parsing',
  )

  return (
    <div className="space-y-6 p-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link href="/projects">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Projects
          </Link>
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Weekly Report Submissions</h1>
            <p className="text-muted-foreground text-sm">
              Upload a site&apos;s 16-sheet weekly workbook and watch it process,
              sheet by sheet. {hasActive && 'Refreshing automatically…'}
            </p>
          </div>
          {isAdmin && <Button size="sm" asChild>
            <Link href="/projects/upload">
              <UploadCloud className="h-4 w-4 mr-2" />
              Upload Weekly Report
            </Link>
          </Button>}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base">Submissions</CardTitle>
            <div className="ml-auto">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-8 w-40 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {Object.entries(STATUS_BADGE).map(([v, b]) => (
                    <SelectItem key={v} value={v}>{b.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Week</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Rows</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.data ?? []).map((sub) => (
                  <SubmissionRow key={sub.id} sub={sub} isAdmin={isAdmin} />
                ))}
                {data && data.data.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7}
                               className="text-muted-foreground py-8 text-center text-sm">
                      No submissions yet — upload the first weekly report.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function ProjectSubmissionsPage() {
  return (
    <ProtectedRoute requiredRole="projects">
      <SubmissionsContent />
    </ProtectedRoute>
  )
}
