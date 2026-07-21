'use client'

/**
 * One submission row + expandable detail (sheets, row counts, warnings).
 * Shared by the global submissions page and the project hub's
 * Submissions tab (which hides the Project column via showProject).
 */

import { useState } from 'react'
import { toast } from 'sonner'
import {
  CheckCircle2, ClipboardX, Download, RefreshCcw, Trash2, XCircle,
} from 'lucide-react'
import { getSubmissionDownloadUrl } from '@/lib/api/projects'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TableCell, TableRow } from '@/components/ui/table'
import {
  useDeleteProjectSubmission,
  useRetryProjectSubmission,
  type ProjectSubmission,
} from '@/hooks/use-projects'

export const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  queued: { label: 'Queued', className: 'bg-slate-100 text-slate-700' },
  parsing: { label: 'Parsing…', className: 'bg-blue-100 text-blue-700' },
  success: { label: 'Success', className: 'bg-emerald-100 text-emerald-700' },
  partial: { label: 'Partial', className: 'bg-amber-100 text-amber-800' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-700' },
  deleted: { label: 'Deleted', className: 'bg-gray-100 text-gray-500' },
}

export function SubmissionRow({
  sub, isAdmin, showProject = true,
}: {
  sub: ProjectSubmission
  isAdmin: boolean
  showProject?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const retry = useRetryProjectSubmission()
  const deleteSub = useDeleteProjectSubmission()
  const badge = STATUS_BADGE[sub.status] ?? STATUS_BADGE.queued
  const counts = (sub.row_counts ?? {}) as Record<string, unknown>
  const warnings = (counts._warnings ?? []) as string[]
  const rowTotal = Object.entries(counts)
    .filter(([k, v]) => !k.startsWith('_') && typeof v === 'number')
    .reduce((a, [, v]) => a + (v as number), 0)
  const colCount = showProject ? 7 : 6

  return (
    <>
      <TableRow className="cursor-pointer" onClick={() => setExpanded((e) => !e)}>
        <TableCell className="font-medium">
          {sub.year} · W{String(sub.week_number).padStart(2, '0')}
        </TableCell>
        {showProject && (
          <TableCell className="max-w-[220px]">
            <span className="line-clamp-1 text-sm">{sub.short_name || sub.project_name}</span>
          </TableCell>
        )}
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
          <TableCell colSpan={colCount} className="bg-muted/30 whitespace-normal">
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
