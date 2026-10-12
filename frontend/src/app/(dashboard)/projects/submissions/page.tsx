'use client'

/**
 * Project weekly-report submissions (T2.19) — upload + watch processing.
 * Mirrors the plant upload PATTERN; entirely separate pipeline.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, UploadCloud } from 'lucide-react'

import { useAuth } from '@/providers/auth-provider'
import { ProtectedRoute } from '@/components/protected-route'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  useProjectSubmissions,
  type ProjectSubmission,
} from '@/hooks/use-projects'
import { STATUS_BADGE, SubmissionRow } from '@/components/projects/submission-row'

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
          <Link href="/projects/ongoing">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Ongoing Projects
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
