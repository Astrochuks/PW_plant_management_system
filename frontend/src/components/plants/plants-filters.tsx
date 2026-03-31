'use client';

/**
 * Plants Filters Component
 * Filter controls with multi-select conditions, fleet types, location, and search
 */

import { Search, X, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { Location, FleetType } from '@/hooks/use-plants';

export interface FiltersState {
  search: string;
  condition: string[];
  location_id: string;
  fleet_type: string[];
  purchase_year: number[];
  division: string;
  exclude_locations: string[];
  has_maintenance: boolean;
  verified_only: boolean;
}

// All condition values from the backend
const CONDITIONS = [
  { value: 'working', label: 'Working' },
  { value: 'standby', label: 'Standby' },
  { value: 'under_repair', label: 'Under Repair' },
  { value: 'breakdown', label: 'Breakdown' },
  { value: 'faulty', label: 'Faulty' },
  { value: 'scrap', label: 'Scrap' },
  { value: 'missing', label: 'Missing' },
  { value: 'off_hire', label: 'Off Hire' },
  { value: 'gpm_assessment', label: 'GPM Assessment' },
  { value: 'unverified', label: 'Unverified' },
] as const;

const CONDITION_MAP = new Map<string, string>(CONDITIONS.map((c) => [c.value, c.label]));

interface PlantsFiltersProps {
  filters: FiltersState;
  onFiltersChange: (filters: FiltersState) => void;
  locations: Location[];
  fleetTypes: FleetType[];
  purchaseYears: number[];
  locationsLoading: boolean;
  fleetTypesLoading: boolean;
  purchaseYearsLoading: boolean;
}

export function PlantsFilters({
  filters,
  onFiltersChange,
  locations,
  fleetTypes,
  purchaseYears,
  locationsLoading,
  fleetTypesLoading,
  purchaseYearsLoading,
}: PlantsFiltersProps) {
  const updateFilter = <K extends keyof FiltersState>(key: K, value: FiltersState[K]) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const clearFilters = () => {
    onFiltersChange({
      search: '',
      condition: [],
      location_id: '',
      fleet_type: [],
      purchase_year: [],
      division: '',
      exclude_locations: [],
      has_maintenance: false,
      verified_only: false,
    });
  };

  const toggleCondition = (value: string) => {
    const current = filters.condition;
    const next = current.includes(value)
      ? current.filter((c) => c !== value)
      : [...current, value];
    updateFilter('condition', next);
  };

  const toggleFleetType = (name: string) => {
    const current = filters.fleet_type;
    const next = current.includes(name)
      ? current.filter((t) => t !== name)
      : [...current, name];
    updateFilter('fleet_type', next);
  };

  const togglePurchaseYear = (year: number) => {
    const current = filters.purchase_year;
    const next = current.includes(year)
      ? current.filter((y) => y !== year)
      : [...current, year];
    updateFilter('purchase_year', next);
  };

  const toggleExcludeLocation = (locId: string) => {
    const current = filters.exclude_locations;
    const next = current.includes(locId)
      ? current.filter((id) => id !== locId)
      : [...current, locId];
    updateFilter('exclude_locations', next);
  };

  const hasActiveFilters =
    filters.search ||
    filters.condition.length > 0 ||
    filters.location_id ||
    filters.fleet_type.length > 0 ||
    filters.purchase_year.length > 0 ||
    filters.division ||
    filters.exclude_locations.length > 0 ||
    filters.has_maintenance ||
    filters.verified_only;

  // Find the selected location name for the chip
  const selectedLocationName = filters.location_id
    ? locations.find((l) => l.id === filters.location_id)?.location_name
    : null;

  return (
    <div className="space-y-3 pt-2">
      {/* Search and Actions */}
      <div className="flex gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            placeholder="Search fleet number or description..."
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
            className="pl-11 h-11 text-base"
          />
        </div>
        <div className="flex gap-2">
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-4 w-4 mr-1" />
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {/* Filter Dropdowns */}
      <div className="flex flex-wrap gap-3">
        {/* Condition Multi-Select */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9">
              <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" />
              Condition
              {filters.condition.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-xs font-normal">
                  {filters.condition.length}
                </Badge>
              )}
              <ChevronDown className="h-3.5 w-3.5 ml-1.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[220px]">
            <DropdownMenuLabel>Filter by condition</DropdownMenuLabel>
            <p className="px-2 pb-2 text-xs text-muted-foreground">
              Select one or more to filter
            </p>
            <DropdownMenuSeparator />
            {CONDITIONS.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.value}
                checked={filters.condition.includes(c.value)}
                onCheckedChange={() => toggleCondition(c.value)}
              >
                {c.label}
              </DropdownMenuCheckboxItem>
            ))}
            {filters.condition.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={false}
                  onCheckedChange={() => updateFilter('condition', [])}
                >
                  Clear all
                </DropdownMenuCheckboxItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Site Filter (single select) */}
        {locationsLoading ? (
          <Skeleton className="h-9 w-[180px]" />
        ) : (
          <Select
            value={filters.location_id || 'all'}
            onValueChange={(value) => updateFilter('location_id', value === 'all' ? '' : value)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Site" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sites</SelectItem>
              {locations.map((loc) => (
                <SelectItem key={loc.id} value={loc.id}>
                  {loc.location_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Fleet Type Multi-Select */}
        {fleetTypesLoading ? (
          <Skeleton className="h-9 w-[180px]" />
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                Fleet Type
                {filters.fleet_type.length > 0 && (
                  <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-xs font-normal">
                    {filters.fleet_type.length}
                  </Badge>
                )}
                <ChevronDown className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[240px] max-h-[300px] overflow-y-auto">
              <DropdownMenuLabel>Filter by fleet type</DropdownMenuLabel>
              <p className="px-2 pb-2 text-xs text-muted-foreground">
                Select one or more to filter
              </p>
              <DropdownMenuSeparator />
              {fleetTypes.map((type) => (
                <DropdownMenuCheckboxItem
                  key={type.id}
                  checked={filters.fleet_type.includes(type.name)}
                  onCheckedChange={() => toggleFleetType(type.name)}
                >
                  {type.name}
                </DropdownMenuCheckboxItem>
              ))}
              {filters.fleet_type.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={false}
                    onCheckedChange={() => updateFilter('fleet_type', [])}
                  >
                    Clear all
                  </DropdownMenuCheckboxItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Purchase Year Multi-Select */}
        {purchaseYearsLoading ? (
          <Skeleton className="h-9 w-[150px]" />
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                Purchase Year
                {filters.purchase_year.length > 0 && (
                  <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-xs font-normal">
                    {filters.purchase_year.length}
                  </Badge>
                )}
                <ChevronDown className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[200px] max-h-[300px] overflow-y-auto">
              <DropdownMenuLabel>Filter by purchase year</DropdownMenuLabel>
              <p className="px-2 pb-2 text-xs text-muted-foreground">
                Select one or more years
              </p>
              <DropdownMenuSeparator />
              {purchaseYears.map((year) => (
                <DropdownMenuCheckboxItem
                  key={year}
                  checked={filters.purchase_year.includes(year)}
                  onCheckedChange={() => togglePurchaseYear(year)}
                >
                  {year}
                </DropdownMenuCheckboxItem>
              ))}
              {filters.purchase_year.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={false}
                    onCheckedChange={() => updateFilter('purchase_year', [])}
                  >
                    Clear all
                  </DropdownMenuCheckboxItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Division Filter */}
        <Select
          value={filters.division || 'all'}
          onValueChange={(value) => updateFilter('division', value === 'all' ? '' : value)}
        >
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue placeholder="Division" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Divisions</SelectItem>
            <SelectItem value="mining">Mining</SelectItem>
            <SelectItem value="civil">Civil</SelectItem>
          </SelectContent>
        </Select>

        {/* Exclude Sites Multi-Select */}
        {locationsLoading ? (
          <Skeleton className="h-9 w-[160px]" />
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                Exclude Sites
                {filters.exclude_locations.length > 0 && (
                  <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-xs font-normal">
                    {filters.exclude_locations.length}
                  </Badge>
                )}
                <ChevronDown className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[240px] max-h-[300px] overflow-y-auto">
              <DropdownMenuLabel>Exclude sites from results</DropdownMenuLabel>
              <p className="px-2 pb-2 text-xs text-muted-foreground">
                Selected sites will be hidden
              </p>
              <DropdownMenuSeparator />
              {locations.map((loc) => (
                <DropdownMenuCheckboxItem
                  key={loc.id}
                  checked={filters.exclude_locations.includes(loc.id)}
                  onCheckedChange={() => toggleExcludeLocation(loc.id)}
                >
                  {loc.location_name}
                </DropdownMenuCheckboxItem>
              ))}
              {filters.exclude_locations.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={false}
                    onCheckedChange={() => updateFilter('exclude_locations', [])}
                  >
                    Clear all
                  </DropdownMenuCheckboxItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Has Maintenance Toggle */}
        <Button
          variant={filters.has_maintenance ? 'default' : 'outline'}
          size="sm"
          onClick={() => updateFilter('has_maintenance', !filters.has_maintenance)}
          className="h-9"
        >
          {filters.has_maintenance ? 'With Maintenance' : 'Any Maintenance'}
        </Button>

        {/* Verified Only Toggle */}
        <Button
          variant={filters.verified_only ? 'default' : 'outline'}
          size="sm"
          onClick={() => updateFilter('verified_only', !filters.verified_only)}
          className="h-9"
        >
          {filters.verified_only ? 'Verified Only' : 'Show All'}
        </Button>
      </div>

      {/* Active Filter Chips */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Active filters:</span>

          {/* Condition chips */}
          {filters.condition.map((c) => (
            <Badge
              key={c}
              variant="secondary"
              className="gap-1 pr-1 cursor-pointer hover:bg-secondary/80"
              onClick={() => toggleCondition(c)}
            >
              {CONDITION_MAP.get(c) || c}
              <X className="h-3 w-3" />
            </Badge>
          ))}

          {/* Location chip */}
          {selectedLocationName && (
            <Badge
              variant="secondary"
              className="gap-1 pr-1 cursor-pointer hover:bg-secondary/80"
              onClick={() => updateFilter('location_id', '')}
            >
              {selectedLocationName}
              <X className="h-3 w-3" />
            </Badge>
          )}

          {/* Fleet type chips */}
          {filters.fleet_type.map((ft) => (
            <Badge
              key={ft}
              variant="secondary"
              className="gap-1 pr-1 cursor-pointer hover:bg-secondary/80"
              onClick={() => toggleFleetType(ft)}
            >
              {ft}
              <X className="h-3 w-3" />
            </Badge>
          ))}

          {/* Purchase year chips */}
          {filters.purchase_year.map((yr) => (
            <Badge
              key={yr}
              variant="secondary"
              className="gap-1 pr-1 cursor-pointer hover:bg-secondary/80"
              onClick={() => togglePurchaseYear(yr)}
            >
              {yr}
              <X className="h-3 w-3" />
            </Badge>
          ))}

          {/* Exclude location chips */}
          {filters.exclude_locations.map((locId) => {
            const name = locations.find((l) => l.id === locId)?.location_name || locId;
            return (
              <Badge
                key={`exc-${locId}`}
                variant="destructive"
                className="gap-1 pr-1 cursor-pointer hover:bg-destructive/80"
                onClick={() => toggleExcludeLocation(locId)}
              >
                Excl: {name}
                <X className="h-3 w-3" />
              </Badge>
            );
          })}

          {/* Division chip */}
          {filters.division && (
            <Badge
              variant="secondary"
              className="gap-1 pr-1 cursor-pointer hover:bg-secondary/80"
              onClick={() => updateFilter('division', '')}
            >
              {filters.division === 'mining' ? 'Mining' : 'Civil'}
              <X className="h-3 w-3" />
            </Badge>
          )}

          {/* Has maintenance chip */}
          {filters.has_maintenance && (
            <Badge
              variant="secondary"
              className="gap-1 pr-1 cursor-pointer hover:bg-secondary/80"
              onClick={() => updateFilter('has_maintenance', false)}
            >
              With Maintenance
              <X className="h-3 w-3" />
            </Badge>
          )}

          {/* Verified chip */}
          {filters.verified_only && (
            <Badge
              variant="secondary"
              className="gap-1 pr-1 cursor-pointer hover:bg-secondary/80"
              onClick={() => updateFilter('verified_only', false)}
            >
              Verified Only
              <X className="h-3 w-3" />
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
