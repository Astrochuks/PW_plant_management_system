'use client';

/**
 * Spare Parts Page
 * Main page for viewing spare parts/maintenance records
 */

import { useState, useMemo, useCallback } from 'react';
import { Wrench, TrendingUp, Package, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useSpareParts, useSparePartsStats, useTopSuppliers, useHighCostPlants } from '@/hooks/use-spare-parts';
import { SparePartsTable } from '@/components/spare-parts/spare-parts-table';
import { SparePartsFilters, type SparePartsFiltersState } from '@/components/spare-parts/spare-parts-filters';
import { SparePartDetailModal } from '@/components/spare-parts/spare-part-detail-modal';
import { Pagination } from '@/components/plants/pagination';
import { useDebounce } from '@/hooks/use-debounce';

const DEFAULT_FILTERS: SparePartsFiltersState = {
  search: '',
  fleet_number: '',
  supplier: '',
  date_from: '',
  date_to: '',
};

export default function SparePartsPage() {
  // State
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<SparePartsFiltersState>(DEFAULT_FILTERS);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);

  // Debounce search and fleet number
  const debouncedSearch = useDebounce(filters.search, 300);
  const debouncedFleetNumber = useDebounce(filters.fleet_number, 300);
  const debouncedSupplier = useDebounce(filters.supplier, 300);

  // Build query params
  const queryParams = useMemo(
    () => ({
      page,
      limit: 20,
      search: debouncedSearch || undefined,
      fleet_number: debouncedFleetNumber || undefined,
      supplier: debouncedSupplier || undefined,
      date_from: filters.date_from || undefined,
      date_to: filters.date_to || undefined,
    }),
    [page, debouncedSearch, debouncedFleetNumber, debouncedSupplier, filters.date_from, filters.date_to]
  );

  // Data fetching
  const { data: partsData, isLoading: partsLoading } = useSpareParts(queryParams);
  const { data: stats, isLoading: statsLoading } = useSparePartsStats();
  const { data: topSuppliers = [], isLoading: suppliersLoading } = useTopSuppliers({ limit: 5 });
  const { data: highCostPlants = [], isLoading: plantsLoading } = useHighCostPlants({ limit: 5 });

  // Handlers
  const handleFiltersChange = useCallback((newFilters: SparePartsFiltersState) => {
    setFilters(newFilters);
    setPage(1);
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
  }, []);

  const handleRowClick = useCallback((part: { id: string }) => {
    setSelectedPartId(part.id);
  }, []);

  const handleCloseModal = useCallback(() => {
    setSelectedPartId(null);
  }, []);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Wrench className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Spare Parts</h1>
          <p className="text-sm text-muted-foreground">
            Track maintenance and replacement parts
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statsLoading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : stats ? (
          <>
            <StatCard
              icon={Package}
              label="Total Parts"
              value={stats.total_parts?.toLocaleString() ?? '0'}
            />
            <StatCard
              icon={TrendingUp}
              label="Total Spend"
              value={formatCurrencyShort(stats.total_cost ?? 0)}
            />
            <StatCard
              icon={Wrench}
              label="Plants Serviced"
              value={stats.unique_plants?.toLocaleString() ?? '0'}
            />
            <StatCard
              icon={Users}
              label="Suppliers"
              value={stats.unique_suppliers?.toLocaleString() ?? '0'}
            />
          </>
        ) : null}
      </div>

      {/* Top Suppliers and High Cost Plants - Side by Side */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Top Suppliers */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" />
              Top Suppliers
            </CardTitle>
          </CardHeader>
          <CardContent>
            {suppliersLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : topSuppliers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No data</p>
            ) : (
              <div className="space-y-2">
                {topSuppliers.map((supplier, i) => (
                  <div
                    key={supplier.supplier}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">{i + 1}.</span>
                      <span className="truncate max-w-[150px]" title={supplier.supplier}>
                        {supplier.supplier}
                      </span>
                    </div>
                    <span className="font-medium">{formatCurrencyShort(supplier.total_spend)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* High Cost Plants */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Highest Maintenance Cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            {plantsLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : highCostPlants.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No data</p>
            ) : (
              <div className="space-y-2">
                {highCostPlants.map((plant, i) => (
                  <div
                    key={plant.plant_id}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">{i + 1}.</span>
                      <span className="font-mono">{plant.fleet_number}</span>
                    </div>
                    <span className="font-medium">{formatCurrencyShort(plant.total_cost)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <SparePartsFilters filters={filters} onFiltersChange={handleFiltersChange} />

      {/* Table */}
      <SparePartsTable
        parts={partsData?.data ?? []}
        loading={partsLoading}
        onRowClick={handleRowClick}
      />

      {/* Pagination */}
      {partsData?.meta && (
        <Pagination meta={partsData.meta} onPageChange={handlePageChange} itemLabel="parts" />
      )}

      {/* Detail Modal */}
      <SparePartDetailModal partId={selectedPartId} onClose={handleCloseModal} />
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-muted/50 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="bg-muted/50 rounded-lg p-4">
      <Skeleton className="h-4 w-24 mb-2" />
      <Skeleton className="h-8 w-20" />
    </div>
  );
}

function formatCurrencyShort(amount: number): string {
  if (amount >= 1000000000) {
    return `₦${(amount / 1000000000).toFixed(1)}B`;
  }
  if (amount >= 1000000) {
    return `₦${(amount / 1000000).toFixed(1)}M`;
  }
  if (amount >= 1000) {
    return `₦${(amount / 1000).toFixed(0)}K`;
  }
  return `₦${amount.toFixed(0)}`;
}
