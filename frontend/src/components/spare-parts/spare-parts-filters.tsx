'use client';

/**
 * Spare Parts Filters Component
 * Filter controls for the spare parts table
 */

import { Search, X, Calendar } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export interface SparePartsFiltersState {
  search: string;
  fleet_number: string;
  supplier: string;
  date_from: string;
  date_to: string;
}

interface SparePartsFiltersProps {
  filters: SparePartsFiltersState;
  onFiltersChange: (filters: SparePartsFiltersState) => void;
}

export function SparePartsFilters({ filters, onFiltersChange }: SparePartsFiltersProps) {
  const updateFilter = <K extends keyof SparePartsFiltersState>(
    key: K,
    value: SparePartsFiltersState[K]
  ) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const clearFilters = () => {
    onFiltersChange({
      search: '',
      fleet_number: '',
      supplier: '',
      date_from: '',
      date_to: '',
    });
  };

  const hasActiveFilters =
    filters.search ||
    filters.fleet_number ||
    filters.supplier ||
    filters.date_from ||
    filters.date_to;

  return (
    <div className="space-y-4">
      {/* Search and Clear */}
      <div className="flex gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search part description or number..."
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

      {/* Filter Inputs */}
      <div className="flex flex-wrap gap-3">
        {/* Fleet Number Filter */}
        <Input
          placeholder="Fleet number"
          value={filters.fleet_number}
          onChange={(e) => updateFilter('fleet_number', e.target.value)}
          className="w-[140px]"
        />

        {/* Supplier Filter */}
        <Input
          placeholder="Supplier"
          value={filters.supplier}
          onChange={(e) => updateFilter('supplier', e.target.value)}
          className="w-[180px]"
        />

        {/* Date Range */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              type="date"
              placeholder="From date"
              value={filters.date_from}
              onChange={(e) => updateFilter('date_from', e.target.value)}
              className="w-[160px] pl-9"
            />
          </div>
          <span className="text-muted-foreground">to</span>
          <Input
            type="date"
            placeholder="To date"
            value={filters.date_to}
            onChange={(e) => updateFilter('date_to', e.target.value)}
            className="w-[140px]"
          />
        </div>
      </div>
    </div>
  );
}
