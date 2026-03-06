'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Wrench,
  Zap,
  AlertTriangle,
  HelpCircle,
  ClipboardList,
  ArrowLeftRight,
  Clock,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
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
import { useSiteStats, useSitePlants, useIncomingTransfers } from '@/hooks/use-site-report'
import { useDebounce } from '@/hooks/use-debounce'

function getCurrentWeekSunday(): string {
  const d = new Date()
  const day = d.getDay() // 0=Sun,1=Mon,...,6=Sat
  const offset = (7 - day) % 7   // 0 if today is Sun, else days until next Sun
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const CONDITION_STYLES: Record<string, { label: string; className: string }> = {
  working: { label: 'Working', className: 'bg-emerald-100 text-emerald-800' },
  standby: { label: 'Standby', className: 'bg-amber-100 text-amber-800' },
  breakdown: { label: 'Breakdown', className: 'bg-red-100 text-red-800' },
  missing: { label: 'Missing', className: 'bg-purple-100 text-purple-800' },
  faulty: { label: 'Faulty', className: 'bg-orange-100 text-orange-800' },
  scrap: { label: 'Scrap', className: 'bg-gray-100 text-gray-800' },
  off_hire: { label: 'Off Hire', className: 'bg-gray-100 text-gray-600' },
  unverified: { label: 'Unverified', className: 'bg-blue-100 text-blue-800' },
}

const CONDITION_OPTIONS = [
  { value: 'all', label: 'All Conditions' },
  { value: 'working', label: 'Working' },
  { value: 'standby', label: 'Standby' },
  { value: 'breakdown', label: 'Breakdown' },
  { value: 'faulty', label: 'Faulty' },
  { value: 'missing', label: 'Missing' },
  { value: 'off_hire', label: 'Off Hire' },
  { value: 'unverified', label: 'Unverified' },
]

export default function SiteDashboardPage() {
  const { data: stats, isLoading: statsLoading } = useSiteStats()
  const { data: incoming = [] } = useIncomingTransfers()

  const [search, setSearch] = useState('')
  const [condition, setCondition] = useState('all')
  const [page, setPage] = useState(1)
  const debouncedSearch = useDebounce(search, 300)

  const { data: plantsData, isLoading: plantsLoading } = useSitePlants({
    page,
    limit: 20,
    search: debouncedSearch || undefined,
    condition: condition !== 'all' ? condition : undefined,
  })

  const plants = plantsData?.data ?? []
  const meta = plantsData?.meta
  const thisWeek = getCurrentWeekSunday()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          {statsLoading ? (
            <Skeleton className="h-8 w-48 mb-1" />
          ) : (
            <h1 className="text-2xl font-bold tracking-tight">
              {stats?.location_name ?? 'My Site'}
            </h1>
          )}
          {stats?.state_name && (
            <p className="text-sm text-muted-foreground">{stats.state_name}</p>
          )}
        </div>
        <Button asChild>
          <Link href={`/site/report?week=${thisWeek}`}>
            <ClipboardList className="h-4 w-4 mr-2" />
            Fill This Week&apos;s Report
          </Link>
        </Button>
      </div>

      {/* Incoming transfers alert */}
      {incoming.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4 text-amber-600 shrink-0" />
            <span className="text-sm font-medium text-amber-800">
              {incoming.length} incoming transfer{incoming.length > 1 ? 's' : ''} awaiting confirmation
            </span>
          </div>
          <Button variant="outline" size="sm" asChild className="border-amber-300 text-amber-800 hover:bg-amber-100">
            <Link href="/site/transfers">View Transfers</Link>
          </Button>
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statsLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-4 w-20 mb-2" />
                <Skeleton className="h-8 w-12" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <StatCard label="Total Plants" value={stats?.total_plants ?? 0} color="default" icon={null} />
            <StatCard label="Working" value={stats?.working ?? 0} color="emerald" icon={Zap} />
            <StatCard label="Standby" value={stats?.standby ?? 0} color="amber" icon={Clock} />
            <StatCard label="Breakdown" value={stats?.breakdown ?? 0} color="red" icon={Wrench} />
            <StatCard label="Faulty" value={stats?.faulty ?? 0} color="orange" icon={AlertTriangle} />
            <StatCard label="Missing" value={stats?.missing ?? 0} color="purple" icon={HelpCircle} />
            <StatCard label="Off Hire" value={stats?.off_hire ?? 0} color="gray" icon={null} />
            <StatCard label="Unverified" value={stats?.unverified ?? 0} color="blue" icon={null} />
          </>
        )}
      </div>

      {/* Plant List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Plants at this Site</CardTitle>
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by fleet number..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                className="pl-9 h-9"
              />
            </div>
            <Select value={condition} onValueChange={(v) => { setCondition(v); setPage(1) }}>
              <SelectTrigger className="w-full sm:w-[180px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONDITION_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {plantsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : plants.length === 0 ? (
            <div className="text-center py-8">
              <Wrench className="h-10 w-10 mx-auto mb-2 text-muted-foreground opacity-40" />
              <p className="text-sm text-muted-foreground">
                {debouncedSearch || condition !== 'all'
                  ? 'No plants match your filters'
                  : 'No plants assigned to this site'}
              </p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fleet No.</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="hidden sm:table-cell">Type</TableHead>
                    <TableHead>Condition</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plants.map((p) => {
                    const style = CONDITION_STYLES[p.condition ?? ''] ?? { label: p.condition ?? '—', className: 'bg-gray-100 text-gray-600' }
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium text-sm">{p.fleet_number}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                          {p.description ?? '—'}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                          {p.fleet_type ?? '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-xs ${style.className}`}>
                            {style.label}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>

              {/* Pagination */}
              {meta && meta.total_pages > 1 && (
                <div className="flex items-center justify-between pt-4">
                  <p className="text-xs text-muted-foreground">
                    {meta.total} plant{meta.total !== 1 ? 's' : ''} total
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-xs px-2">
                      {page} / {meta.total_pages}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      disabled={page >= meta.total_pages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({
  label,
  value,
  color,
  icon: Icon,
}: {
  label: string
  value: number
  color: string
  icon: React.ElementType | null
}) {
  const colorMap: Record<string, string> = {
    default: 'text-foreground',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    red: 'text-red-600',
    orange: 'text-orange-600',
    purple: 'text-purple-600',
    gray: 'text-gray-500',
    blue: 'text-blue-600',
  }
  const iconColorMap: Record<string, string> = {
    default: 'text-muted-foreground',
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
    orange: 'text-orange-400',
    purple: 'text-purple-400',
    gray: 'text-gray-400',
    blue: 'text-blue-400',
  }
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          {Icon && <Icon className={`h-3.5 w-3.5 ${iconColorMap[color] ?? ''}`} />}
        </div>
        <p className={`text-2xl font-bold ${colorMap[color] ?? ''}`}>{value}</p>
      </CardContent>
    </Card>
  )
}
