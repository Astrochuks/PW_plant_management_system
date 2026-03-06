'use client';

/**
 * Plants Page
 * Main page for viewing and managing plant/equipment assets
 */

import { Suspense, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Truck } from 'lucide-react';
import { usePlants, useLocations, useFleetTypes, usePlantFilteredStats, usePrefetchPlantDetail } from '@/hooks/use-plants';
import { PlantsTable, DEFAULT_VISIBLE_COLUMNS } from '@/components/plants/plants-table';
import { PlantsFilters, type FiltersState } from '@/components/plants/plants-filters';
import { PlantsStatsCards } from '@/components/plants/plants-stats-cards';
import { Pagination } from '@/components/plants/pagination';
import { useDebounce } from '@/hooks/use-debounce';
import { useUrlFilters } from '@/hooks/use-url-filters';
import type { ColumnKey } from '@/components/plants/plants-table';

const FILTER_DEFAULTS = {
  search: '',
  condition: '',
  location_id: '',
  fleet_type: '',
  verified_only: '',
  page: '1',
};

function PlantsPageInner() {
  const router = useRouter();
  const prefetchPlant = usePrefetchPlantDetail();

  const [urlFilters, setUrlFilters] = useUrlFilters(FILTER_DEFAULTS);
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(DEFAULT_VISIBLE_COLUMNS);

  // Parse URL params into FiltersState
  const filters: FiltersState = useMemo(() => ({
    search: urlFilters.search,
    condition: urlFilters.condition ? urlFilters.condition.split(',') : [],
    location_id: urlFilters.location_id,
    fleet_type: urlFilters.fleet_type ? urlFilters.fleet_type.split(',') : [],
    verified_only: urlFilters.verified_only === 'true',
  }), [urlFilters]);

  const page = Number(urlFilters.page) || 1;

  // Debounce search to avoid too many API calls
  const debouncedSearch = useDebounce(filters.search, 300);

  // Build query params
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

  // Handlers — serialize back to URL params
  const handleFiltersChange = useCallback((newFilters: FiltersState) => {
    setUrlFilters({
      search: newFilters.search,
      condition: newFilters.condition.join(','),
      location_id: newFilters.location_id,
      fleet_type: newFilters.fleet_type.join(','),
      verified_only: newFilters.verified_only ? 'true' : '',
      page: '1',
    });
  }, [setUrlFilters]);

  const handlePageChange = useCallback((newPage: number) => {
    setUrlFilters({ page: String(newPage) });
  }, [setUrlFilters]);

  const handleRowClick = useCallback((plant: { id: string }) => {
    router.push(`/plants/${plant.id}`);
  }, [router]);

  const handleRowHover = useCallback((plantId: string) => {
    prefetchPlant(plantId);
  }, [prefetchPlant]);

  const handleVisibleColumnsChange = useCallback((columns: ColumnKey[]) => {
    setVisibleColumns(columns);
  }, []);

  // Condition pill toggle
  const handleConditionToggle = useCallback((condition: string) => {
    const current = filters.condition;
    const next = current.includes(condition)
      ? current.filter((c) => c !== condition)
      : [...current, condition];
    setUrlFilters({ condition: next.join(','), page: '1' });
  }, [filters.condition, setUrlFilters]);

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

export default function PlantsPage() {
  return (
    <Suspense>
      <PlantsPageInner />
    </Suspense>
  );
}
