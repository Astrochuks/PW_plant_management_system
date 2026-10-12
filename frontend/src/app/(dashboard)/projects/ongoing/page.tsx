'use client'

/**
 * Ongoing projects — the projects module's register, in the Plant
 * Register's shape (docs/UI_STANDARD.md): title, three summary cards that
 * follow the filters, a search bar and one state filter, then the branded
 * table (Project Name, Client, State, Contract Sum). One API call.
 * Ended projects live in /projects/archive.
 */

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Search, Table2, UploadCloud, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { MiniKpi, MiniKpiRow, MiniKpiSkeleton } from '@/components/shared/mini-kpi'
import { ProtectedRoute } from '@/components/protected-route'
import { useAuth } from '@/providers/auth-provider'
import { useOngoingProjects } from '@/hooks/use-projects'
import { useUrlFilters } from '@/hooks/use-url-filters'
import { useDebounce } from '@/hooks/use-debounce'
import {
  DEFAULT_ONGOING_COLUMNS,
  OngoingTable,
  type OngoingColumnKey,
  type OngoingRow,
} from '@/components/projects/ongoing/ongoing-table'
import { money } from '@/lib/format'

const FILTER_DEFAULTS = { q: '', state: '' }

export default function OngoingProjectsPage() {
  return (
    <ProtectedRoute requiredRole="projects">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <OngoingContent />
      </Suspense>
    </ProtectedRoute>
  )
}

function OngoingContent() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [filters, setFilters, clearFilters] = useUrlFilters(FILTER_DEFAULTS)
  const stateFilter = filters.state || ''

  // search is typed locally and written to the URL after a 300 ms pause
  const [search, setSearch] = useState(filters.q)
  const debouncedSearch = useDebounce(search, 300)
  useEffect(() => {
    if (debouncedSearch !== filters.q) setFilters({ q: debouncedSearch })
  }, [debouncedSearch, filters.q, setFilters])

  const [visibleColumns, setVisibleColumns] = useState<OngoingColumnKey[]>(DEFAULT_ONGOING_COLUMNS)

  const { data: ongoing, isLoading } = useOngoingProjects()

  const allRows = useMemo<OngoingRow[]>(
    () => (ongoing ? ongoing.data.map((project) => ({ project })) : []),
    [ongoing])

  const states = useMemo(
    () => [...new Set(allRows.map((r) => r.project.state_name).filter(Boolean) as string[])].sort(),
    [allRows])

  // the rows on screen — search over project name, short name and client
  const rows = useMemo(() => {
    const q = (filters.q || '').trim().toLowerCase()
    return allRows.filter(({ project: p }) => {
      if (stateFilter && (p.state_name || '') !== stateFilter) return false
      if (!q) return true
      return [p.project_name, p.short_name, p.client].some((v) => v?.toLowerCase().includes(q))
    })
  }, [allRows, filters.q, stateFilter])

  // the three cards follow the filters
  const stateCount = new Set(rows.map((r) => r.project.state_name).filter(Boolean)).size
  const contractTotal = rows.reduce((a, r) => a + (r.project.contract_sum ?? 0), 0)

  const hasActiveFilters = Boolean(filters.q || stateFilter)
  // one phrase names the scope everywhere: cards, banner, export title
  const scope = (stateFilter ? `in ${stateFilter}` : 'for all states') + (filters.q ? ` · search "${filters.q}"` : '')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Ongoing Projects</h1>
        {isAdmin && (
          <div className="flex items-center rounded-lg border bg-card p-0.5 w-fit">
            <Button asChild size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground">
              <Link href="/projects/submissions" title="Weekly Reports"><UploadCloud className="h-4 w-4" /><span className="hidden md:inline md:ml-2">Weekly Reports</span></Link>
            </Button>
            <div className="h-4 w-px bg-border" />
            <Button asChild size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground">
              <Link href="/projects" title="Full register"><Table2 className="h-4 w-4" /><span className="hidden md:inline md:ml-2">Full register</span></Link>
            </Button>
          </div>
        )}
      </div>

      {/* Summary cards follow the scope (UI standard §3b): three across all
          states, two inside one state */}
      <MiniKpiRow>
        {isLoading ? <MiniKpiSkeleton count={stateFilter ? 2 : 3} /> : stateFilter ? (
          <>
            <MiniKpi label={`Total projects in ${stateFilter}`} value={rows.length.toLocaleString()} />
            <MiniKpi label={`Total contract sum in ${stateFilter}`} value={money(contractTotal)} />
          </>
        ) : (
          <>
            <MiniKpi label="Total projects" value={rows.length.toLocaleString()} />
            <MiniKpi label="States" value={stateCount.toLocaleString()} />
            <MiniKpi label="Total contract sum across all states" value={money(contractTotal)} />
          </>
        )}
      </MiniKpiRow>

      {/* Search + state filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            placeholder="Search projects or clients..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-11 h-11 text-base"
            aria-label="Search projects or clients"
          />
        </div>
        <Select value={stateFilter || 'all'} onValueChange={(v) => setFilters({ state: v === 'all' ? '' : v })}>
          <SelectTrigger className="h-11 w-full sm:w-48" aria-label="Filter by state">
            <SelectValue placeholder="All states" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            {states.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); clearFilters() }}>
            <X className="h-4 w-4 mr-1" />
            Clear filters
          </Button>
        )}
      </div>

      {/* Register table — banner names the scope; export = the screen */}
      <OngoingTable
        rows={rows}
        isLoading={isLoading}
        visibleColumns={visibleColumns}
        onVisibleColumnsChange={setVisibleColumns}
        scope={scope}
        actions={isAdmin ? (
          <Button size="sm" asChild>
            <Link href="/projects/create"><Plus className="h-3.5 w-3.5 mr-1.5" />Add Project</Link>
          </Button>
        ) : null}
      />
    </div>
  )
}
