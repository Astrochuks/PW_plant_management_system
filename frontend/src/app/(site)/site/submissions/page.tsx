'use client'

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  History,
  Download,
  CheckCircle2,
  Clock,
  XCircle,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import React from 'react'
import { useSiteSubmissions, useExportSubmission, useSubmissionRecords, type SiteSubmission } from '@/hooks/use-site-report'
import { toast } from 'sonner'

const PAGE_SIZE = 20

const STATUS_STYLES: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  completed: { label: 'Completed', className: 'bg-emerald-100 text-emerald-800', icon: CheckCircle2 },
  processing: { label: 'Processing', className: 'bg-blue-100 text-blue-800', icon: Clock },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-800', icon: XCircle },
}

const CONDITION_LABELS: Record<string, string> = {
  working: 'Working', standby: 'Standby', breakdown: 'Breakdown',
  missing: 'Missing', faulty: 'Faulty', scrap: 'Scrap',
  off_hire: 'Off Hire', unverified: 'Unverified', others: 'Others',
}

const CONDITION_COLORS: Record<string, string> = {
  working: 'text-emerald-700 bg-emerald-50',
  standby: 'text-amber-700 bg-amber-50',
  breakdown: 'text-red-700 bg-red-50',
  missing: 'text-purple-700 bg-purple-50',
  faulty: 'text-orange-700 bg-orange-50',
  scrap: 'text-gray-600 bg-gray-100',
  off_hire: 'text-gray-600 bg-gray-100',
  unverified: 'text-blue-700 bg-blue-50',
  others: 'text-muted-foreground bg-muted',
}

export default function SiteSubmissionsPage() {
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const { data, isLoading } = useSiteSubmissions({ page, limit: PAGE_SIZE })
  const exportMutation = useExportSubmission()

  const submissions = data?.data ?? []
  const meta = data?.meta
  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1

  const handleExport = (s: SiteSubmission) => {
    setDownloadingId(s.id)
    exportMutation.mutate(s.id, {
      onSuccess: (blob) => {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `weekly-report-week${s.week_number}-${s.year}.xlsx`
        a.click()
        URL.revokeObjectURL(url)
      },
      onError: () => toast.error('Failed to export submission'),
      onSettled: () => setDownloadingId(null),
    })
  }

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Submissions</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your weekly report submission history — click a row to see plant details
        </p>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : submissions.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <History className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-40" />
            <p className="text-base font-medium text-muted-foreground">No submissions yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Your submitted weekly reports will appear here
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Week Ending</TableHead>
                <TableHead className="text-center">Week</TableHead>
                <TableHead className="text-center">Year</TableHead>
                <TableHead className="text-center">Plants</TableHead>
                <TableHead className="text-center">New</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead className="text-right w-[60px]">Export</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {submissions.map((s) => (
                <React.Fragment key={s.id}>
                  <SubmissionRow
                    submission={s}
                    isExpanded={expandedId === s.id}
                    isDownloading={downloadingId === s.id}
                    onToggle={() => toggleExpand(s.id)}
                    onExport={() => handleExport(s)}
                  />
                  {expandedId === s.id && (
                    <SubmissionRecordsRow submissionId={s.id} />
                  )}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
              Prev
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Submission Row
// ============================================================================

function SubmissionRow({
  submission: s,
  isExpanded,
  isDownloading,
  onToggle,
  onExport,
}: {
  submission: SiteSubmission
  isExpanded: boolean
  isDownloading: boolean
  onToggle: () => void
  onExport: () => void
}) {
  const style = STATUS_STYLES[s.status] ?? STATUS_STYLES.completed
  const StatusIcon = style.icon

  return (
    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={onToggle}>
      <TableCell className="text-center">
        {isExpanded
          ? <ChevronUp className="h-4 w-4 text-muted-foreground mx-auto" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground mx-auto" />}
      </TableCell>
      <TableCell className="font-medium">
        {format(parseISO(s.week_ending_date + 'T00:00:00'), 'dd MMM yyyy')}
      </TableCell>
      <TableCell className="text-center text-muted-foreground">{s.week_number}</TableCell>
      <TableCell className="text-center text-muted-foreground">{s.year}</TableCell>
      <TableCell className="text-center">{s.plants_processed ?? '—'}</TableCell>
      <TableCell className="text-center text-muted-foreground">{s.plants_created ?? '—'}</TableCell>
      <TableCell>
        <Badge variant="outline" className={`text-xs ${style.className}`}>
          <StatusIcon className="h-3 w-3 mr-1" />
          {style.label}
        </Badge>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {format(parseISO(s.created_at), 'dd MMM yyyy, HH:mm')}
      </TableCell>
      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          disabled={isDownloading}
          onClick={onExport}
          title="Download Excel"
        >
          {isDownloading
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Download className="h-3.5 w-3.5" />}
        </Button>
      </TableCell>
    </TableRow>
  )
}

// ============================================================================
// Expanded Records Row
// ============================================================================

function SubmissionRecordsRow({ submissionId }: { submissionId: string }) {
  const { data: records = [], isLoading } = useSubmissionRecords(submissionId)

  return (
    <TableRow className="bg-muted/20 hover:bg-muted/20">
      <TableCell colSpan={9} className="p-0">
        <div className="px-6 py-3">
          {isLoading ? (
            <div className="space-y-1.5 py-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : records.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3 text-center">
              No plant records found for this submission.
            </p>
          ) : (
            <div className="overflow-x-auto rounded border bg-background my-1">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/60">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground w-[100px]">Fleet No.</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Description</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground w-[110px]">Condition</th>
                    <th className="px-3 py-2 text-center font-medium text-muted-foreground w-[65px]">Phys.Ver.</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground w-[75px]">Hrs Worked</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground w-[70px]">Standby</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground w-[80px]">Breakdown</th>
                    <th className="px-3 py-2 text-center font-medium text-muted-foreground w-[60px]">Off Hire</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground w-[110px]">Transfer To</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {records.map((r) => {
                    const condStyle = r.condition
                      ? (CONDITION_COLORS[r.condition] ?? '')
                      : ''
                    return (
                      <tr key={r.fleet_number} className="hover:bg-muted/30 transition-colors">
                        <td className="px-3 py-1.5 font-mono font-medium">{r.fleet_number}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{r.description ?? '—'}</td>
                        <td className="px-3 py-1.5">
                          {r.condition ? (
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${condStyle}`}>
                              {CONDITION_LABELS[r.condition] ?? r.condition}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          {r.physical_verification === true
                            ? <span className="text-emerald-600 font-medium">✓</span>
                            : r.physical_verification === false
                              ? <span className="text-muted-foreground">✗</span>
                              : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.hours_worked ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.standby_hours ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.breakdown_hours ?? '—'}</td>
                        <td className="px-3 py-1.5 text-center">
                          {r.off_hire === true
                            ? <span className="text-amber-600 font-medium">✓</span>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">{r.transfer_to ?? '—'}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{r.remarks ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

// ============================================================================
// Skeleton
// ============================================================================

function TableSkeleton() {
  return (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            {Array.from({ length: 9 }).map((_, i) => (
              <TableHead key={i}><Skeleton className="h-4 w-16" /></TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 5 }).map((_, i) => (
            <TableRow key={i}>
              {Array.from({ length: 9 }).map((_, j) => (
                <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
