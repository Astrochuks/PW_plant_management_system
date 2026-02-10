'use client';

/**
 * Locations Page
 * Displays all locations with stats and drill-down capability
 */

import { useState, useMemo } from 'react';
import { MapPin, Search, SortAsc, SortDesc } from 'lucide-react';
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
import { useLocationsWithStats } from '@/hooks/use-locations';
import { LocationCard } from '@/components/locations/location-card';
import { LocationDetailModal } from '@/components/locations/location-detail-modal';

type SortField = 'name' | 'plants' | 'verification' | 'maintenance';
type SortDirection = 'asc' | 'desc';

export default function LocationsPage() {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('plants');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);

  const { data: locations = [], isLoading } = useLocationsWithStats();

  // Filter and sort locations
  const filteredLocations = useMemo(() => {
    let result = [...locations];

    // Filter by search
    if (search) {
      const searchLower = search.toLowerCase();
      result = result.filter(
        (loc) =>
          loc.location_name.toLowerCase().includes(searchLower) ||
          (loc.location_code?.toLowerCase().includes(searchLower) ?? false)
      );
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = a.location_name.localeCompare(b.location_name);
          break;
        case 'plants':
          comparison = a.total_plants - b.total_plants;
          break;
        case 'verification':
          comparison = a.verification_rate - b.verification_rate;
          break;
        case 'maintenance':
          comparison = a.total_maintenance_cost - b.total_maintenance_cost;
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [locations, search, sortField, sortDirection]);

  // Calculate totals
  const totals = useMemo(() => {
    return locations.reduce(
      (acc, loc) => ({
        plants: acc.plants + loc.total_plants,
        active: acc.active + loc.active_plants,
        verified: acc.verified + loc.verified_plants,
        maintenance: acc.maintenance + loc.total_maintenance_cost,
      }),
      { plants: 0, active: 0, verified: 0, maintenance: 0 }
    );
  }, [locations]);

  const toggleSortDirection = () => {
    setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <MapPin className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Locations</h1>
          <p className="text-sm text-muted-foreground">
            Manage equipment across {locations.length} locations
          </p>
        </div>
      </div>

      {/* Summary Stats */}
      {!isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Plants" value={totals.plants} />
          <StatCard label="Active Plants" value={totals.active} />
          <StatCard
            label="Verified"
            value={`${totals.plants > 0 ? Math.round((totals.verified / totals.plants) * 100) : 0}%`}
          />
          <StatCard label="Total Maintenance" value={formatCurrency(totals.maintenance)} />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search locations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={sortField}
            onValueChange={(value) => setSortField(value as SortField)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="plants">Plant Count</SelectItem>
              <SelectItem value="verification">Verification Rate</SelectItem>
              <SelectItem value="maintenance">Maintenance Cost</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="icon"
            onClick={toggleSortDirection}
            title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
          >
            {sortDirection === 'asc' ? (
              <SortAsc className="h-4 w-4" />
            ) : (
              <SortDesc className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Location Cards Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <LocationCardSkeleton key={i} />
          ))}
        </div>
      ) : filteredLocations.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <MapPin className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg">No locations found</p>
          <p className="text-sm mt-1">
            {search ? 'Try adjusting your search term' : 'No locations have been created yet'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredLocations.map((location) => (
            <LocationCard
              key={location.location_id}
              location={location}
              onClick={() => setSelectedLocationId(location.location_id)}
            />
          ))}
        </div>
      )}

      {/* Detail Modal */}
      <LocationDetailModal
        locationId={selectedLocationId}
        onClose={() => setSelectedLocationId(null)}
      />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-muted/50 rounded-lg p-4">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function LocationCardSkeleton() {
  return (
    <div className="border rounded-lg p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div>
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-3 w-16 mt-1" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-16 rounded-lg" />
      </div>
      <Skeleton className="h-2 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function formatCurrency(amount: number): string {
  if (amount >= 1000000) {
    return `₦${(amount / 1000000).toFixed(1)}M`;
  }
  if (amount >= 1000) {
    return `₦${(amount / 1000).toFixed(0)}K`;
  }
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
