'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  FileSpreadsheet,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ProtectedRoute } from '@/components/protected-route'
import { useWeeklySubmissions } from '@/hooks/use-uploads'
import { useLocationsWithStats } from '@/hooks/use-locations'

const currentYear = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => currentYear - i)

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'partial', label: 'Partial' },
]

const STATUS_BADGE: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ElementType }> = {
  pending: { variant: 'outline', icon: Clock },
  processing: { variant: 'secondary', icon: Loader2 },
  completed: { variant: 'default', icon: CheckCircle2 },
  failed: { variant: 'destructive', icon: XCircle },
  partial: { variant: 'outline', icon: AlertTriangle },
}

function SubmissionsContent() {
  const router = useRouter()
  const [year, setYear] = useState<string>(String(currentYear))
  const [locationId, setLocationId] = useState<string>('')
  const [status, setStatus] = useState<string>('')
  const [page, setPage] = useState(1)

  const { data: locations = [] } = useLocationsWithStats()

  const params = {
    page,
    limit: 25,
    ...(year && year !== 'all' ? { year: Number(year) } : {}),
    ...(locationId && locationId !== 'all' ? { location_id: locationId } : {}),
    ...(status && status !== 'all' ? { status } : {}),
  }

  const { data: response, isLoading } = useWeeklySubmissions(params)
  const submissions = response?.data ?? []
  const meta = response?.meta

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/uploads"
          className="p-2 rounded-lg hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Upload Submissions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Browse all weekly report submissions
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      {meta?.counts && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground uppercase">Total</p>
              <p className="text-2xl font-bold">{meta.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground uppercase">Completed</p>
              <p className="text-2xl font-bold text-emerald-600">
                {Number(meta.counts.by_status?.completed ?? 0)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground uppercase">Failed</p>
              <p className="text-2xl font-bold text-red-600">
                {Number(meta.counts.by_status?.failed ?? 0)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground uppercase">Plants Processed</p>
              <p className="text-2xl font-bold">
                {Number(meta.counts.total_plants_processed ?? 0).toLocaleString()}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={year} onValueChange={(v) => { setYear(v); setPage(1) }}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All years</SelectItem>
            {YEAR_OPTIONS.map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={locationId} onValueChange={(v) => { setLocationId(v); setPage(1) }}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All locations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All locations</SelectItem>
            {locations.map((loc) => (
              <SelectItem key={loc.id} value={loc.id}>{loc.location_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1) }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isLoading ? (
        <Skeleton className="h-[400px] w-full" />
      ) : submissions.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {meta && Number(meta.total).toLocaleString()} submissions
              {meta && meta.total_pages > 1 && (
                <span className="text-muted-foreground font-normal ml-2">
                  Page {meta.page} of {meta.total_pages}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-center">Week</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Plants</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {submissions.map((sub) => {
                    const badge = STATUS_BADGE[sub.status] || STATUS_BADGE.pending
                    const StatusIcon = badge.icon
                    return (
                      <TableRow
                        key={sub.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => router.push(`/uploads/submissions/${sub.id}`)}
                      >
                        <TableCell className="text-sm">
                          {new Date(sub.submitted_at).toLocaleDateString('en-NG', {
                            day: '2-digit',
                            month: 'short',
                            year: '2-digit',
                          })}
                        </TableCell>
                        <TableCell className="font-medium text-sm">
                          {sub.location_name}
                        </TableCell>
                        <TableCell className="text-center text-sm font-mono">
                          W{sub.week_number}/{sub.year}
                        </TableCell>
                        <TableCell>
                          <Badge variant={badge.variant} className="gap-1">
                            <StatusIcon className={`h-3 w-3 ${sub.status === 'processing' ? 'animate-spin' : ''}`} />
                            {sub.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {sub.plants_processed != null ? Number(sub.plants_processed) : '-'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground truncate max-w-[150px]">
                          {sub.source_file_name || '-'}
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {sub.processing_duration_seconds != null
                            ? `${Number(sub.processing_duration_seconds).toFixed(1)}s`
                            : '-'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {meta && meta.total_pages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  Page {meta.page} of {meta.total_pages}
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
                    disabled={page >= meta.total_pages}
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
          <CardContent className="py-12 text-center">
            <FileSpreadsheet className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
            <p className="font-medium">No submissions found</p>
            <p className="text-sm text-muted-foreground mt-1">
              Adjust filters or upload a weekly report.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default function SubmissionsPage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <SubmissionsContent />
    </ProtectedRoute>
  )
}
