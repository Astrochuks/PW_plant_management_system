'use client';

/**
 * Plants Page
 * Main page for viewing and managing plant/equipment assets
 */

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Truck } from 'lucide-react';
import { usePlants, useLocations, useFleetTypes, usePlantFilteredStats, usePrefetchPlantDetail } from '@/hooks/use-plants';
import { PlantsTable, DEFAULT_VISIBLE_COLUMNS } from '@/components/plants/plants-table';
import { PlantsFilters, type FiltersState } from '@/components/plants/plants-filters';
import { PlantsStatsCards } from '@/components/plants/plants-stats-cards';
import { Pagination } from '@/components/plants/pagination';
import { useDebounce } from '@/hooks/use-debounce';
import type { ColumnKey } from '@/components/plants/plants-table';

const DEFAULT_FILTERS: FiltersState = {
  search: '',
  condition: [],
  location_id: '',
  fleet_type: [],
  verified_only: false,
};

export default function PlantsPage() {
  const router = useRouter();
  const prefetchPlant = usePrefetchPlantDetail();

  // State
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<FiltersState>(DEFAULT_FILTERS);
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(DEFAULT_VISIBLE_COLUMNS);

  // Debounce search to avoid too many API calls
  const debouncedSearch = useDebounce(filters.search, 300);

  // Build query params — join arrays into comma-separated strings for the API
  const queryParams = useMemo(
    () => ({
      page,
      limit: 20,
      search: debouncedSearch || undefined,
      condition: filters.condition.length > 0 ? filters.condition.join(',') : undefined,
      location_id: filters.location_id || undefined,
      fleet_type: filters.fleet_type.length > 0 ? filters.fleet_type.join(',') : undefined,
      verified_only: filters.verified_only || undefined,
    }),
    [page, debouncedSearch, filters.condition, filters.location_id, filters.fleet_type, filters.verified_only]
  );

  // Stats params (same filters, no pagination)
  const statsParams = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      condition: filters.condition.length > 0 ? filters.condition.join(',') : undefined,
      location_id: filters.location_id || undefined,
      fleet_type: filters.fleet_type.length > 0 ? filters.fleet_type.join(',') : undefined,
      verified_only: filters.verified_only || undefined,
    }),
    [debouncedSearch, filters.condition, filters.location_id, filters.fleet_type, filters.verified_only]
  );

  // Data fetching
  const { data: plantsData, isLoading: plantsLoading } = usePlants(queryParams);
  const { data: statsData, isLoading: statsLoading } = usePlantFilteredStats(statsParams);
  const { data: locations = [], isLoading: locationsLoading } = useLocations();
  const { data: fleetTypes = [], isLoading: fleetTypesLoading } = useFleetTypes();

  // Handlers
  const handleFiltersChange = useCallback((newFilters: FiltersState) => {
    setFilters(newFilters);
    setPage(1);
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
  }, []);

  const handleRowClick = useCallback((plant: { id: string }) => {
    router.push(`/plants/${plant.id}`);
  }, [router]);

  // Prefetch plant detail data when user hovers a row
  const handleRowHover = useCallback((plantId: string) => {
    prefetchPlant(plantId);
  }, [prefetchPlant]);

  const handleVisibleColumnsChange = useCallback((columns: ColumnKey[]) => {
    setVisibleColumns(columns);
  }, []);

  // Condition pill toggle — syncs with filter state
  const handleConditionToggle = useCallback((condition: string) => {
    setFilters((prev) => {
      const current = prev.condition;
      const next = current.includes(condition)
        ? current.filter((c) => c !== condition)
        : [...current, condition];
      return { ...prev, condition: next };
    });
    setPage(1);
  }, []);

  // Export params matching current filters (for the table toolbar)
  const exportParams = useMemo(
    () => ({
      condition: filters.condition.length > 0 ? filters.condition.join(',') : undefined,
      location_id: filters.location_id || undefined,
      fleet_type: filters.fleet_type.length > 0 ? filters.fleet_type.join(',') : undefined,
      search: debouncedSearch || undefined,
      verified_only: filters.verified_only ? 'true' : undefined,
    }),
    [filters.condition, filters.location_id, filters.fleet_type, debouncedSearch, filters.verified_only]
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Truck className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Plants</h1>
          <p className="text-sm text-muted-foreground">
            Manage your equipment fleet
          </p>
        </div>
      </div>

      {/* Stats Strip + Condition Pills */}
      <PlantsStatsCards
        stats={statsData}
        isLoading={statsLoading}
        activeConditions={filters.condition}
        onConditionToggle={handleConditionToggle}
      />

      {/* Filters */}
      <PlantsFilters
        filters={filters}
        onFiltersChange={handleFiltersChange}
        locations={locations}
        fleetTypes={fleetTypes}
        locationsLoading={locationsLoading}
        fleetTypesLoading={fleetTypesLoading}
      />

      {/* Table */}
      <PlantsTable
        plants={plantsData?.data ?? []}
        loading={plantsLoading}
        onRowClick={handleRowClick}
        onRowHover={handleRowHover}
        visibleColumns={visibleColumns}
        onVisibleColumnsChange={handleVisibleColumnsChange}
        meta={plantsData?.meta}
        exportParams={exportParams}
      />

      {/* Pagination */}
      {plantsData?.meta && (
        <Pagination
          meta={plantsData.meta}
          onPageChange={handlePageChange}
          itemLabel="plants"
        />
      )}

    </div>
  );
}
