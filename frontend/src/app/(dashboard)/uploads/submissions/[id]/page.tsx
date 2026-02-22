'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Download,
  FileSpreadsheet,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Truck,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { ProtectedRoute } from '@/components/protected-route'
import { useWeeklySubmission } from '@/hooks/use-uploads'
import { downloadSubmissionFile } from '@/lib/api/uploads'

const STATUS_BADGE: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ElementType }> = {
  pending: { variant: 'outline', icon: Clock },
  processing: { variant: 'secondary', icon: Loader2 },
  completed: { variant: 'default', icon: CheckCircle2 },
  failed: { variant: 'destructive', icon: XCircle },
  partial: { variant: 'outline', icon: AlertTriangle },
}

const PAGE_SIZE = 50

function SubmissionDetailContent() {
  const params = useParams()
  const submissionId = params.id as string
  const [page, setPage] = useState(1)

  const { data: response, isLoading } = useWeeklySubmission(submissionId)

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-[80px]" />)}
        </div>
        <Skeleton className="h-[400px] w-full" />
      </div>
    )
  }

  if (!response) {
    return (
      <div className="text-center py-12">
        <FileSpreadsheet className="h-12 w-12 mx-auto mb-4 opacity-50 text-muted-foreground" />
        <p className="text-lg text-muted-foreground">Submission not found</p>
        <Button variant="outline" className="mt-4" asChild>
          <Link href="/uploads/submissions">Back to Submissions</Link>
        </Button>
      </div>
    )
  }

  const { submission, plant_records, file_url } = response.data
  const meta = response.meta
  const badge = STATUS_BADGE[submission.status] || STATUS_BADGE.pending
  const StatusIcon = badge.icon

  // Client-side pagination of plant records
  const totalPages = Math.ceil(plant_records.length / PAGE_SIZE)
  const paginatedRecords = plant_records.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/uploads/submissions"
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              {submission.location_name}
              <Badge variant={badge.variant} className="gap-1">
                <StatusIcon className={`h-3 w-3 ${submission.status === 'processing' ? 'animate-spin' : ''}`} />
                {submission.status}
              </Badge>
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {meta.week_label} &middot; Submitted{' '}
              {new Date(submission.submitted_at).toLocaleDateString('en-NG', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
              {submission.submitted_by_name && ` by ${submission.submitted_by_name}`}
            </p>
          </div>
        </div>
        {(file_url || submission.source_file_name) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadSubmissionFile(submissionId, submission.source_file_name || undefined)}
          >
            <Download className="h-4 w-4 mr-2" />
            Download File
          </Button>
        )}
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase">Plants Processed</p>
            <p className="text-2xl font-bold">
              {submission.plants_processed != null ? Number(submission.plants_processed) : '-'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase">Created</p>
            <p className="text-2xl font-bold text-emerald-600">
              {submission.plants_created != null ? Number(submission.plants_created) : '-'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase">Updated</p>
            <p className="text-2xl font-bold text-blue-600">
              {submission.plants_updated != null ? Number(submission.plants_updated) : '-'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase">Processing Time</p>
            <p className="text-2xl font-bold">
              {meta.processing_duration || '-'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* File Info */}
      {submission.source_file_name && (
        <Card
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => downloadSubmissionFile(submissionId, submission.source_file_name || undefined)}
        >
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{submission.source_file_name}</p>
                <p className="text-xs text-muted-foreground">
                  {meta.file_size_formatted || ''} &middot; {meta.file_extension.toUpperCase()}
                </p>
              </div>
              <Download className="h-4 w-4 text-muted-foreground ml-auto" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Plant Records Table */}
      {plant_records.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {meta.total_records} plant records
              {totalPages > 1 && (
                <span className="text-muted-foreground font-normal ml-2">
                  Page {page} of {totalPages}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">#</TableHead>
                    <TableHead>Fleet #</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Worked</TableHead>
                    <TableHead className="text-right">Standby</TableHead>
                    <TableHead className="text-right">B/Down</TableHead>
                    <TableHead>Condition</TableHead>
                    <TableHead>Remarks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedRecords.map((record, idx) => (
                    <TableRow key={record.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {(page - 1) * PAGE_SIZE + idx + 1}
                      </TableCell>
                      <TableCell className="font-mono font-medium">
                        {record.plant_id ? (
                          <Link
                            href={`/plants/${record.plant_id}`}
                            className="text-primary hover:underline"
                          >
                            {record.fleet_number}
                          </Link>
                        ) : (
                          record.fleet_number
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{record.fleet_type || '-'}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {Number(record.hours_worked)}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {Number(record.standby_hours)}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {Number(record.breakdown_hours)}
                      </TableCell>
                      <TableCell>
                        {record.condition ? (
                          <Badge variant="secondary">{record.condition}</Badge>
                        ) : '-'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]" title={record.remarks || ''}>
                        {record.remarks || '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center">
            <Truck className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">No plant records in this submission</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default function SubmissionDetailPage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <SubmissionDetailContent />
    </ProtectedRoute>
  )
}
