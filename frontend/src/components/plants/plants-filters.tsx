'use client';

/**
 * Plants Filters Component
 * Filter controls for the plants table
 */

import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import type { Location, FleetType } from '@/hooks/use-plants';

export interface FiltersState {
  search: string;
  status: string;
  location_id: string;
  fleet_type_id: string;
  verified_only: boolean;
}

interface PlantsFiltersProps {
  filters: FiltersState;
  onFiltersChange: (filters: FiltersState) => void;
  locations: Location[];
  fleetTypes: FleetType[];
  locationsLoading: boolean;
  fleetTypesLoading: boolean;
}

export function PlantsFilters({
  filters,
  onFiltersChange,
  locations,
  fleetTypes,
  locationsLoading,
  fleetTypesLoading,
}: PlantsFiltersProps) {
  const updateFilter = <K extends keyof FiltersState>(key: K, value: FiltersState[K]) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const clearFilters = () => {
    onFiltersChange({
      search: '',
      status: '',
      location_id: '',
      fleet_type_id: '',
      verified_only: false,
    });
  };

  const hasActiveFilters =
    filters.search ||
    filters.status ||
    filters.location_id ||
    filters.fleet_type_id ||
    filters.verified_only;

  return (
    <div className="space-y-4">
      {/* Search and Clear */}
      <div className="flex gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search fleet number or description..."
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
            className="pl-9"
          />
        </div>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-4 w-4 mr-1" />
            Clear filters
          </Button>
        )}
      </div>

      {/* Filter Dropdowns */}
      <div className="flex flex-wrap gap-3">
        {/* Status Filter */}
        <Select
          value={filters.status || 'all'}
          onValueChange={(value) => updateFilter('status', value === 'all' ? '' : value)}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
            <SelectItem value="disposed">Disposed</SelectItem>
          </SelectContent>
        </Select>

        {/* Location Filter */}
        {locationsLoading ? (
          <Skeleton className="h-9 w-[180px]" />
        ) : (
          <Select
            value={filters.location_id || 'all'}
            onValueChange={(value) => updateFilter('location_id', value === 'all' ? '' : value)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Location" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Locations</SelectItem>
              {locations.map((loc) => (
                <SelectItem key={loc.location_id} value={loc.location_id}>
                  {loc.location_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Fleet Type Filter */}
        {fleetTypesLoading ? (
          <Skeleton className="h-9 w-[180px]" />
        ) : (
          <Select
            value={filters.fleet_type_id || 'all'}
            onValueChange={(value) => updateFilter('fleet_type_id', value === 'all' ? '' : value)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Fleet Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {fleetTypes.map((type) => (
                <SelectItem key={type.id} value={type.id}>
                  {type.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

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
    </div>
  );
}
