'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ProtectedRoute } from '@/components/protected-route'
import { useAuditLogs, type AuditLogParams } from '@/hooks/use-audit'
import type { AuditLog } from '@/lib/api/audit'

const TABLE_OPTIONS = [
  'plants_master',
  'locations',
  'states',
  'spare_parts',
  'purchase_orders',
  'fleet_types',
  'notifications',
  'weekly_reports',
]

const ACTION_OPTIONS = ['create', 'update', 'delete', 'transfer', 'upload']

const actionColors: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  create: 'default',
  update: 'secondary',
  delete: 'destructive',
  transfer: 'outline',
  upload: 'outline',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function JsonDiff({ label, data }: { label: string; data: Record<string, unknown> | null }) {
  if (!data || Object.keys(data).length === 0) return null
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
      <pre className="text-xs bg-muted rounded p-2 overflow-x-auto max-h-[200px]">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  )
}

function AuditLogRow({ log }: { log: AuditLog }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetails = log.old_values || log.new_values

  return (
    <>
      <TableRow
        className={hasDetails ? 'cursor-pointer hover:bg-muted/50' : ''}
        onClick={() => hasDetails && setExpanded(!expanded)}
      >
        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
          {formatDate(log.created_at)}
        </TableCell>
        <TableCell className="text-sm">{log.user_email}</TableCell>
        <TableCell>
          <Badge variant={actionColors[log.action] || 'secondary'}>
            {log.action}
          </Badge>
        </TableCell>
        <TableCell className="text-sm font-mono">{log.table_name}</TableCell>
        <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate">
          {log.description || '-'}
        </TableCell>
        <TableCell className="text-sm font-mono text-muted-foreground">
          {log.record_id ? log.record_id.slice(0, 8) : '-'}
        </TableCell>
        <TableCell className="w-8">
          {hasDetails && (
            expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
          )}
        </TableCell>
      </TableRow>
      {expanded && hasDetails && (
        <TableRow>
          <TableCell colSpan={7} className="bg-muted/30 p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <JsonDiff label="Old Values" data={log.old_values} />
              <JsonDiff label="New Values" data={log.new_values} />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

function AuditPageContent() {
  const [filters, setFilters] = useState<AuditLogParams>({ page: 1, limit: 50 })

  const { data, isLoading } = useAuditLogs(filters)
  const logs = data?.data || []
  const meta = data?.meta

  const updateFilter = (key: keyof AuditLogParams, value: string | number | undefined) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value || undefined,
      page: key === 'page' ? (value as number) : 1,
    }))
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ScrollText className="h-6 w-6" />
          Audit Log
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          View all data modification events across the system
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-3">
            <Select
              value={filters.table_name || ''}
              onValueChange={(v) => updateFilter('table_name', v === 'all' ? undefined : v)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All tables" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tables</SelectItem>
                {TABLE_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.action || ''}
              onValueChange={(v) => updateFilter('action', v === 'all' ? undefined : v)}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {ACTION_OPTIONS.map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={filters.start_date || ''}
                onChange={(e) => updateFilter('start_date', e.target.value || undefined)}
                className="w-[160px]"
                placeholder="Start date"
              />
              <span className="text-muted-foreground text-sm">to</span>
              <Input
                type="date"
                value={filters.end_date || ''}
                onChange={(e) => updateFilter('end_date', e.target.value || undefined)}
                className="w-[160px]"
                placeholder="End date"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {isLoading ? (
        <Skeleton className="h-[400px] w-full" />
      ) : logs.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {Number(meta?.total || 0).toLocaleString()} audit entries
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
                    <TableHead>User</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Table</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Record</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <AuditLogRow key={log.id} log={log} />
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {meta && meta.total_pages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  Showing {(meta.page - 1) * meta.limit + 1}-
                  {Math.min(meta.page * meta.limit, Number(meta.total))} of{' '}
                  {Number(meta.total).toLocaleString()}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={meta.page <= 1}
                    onClick={() => updateFilter('page', meta.page - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={meta.page >= meta.total_pages}
                    onClick={() => updateFilter('page', meta.page + 1)}
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
            <ScrollText className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
            <p className="font-medium">No audit entries found</p>
            <p className="text-sm text-muted-foreground mt-1">
              Try adjusting your filters to see more results.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default function AuditPage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <AuditPageContent />
    </ProtectedRoute>
  )
}
