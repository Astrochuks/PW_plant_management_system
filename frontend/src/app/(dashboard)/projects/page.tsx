'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FolderKanban, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/providers/auth-provider'
import {
  useProjects,
  useProjectStats,
  useProjectClients,
  usePrefetchProjectDetail,
} from '@/hooks/use-projects'
import { useStates } from '@/hooks/use-locations'
import { useDebounce } from '@/hooks/use-debounce'
import { ProjectsStatsCards } from '@/components/projects/projects-stats-cards'
import { ProjectsFilters } from '@/components/projects/projects-filters'
import { ProjectsTable } from '@/components/projects/projects-table'
import { ImportAwardLettersDialog } from '@/components/projects/import-award-letters-dialog'

type ViewMode = 'active' | 'legacy' | 'all'

export default function ProjectsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>('active')

  // Filter state
  const [search, setSearch] = useState('')
  const [client, setClient] = useState('all')
  const [status, setStatus] = useState('all')
  const [stateId, setStateId] = useState('all')
  const [page, setPage] = useState(1)

  const debouncedSearch = useDebounce(search, 300)

  // Data
  const { data: statsData, isLoading: statsLoading } = useProjectStats()
  const { data: clientsData } = useProjectClients()
  const { data: statesData } = useStates()
  const prefetch = usePrefetchProjectDetail()

  const isLegacyParam = viewMode === 'all' ? undefined : viewMode === 'legacy'

  const { data, isLoading } = useProjects({
    page,
    limit: 20,
    search: debouncedSearch || undefined,
    client: client !== 'all' ? client : undefined,
    status: status !== 'all' ? (status as any) : undefined,
    state_id: stateId !== 'all' ? stateId : undefined,
    is_legacy: isLegacyParam,
  })

  const projects = data?.data ?? []
  const meta = data?.meta
  const clients = clientsData ?? []
  const states = Array.isArray(statesData) ? statesData : (statesData as any)?.data ?? []

  const totals = statsData?.totals

  // Reset page on filter change
  const handleSearchChange = (v: string) => { setSearch(v); setPage(1) }
  const handleClientChange = (v: string) => { setClient(v); setPage(1) }
  const handleStatusChange = (v: string) => { setStatus(v); setPage(1) }
  const handleStateIdChange = (v: string) => { setStateId(v); setPage(1) }
  const handleViewModeChange = (mode: ViewMode) => { setViewMode(mode); setPage(1) }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <FolderKanban className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Project Registry</h1>
            <p className="text-sm text-muted-foreground">
              {meta?.total != null
                ? `${meta.total} project${meta.total !== 1 ? 's' : ''}`
                : 'Loading...'}
            </p>
          </div>
        </div>

        {isAdmin && (
          <div className="flex gap-2">
            <ImportAwardLettersDialog />
            <Button asChild size="sm">
              <Link href="/projects/create">
                <Plus className="h-4 w-4 mr-2" />
                Create Project
              </Link>
            </Button>
          </div>
        )}
      </div>

      {/* Stats */}
      <ProjectsStatsCards stats={statsData} isLoading={statsLoading} />

      {/* Active / Legacy / All Toggle */}
      <div className="flex items-center gap-1 rounded-lg bg-muted p-1 w-fit">
        {([
          { key: 'active' as const, label: 'Active', count: totals?.non_legacy },
          { key: 'legacy' as const, label: 'Legacy', count: totals?.legacy },
          { key: 'all' as const, label: 'All', count: totals?.total },
        ]).map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => handleViewModeChange(key)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              viewMode === key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
            {count != null && (
              <span className="ml-1.5 text-xs text-muted-foreground">({count})</span>
            )}
          </button>
        ))}
      </div>

      {/* Filters */}
      <ProjectsFilters
        search={search}
        onSearchChange={handleSearchChange}
        client={client}
        onClientChange={handleClientChange}
        status={status}
        onStatusChange={handleStatusChange}
        stateId={stateId}
        onStateIdChange={handleStateIdChange}
        clients={clients}
        states={states}
      />

      {/* Table */}
      <ProjectsTable
        projects={projects}
        isLoading={isLoading}
        onPrefetch={prefetch}
      />

      {/* Pagination */}
      {meta && meta.total_pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {meta.page} of {meta.total_pages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!meta.has_more}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
