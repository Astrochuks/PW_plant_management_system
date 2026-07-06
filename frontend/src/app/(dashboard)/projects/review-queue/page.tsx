'use client'

/**
 * Register Review Queue (admin) — T1.11
 *
 * Every cell the Award Letters parser could not confidently parse lands
 * here with its raw value. Admin either applies a corrected value (writes
 * through to the project) or dismisses (raw stays as audit, project
 * untouched). Bulk-dismiss clears whole reasons (e.g. all "Ongoing").
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, CheckCircle2, ClipboardList, Loader2, X } from 'lucide-react'

import { ProtectedRoute } from '@/components/protected-route'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  useBulkDismissReviewItems,
  useResolveReviewItem,
  useReviewQueue,
  useReviewQueueSummary,
  type ReviewQueueItem,
} from '@/hooks/use-projects'

const REASON_LABELS: Record<string, string> = {
  narrative_no_date: 'Narrative, no date',
  narrative_status: 'Status word (e.g. Ongoing)',
  narrative_with_date: 'Date found in narrative',
  low_confidence_classification: 'Type/nature uncertain',
  multi_date: 'Multiple dates',
  narrative_text: 'Narrative text',
  no_state_found: 'No state found',
  ambiguous_states: 'Multiple states',
  total_mismatch: 'Contract total mismatch',
  ambiguous_numbers: 'Ambiguous numbers',
  unparseable: 'Unparseable',
  no_numbers_found: 'No numbers found',
  not_plain_number: 'Not a plain number',
  unrecognized_client: 'Client needs confirmation',
  missing_client: 'No client found',
}

const VALUE_HINTS: Record<string, string> = {
  award_date: 'YYYY-MM-DD',
  commencement_date: 'YYYY-MM-DD',
  substantial_completion_date: 'YYYY-MM-DD',
  final_completion_date: 'YYYY-MM-DD',
  maintenance_cert_date: 'YYYY-MM-DD',
  retention_application_date: 'YYYY-MM-DD',
  state: 'State name, e.g. Lagos',
  contract_sum: 'Number, e.g. 125000000',
  variation_sum: 'Number, e.g. 4500000',
  client: 'Client name, e.g. Plateau State Government',
  retention_paid: 'yes or no',
  classification: 'type/nature, e.g. road/rehabilitation',
}

function ResolveCell({ item }: { item: ReviewQueueItem }) {
  const [value, setValue] = useState(item.suggested_value ?? '')
  const resolve = useResolveReviewItem()

  const apply = (v: string | null) => {
    resolve.mutate(
      { id: item.id, value: v },
      {
        onSuccess: (res) => {
          toast.success(
            res.dismissed ? 'Dismissed' : 'Applied to project',
            { description: item.project_name ?? undefined },
          )
        },
        onError: (err: Error) => toast.error('Failed to resolve', { description: err.message }),
      },
    )
  }

  if (item.resolved) {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
        <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
        {item.resolution_value ? `applied: ${item.resolution_value}` : 'dismissed'}
      </span>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={VALUE_HINTS[item.field] ?? 'corrected value'}
        className="h-8 w-44 text-xs"
        disabled={resolve.isPending}
      />
      <Button
        size="sm"
        className="h-8"
        disabled={resolve.isPending || !value.trim()}
        onClick={() => apply(value)}
      >
        {resolve.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Apply'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 px-2"
        disabled={resolve.isPending}
        onClick={() => apply(null)}
        title="Dismiss — keep raw value as-is, project untouched"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

function ReviewQueueContent() {
  const [sheet, setSheet] = useState<string>('all')
  const [reason, setReason] = useState<string>('all')
  const [field, setField] = useState<string>('all')
  const [showResolved, setShowResolved] = useState(false)
  const [page, setPage] = useState(1)
  const pageSize = 25

  const params = useMemo(
    () => ({
      sheet: sheet === 'all' ? undefined : sheet,
      reason: reason === 'all' ? undefined : reason,
      field: field === 'all' ? undefined : field,
      resolved: showResolved ? null : false,
      page,
      page_size: pageSize,
    }),
    [sheet, reason, field, showResolved, page],
  )

  const { data: summary, error: summaryError } = useReviewQueueSummary()
  const { data, isLoading } = useReviewQueue(params)
  const bulkDismiss = useBulkDismissReviewItems()

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1

  const onBulkDismiss = () => {
    if (reason === 'all') return
    bulkDismiss.mutate(
      { reason },
      {
        onSuccess: (res) => {
          toast.success(`Dismissed ${res.dismissed} items`, {
            description: REASON_LABELS[reason] ?? reason,
          })
          setPage(1)
        },
        onError: (err: Error) =>
          toast.error('Bulk dismiss failed', { description: err.message }),
      },
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link href="/projects">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Projects
          </Link>
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <ClipboardList className="h-6 w-6" />
            Register Review Queue
          </h1>
          <p className="text-muted-foreground text-sm">
            Cells the Award Letters parser could not confidently parse — raw values
            preserved. Apply a correction or dismiss.
          </p>
        </div>
        <Badge variant={summary?.open_total ? 'destructive' : 'secondary'} className="text-sm">
          {summary?.open_total ?? '—'} open
        </Badge>
      </div>

      {summaryError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Failed to load queue summary: {summaryError instanceof Error ? summaryError.message : String(summaryError)}
        </div>
      )}

      {/* Sheet-by-sheet cross-check — the primary workflow */}
      <div>
        <p className="text-muted-foreground mb-1.5 text-xs font-medium uppercase tracking-wide">
          By sheet — work through them one at a time
        </p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => { setSheet('all'); setPage(1) }} className="focus:outline-none">
            <Badge variant={sheet === 'all' ? 'default' : 'outline'}>
              All sheets · {summary?.open_total ?? 0}
            </Badge>
          </button>
          {(summary?.by_sheet ?? []).map((sh) => (
            <button
              key={sh.sheet_name ?? '—'}
              onClick={() => {
                setSheet(sh.sheet_name === sheet ? 'all' : (sh.sheet_name ?? 'all'))
                setPage(1)
              }}
              className="focus:outline-none"
            >
              <Badge variant={sheet === sh.sheet_name ? 'default' : 'secondary'}>
                {sh.sheet_name ?? '(no sheet)'} · {sh.n}
              </Badge>
            </button>
          ))}
        </div>
      </div>

      {/* Reason summary chips — click to filter */}
      <div className="flex flex-wrap gap-2">
        {(summary?.by_reason ?? []).map((r) => (
          <button
            key={r.reason}
            onClick={() => {
              setReason(r.reason === reason ? 'all' : r.reason)
              setPage(1)
            }}
            className="focus:outline-none"
          >
            <Badge variant={reason === r.reason ? 'default' : 'outline'}>
              {REASON_LABELS[r.reason] ?? r.reason} · {r.n}
            </Badge>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle className="text-base">Items</CardTitle>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Select
                value={field}
                onValueChange={(v) => {
                  setField(v)
                  setPage(1)
                }}
              >
                <SelectTrigger className="h-8 w-52 text-xs">
                  <SelectValue placeholder="All fields" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All fields</SelectItem>
                  {(summary?.by_field ?? []).map((f) => (
                    <SelectItem key={f.field} value={f.field}>
                      {f.field} ({f.n})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => {
                  setShowResolved((s) => !s)
                  setPage(1)
                }}
              >
                {showResolved ? 'Hide resolved' : 'Show resolved'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-8 text-xs"
                disabled={reason === 'all' || bulkDismiss.isPending}
                onClick={onBulkDismiss}
                title="Dismiss every open item with the selected reason"
              >
                {bulkDismiss.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  'Bulk dismiss reason'
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead>Field</TableHead>
                      <TableHead>Raw value</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="min-w-[300px]">Resolution</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.items ?? []).map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="max-w-[260px]">
                          {item.project_id ? (
                            <Link
                              href={`/projects/${item.project_id}`}
                              className="line-clamp-2 text-xs hover:underline"
                            >
                              {item.project_name ?? '—'}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground line-clamp-2 text-xs">
                              {item.project_name ?? '(project removed)'}
                            </span>
                          )}
                          <span className="text-muted-foreground text-[10px]">
                            {item.sheet_name} · row {item.row_number}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs font-medium">{item.field}</TableCell>
                        <TableCell className="max-w-[220px]">
                          <span
                            className="text-muted-foreground line-clamp-2 font-mono text-xs"
                            title={item.raw_value ?? ''}
                          >
                            {item.raw_value ?? '—'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {REASON_LABELS[item.reason] ?? item.reason}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <ResolveCell item={item} />
                        </TableCell>
                      </TableRow>
                    ))}
                    {data && data.items.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-muted-foreground py-8 text-center text-sm">
                          Nothing to review 🎉
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {data?.total ?? 0} items · page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function ReviewQueuePage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <ReviewQueueContent />
    </ProtectedRoute>
  )
}
