'use client';

/**
 * Plants Page
 * Main page for viewing and managing plant/equipment assets
 */

import { useState, useMemo, useCallback } from 'react';
import { Truck } from 'lucide-react';
import { usePlants, useLocations, useFleetTypes } from '@/hooks/use-plants';
import { PlantsTable } from '@/components/plants/plants-table';
import { PlantsFilters, type FiltersState } from '@/components/plants/plants-filters';
import { PlantDetailModal } from '@/components/plants/plant-detail-modal';
import { Pagination } from '@/components/plants/pagination';
import { useDebounce } from '@/hooks/use-debounce';

const DEFAULT_FILTERS: FiltersState = {
  search: '',
  status: '',
  location_id: '',
  fleet_type_id: '',
  verified_only: false,
};

export default function PlantsPage() {
  // State
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<FiltersState>(DEFAULT_FILTERS);
  const [selectedPlantId, setSelectedPlantId] = useState<string | null>(null);

  // Debounce search to avoid too many API calls
  const debouncedSearch = useDebounce(filters.search, 300);

  // Build query params
  const queryParams = useMemo(
    () => ({
      page,
      limit: 20,
      search: debouncedSearch || undefined,
      status: filters.status || undefined,
      location_id: filters.location_id || undefined,
      fleet_type_id: filters.fleet_type_id || undefined,
      verified_only: filters.verified_only || undefined,
    }),
    [page, debouncedSearch, filters.status, filters.location_id, filters.fleet_type_id, filters.verified_only]
  );

  // Data fetching
  const { data: plantsData, isLoading: plantsLoading } = usePlants(queryParams);
  const { data: locations = [], isLoading: locationsLoading } = useLocations();
  const { data: fleetTypes = [], isLoading: fleetTypesLoading } = useFleetTypes();

  // Handlers
  const handleFiltersChange = useCallback((newFilters: FiltersState) => {
    setFilters(newFilters);
    setPage(1); // Reset to first page when filters change
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
  }, []);

  const handleRowClick = useCallback((plant: { id: string }) => {
    setSelectedPlantId(plant.id);
  }, []);

  const handleCloseModal = useCallback(() => {
    setSelectedPlantId(null);
  }, []);

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
      />

      {/* Pagination */}
      {plantsData?.meta && (
        <Pagination
          meta={plantsData.meta}
          onPageChange={handlePageChange}
          itemLabel="plants"
        />
      )}

      {/* Detail Modal */}
      <PlantDetailModal
        plantId={selectedPlantId}
        onClose={handleCloseModal}
      />
    </div>
  );
}
