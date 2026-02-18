'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  MapPin,
  Plus,
  Search,
  Truck,
  AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocationsWithStats, type LocationStats } from '@/hooks/use-locations'
import { useAuth } from '@/providers/auth-provider'

export default function LocationsPage() {
  const router = useRouter()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { data: locations = [], isLoading } = useLocationsWithStats()

  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<string>('all')

  // Extract unique states for filter dropdown
  const states = useMemo(() => {
    const stateMap = new Map<string, string>()
    locations.forEach((loc) => {
      if (loc.state_name && loc.state_code) {
        stateMap.set(loc.state_name, loc.state_code)
      }
    })
    return Array.from(stateMap.entries())
      .map(([name, code]) => ({ name, code }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [locations])

  // Filter locations
  const filtered = useMemo(() => {
    return locations.filter((loc) => {
      const matchesSearch = !search ||
        loc.location_name.toLowerCase().includes(search.toLowerCase())
      const matchesState = stateFilter === 'all' ||
        loc.state_name === stateFilter
      return matchesSearch && matchesState
    })
  }, [locations, search, stateFilter])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sites</h1>
          <p className="text-muted-foreground">
            {locations.length} site{locations.length !== 1 ? 's' : ''} across Nigeria
          </p>
        </div>
        {isAdmin && (
          <Button asChild>
            <Link href="/locations/create">
              <Plus className="h-4 w-4 mr-2" />
              Add Site
            </Link>
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search sites..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={stateFilter} onValueChange={setStateFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All States" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All States</SelectItem>
            {states.map((s) => (
              <SelectItem key={s.name} value={s.name}>
                {s.name} ({s.code})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Location Cards Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <LocationCardSkeleton key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <MapPin className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium">No sites found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {search || stateFilter !== 'all'
              ? 'Try adjusting your filters'
              : 'Add your first site to get started'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((location) => (
            <LocationCard
              key={location.id}
              location={location}
              onClick={() => router.push(`/locations/${location.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function LocationCard({ location, onClick }: { location: LocationStats; onClick: () => void }) {
  const workingPct = location.total_plants > 0
    ? Math.round((location.working_plants / location.total_plants) * 100)
    : 0

  return (
    <Card
      className="cursor-pointer hover:border-primary/50 hover:shadow-md transition-all"
      onClick={onClick}
    >
      <CardHeader className="pb-3 text-center">
        <div className="flex justify-center mb-1">
          <div className="p-2 rounded-lg bg-primary/10">
            <MapPin className="h-4 w-4 text-primary" />
          </div>
        </div>
        <CardTitle className="text-base leading-tight line-clamp-2 break-words">{location.location_name}</CardTitle>
        {location.state_code && (
          <Badge variant="outline" className="text-[10px] font-normal mx-auto w-fit">
            {location.state_code}
          </Badge>
        )}
        <div className="mt-1">
          <span className="text-2xl font-bold">{location.total_plants}</span>
          <span className="text-xs text-muted-foreground ml-1">plants</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Working % bar */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">Working</span>
            <span className="font-medium">{workingPct}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all"
              style={{ width: `${workingPct}%` }}
            />
          </div>
        </div>

        {/* Condition counts */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/50 p-1.5">
            <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{location.working_plants}</p>
            <p className="text-[10px] text-muted-foreground">Working</p>
          </div>
          <div className="rounded-md bg-amber-50 dark:bg-amber-950/50 p-1.5">
            <p className="text-sm font-bold text-amber-600 dark:text-amber-400">{location.standby_plants}</p>
            <p className="text-[10px] text-muted-foreground">Standby</p>
          </div>
          <div className="rounded-md bg-red-50 dark:bg-red-950/50 p-1.5">
            <p className="text-sm font-bold text-red-600 dark:text-red-400">{location.breakdown_plants}</p>
            <p className="text-[10px] text-muted-foreground">Breakdown</p>
          </div>
        </div>

        {/* Alert for breakdown */}
        {location.breakdown_plants > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
            <AlertTriangle className="h-3 w-3" />
            {location.breakdown_plants} plant{location.breakdown_plants !== 1 ? 's' : ''} in breakdown
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function LocationCardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <div>
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-12 mt-1" />
            </div>
          </div>
          <Skeleton className="h-8 w-10" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-2 w-full rounded-full" />
        <div className="grid grid-cols-3 gap-2">
          <Skeleton className="h-12 rounded-md" />
          <Skeleton className="h-12 rounded-md" />
          <Skeleton className="h-12 rounded-md" />
        </div>
      </CardContent>
    </Card>
  )
}
