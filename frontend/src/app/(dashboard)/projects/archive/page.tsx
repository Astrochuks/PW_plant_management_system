'use client'

/**
 * Archive — finished and historical projects (decision 2026-10-11). A
 * project stays reportable for the period it was active; this page is
 * where it lives once it is archived. First cut: the closed list from the
 * register with search and a state filter.
 */

import { Suspense, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Archive as ArchiveIcon, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { ProtectedRoute } from '@/components/protected-route'
import { useProjects } from '@/hooks/use-projects'
import { useStates } from '@/hooks/use-locations'
import { useDebounce } from '@/hooks/use-debounce'
import { useUrlFilters } from '@/hooks/use-url-filters'
import { fmtDate, money } from '@/lib/format'
import { projectPath } from '@/lib/api/projects'

const FILTER_DEFAULTS = { search: '', state_id: '', page: '1' }

export default function ArchivePage() {
  return (
    <ProtectedRoute requiredRole="projects">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <ArchiveContent />
      </Suspense>
    </ProtectedRoute>
  )
}

function ArchiveContent() {
  const router = useRouter()
  const [filters, setFilters] = useUrlFilters(FILTER_DEFAULTS)
  const search = useDebounce(filters.search, 300)
  const page = Number(filters.page) || 1
  const { data: statesData } = useStates()
  const states = Array.isArray(statesData) ? statesData : []
  const params = useMemo(() => ({
    status: 'archived' as const, search: search || undefined, state_id: filters.state_id || undefined,
    page, limit: 25, sort_by: 'project_name', sort_order: 'asc' as const,
  }), [search, filters.state_id, page])
  const { data, isLoading } = useProjects(params)
  const rows = data?.data ?? []
  const meta = data?.meta

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-primary/10"><ArchiveIcon className="h-6 w-6 text-primary" /></div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Archive</h1>
          <p className="text-sm text-muted-foreground">{meta ? `${meta.total} archived project${meta.total !== 1 ? 's' : ''}` : 'Loading…'}</p>
        </div>
      </div>

      <Card><CardContent className="flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-[260px] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={filters.search} onChange={(e) => setFilters({ search: e.target.value, page: '1' })} placeholder="Search by name, client or short name…" className="pl-9" />
        </div>
        <Select value={filters.state_id || 'all'} onValueChange={(v) => setFilters({ state_id: v === 'all' ? '' : v, page: '1' })}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All states" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            {states.map((s: { id: string; name: string }) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </CardContent></Card>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead><TableHead>State</TableHead><TableHead>Client</TableHead>
              <TableHead>Closed</TableHead><TableHead className="text-right">Final contract sum</TableHead><TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No archived projects match.</TableCell></TableRow>
            ) : rows.map((p) => (
              <TableRow key={p.id} className="cursor-pointer" onClick={() => router.push(projectPath(p))}>
                <TableCell>
                  <div className="font-medium">{p.short_name || p.project_name}</div>
                  {p.short_name && <div className="max-w-md truncate text-xs text-muted-foreground">{p.project_name}</div>}
                </TableCell>
                <TableCell className="text-sm">{p.state_name ?? '—'}</TableCell>
                <TableCell className="text-sm">{p.client}</TableCell>
                <TableCell className="text-sm tabular-nums">
                  {p.final_completion_date ? fmtDate(p.final_completion_date) : p.substantial_completion_date ? fmtDate(p.substantial_completion_date) : <span className="text-muted-foreground">date not on record</span>}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">{p.current_contract_sum != null ? money(p.current_contract_sum) : '—'}</TableCell>
                <TableCell>{p.is_legacy ? <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Legacy register</Badge> : <Badge variant="secondary">Archived</Badge>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {meta && meta.total_pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Page {meta.page} of {meta.total_pages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setFilters({ page: String(page - 1) })}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= meta.total_pages} onClick={() => setFilters({ page: String(page + 1) })}>Next</Button>
          </div>
        </div>
      )}
    </div>
  )
}
