'use client'

import { useMemo } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useDashboardFilters } from '@/hooks/use-dashboard-filters'
import { useLocationsWithStats } from '@/hooks/use-locations'
import { useStatesAdmin } from '@/hooks/use-states'
import { useFleetSummary } from '@/hooks/use-dashboard'
import { DashboardPrintButton } from './dashboard-print'

const currentYear = new Date().getFullYear()
const YEARS = Array.from({ length: 5 }, (_, i) => currentYear - i)

export function DashboardFilters() {
  const {
    locationId,
    stateId,
    fleetType,
    year,
    setLocationId,
    setStateId,
    setFleetType,
    setYear,
    reset,
  } = useDashboardFilters()

  const { data: locations } = useLocationsWithStats()
  const { data: states } = useStatesAdmin()
  const { data: fleetTypes } = useFleetSummary()

  // Cascade: when a state is selected, only show sites in that state
  const filteredLocations = useMemo(() => {
    if (!stateId || !locations) return locations
    return locations.filter((loc) => loc.state_id === stateId)
  }, [locations, stateId])

  const hasFilters = locationId || stateId || fleetType || year !== currentYear

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* State filter */}
      <Select
        value={stateId || '_all'}
        onValueChange={(v) => {
          const newStateId = v === '_all' ? null : v
          setStateId(newStateId)
          // Clear location if it doesn't belong to the new state
          if (locationId && newStateId && locations) {
            const loc = locations.find((l) => l.id === locationId)
            if (loc && loc.state_id !== newStateId) setLocationId(null)
          }
        }}
      >
        <SelectTrigger className="w-[160px] h-9 text-sm">
          <SelectValue placeholder="All States" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_all">All States</SelectItem>
          {states?.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Location filter */}
      <Select
        value={locationId || '_all'}
        onValueChange={(v) => setLocationId(v === '_all' ? null : v)}
      >
        <SelectTrigger className="w-[180px] h-9 text-sm">
          <SelectValue placeholder="All Sites" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_all">All Sites</SelectItem>
          {filteredLocations?.map((loc) => (
            <SelectItem key={loc.id} value={loc.id}>
              {loc.location_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Fleet type filter */}
      <Select
        value={fleetType || '_all'}
        onValueChange={(v) => setFleetType(v === '_all' ? null : v)}
      >
        <SelectTrigger className="w-[160px] h-9 text-sm">
          <SelectValue placeholder="All Fleet Types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_all">All Fleet Types</SelectItem>
          {fleetTypes?.map((ft) => (
            <SelectItem key={ft.fleet_type} value={ft.fleet_type}>
              {ft.fleet_type}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Year filter */}
      <Select
        value={String(year)}
        onValueChange={(v) => setYear(Number(v))}
      >
        <SelectTrigger className="w-[100px] h-9 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {YEARS.map((y) => (
            <SelectItem key={y} value={String(y)}>
              {y}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Reset */}
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={reset} className="h-9 gap-1.5 text-muted-foreground">
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </Button>
      )}

      {/* Print — pushed to the right */}
      <div className="ml-auto">
        <DashboardPrintButton />
      </div>
    </div>
  )
}
