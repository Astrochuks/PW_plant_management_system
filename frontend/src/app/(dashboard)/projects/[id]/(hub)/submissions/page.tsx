'use client'

/**
 * Submissions — this project's weekly workbooks: status, sheets,
 * warnings, original files. Same rows as the global submissions page,
 * scoped to one project.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { UploadCloud } from 'lucide-react'
import { useAuth } from '@/providers/auth-provider'
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
  useProjectSubmissions, type ProjectSubmission,
} from '@/hooks/use-projects'
import { STATUS_BADGE, SubmissionRow } from '@/components/projects/submission-row'

export default function ProjectSubmissionsTab() {
  const params = useParams<{ id: string }>()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [status, setStatus] = useState('all')

  const queryParams = useMemo(
    () => ({
      project_id: params.id,
      status: status === 'all' ? undefined : (status as ProjectSubmission['status']),
      limit: 100,
    }),
    [params.id, status],
  )
  const { data, isLoading } = useProjectSubmissions(queryParams, { poll: true })
  const subs = data?.data ?? []
  const hasActive = subs.some((s) => s.status === 'queued' || s.status === 'parsing')

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <CardTitle className="text-base">Weekly report submissions</CardTitle>
              <p className="text-xs text-muted-foreground">
                Every workbook uploaded for this project — click a row for
                sheets, row counts and warnings.
                {hasActive && ' Refreshing automatically…'}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {Object.entries(STATUS_BADGE).map(([v, b]) => (
                    <SelectItem key={v} value={v}>{b.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isAdmin && (
                <Button size="sm" asChild>
                  <Link href="/projects/upload">
                    <UploadCloud className="mr-2 h-4 w-4" />
                    Upload
                  </Link>
                </Button>
              )}
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
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Rows</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {subs.map((sub) => (
                  <SubmissionRow key={sub.id} sub={sub} isAdmin={isAdmin} showProject={false} />
                ))}
                {!isLoading && subs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}
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
