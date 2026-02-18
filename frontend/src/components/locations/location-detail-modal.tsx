'use client';

/**
 * Location Detail Modal Component
 * Shows plants at a specific location with pagination
 */

import { useEffect, useRef, useState } from 'react';
import {
  X,
  MapPin,
  Truck,
  CheckCircle,
  XCircle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocationDetail, useLocationPlants } from '@/hooks/use-locations';
import type { PlantCondition } from '@/lib/api/plants';

interface LocationDetailModalProps {
  locationId: string | null;
  onClose: () => void;
}

export function LocationDetailModal({ locationId, onClose }: LocationDetailModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(1);
  const [conditionFilter, setConditionFilter] = useState<string>('');

  const { data: location, isLoading: locationLoading } = useLocationDetail(locationId);
  const { data: plantsData, isLoading: plantsLoading } = useLocationPlants(locationId, {
    page,
    limit: 10,
    condition: conditionFilter || undefined,
  });

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [conditionFilter]);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  if (!locationId) return null;

  const isLoading = locationLoading || plantsLoading;
  const plants = plantsData?.data ?? [];
  const meta = plantsData?.meta;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div
        ref={modalRef}
        className="bg-background rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="border-b p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <MapPin className="h-6 w-6 text-primary" />
            </div>
            <div>
              {locationLoading ? (
                <>
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="h-4 w-24 mt-1" />
                </>
              ) : (
                <>
                  <h2 className="text-xl font-bold">{location?.location_name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {location?.total_plants} plants at this location
                  </p>
                </>
              )}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Filters */}
        <div className="p-4 border-b">
          <Select
            value={conditionFilter || 'all'}
            onValueChange={(value) => setConditionFilter(value === 'all' ? '' : value)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Condition" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Conditions</SelectItem>
              <SelectItem value="working">Working</SelectItem>
              <SelectItem value="standby">Standby</SelectItem>
              <SelectItem value="under_repair">Under Repair</SelectItem>
              <SelectItem value="breakdown">Breakdown</SelectItem>
              <SelectItem value="faulty">Faulty</SelectItem>
              <SelectItem value="scrap">Scrap</SelectItem>
              <SelectItem value="missing">Missing</SelectItem>
              <SelectItem value="off_hire">Off Hire</SelectItem>
              <SelectItem value="gpm_assessment">GPM Assessment</SelectItem>
              <SelectItem value="unverified">Unverified</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto p-4">
          {isLoading ? (
            <PlantTableSkeleton />
          ) : plants.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Truck className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg">No plants found</p>
              <p className="text-sm mt-1">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">Fleet Number</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[150px]">Type</TableHead>
                    <TableHead className="w-[120px]">Condition</TableHead>
                    <TableHead className="w-[80px] text-center">Verified</TableHead>
                    <TableHead className="w-[120px] text-right">Maintenance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plants.map((plant) => (
                    <TableRow key={plant.id}>
                      <TableCell className="font-mono font-medium">
                        {plant.fleet_number}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">
                        {plant.description || '-'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {plant.fleet_type || '-'}
                      </TableCell>
                      <TableCell>
                        <ConditionBadge condition={plant.condition} />
                      </TableCell>
                      <TableCell className="text-center">
                        {plant.physical_verification ? (
                          <CheckCircle className="h-5 w-5 text-success mx-auto" />
                        ) : (
                          <XCircle className="h-5 w-5 text-muted-foreground mx-auto" />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {plant.total_maintenance_cost != null
                          ? formatCurrency(plant.total_maintenance_cost)
                          : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {meta && meta.total_pages > 1 && (
          <div className="border-t p-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {meta.page} of {meta.total_pages} ({meta.total} plants)
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(meta.total_pages, p + 1))}
                disabled={page === meta.total_pages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="border-t p-4 flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

const CONDITION_STYLES: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  working: { label: 'Working', variant: 'default', className: 'bg-emerald-600 hover:bg-emerald-600 text-white' },
  standby: { label: 'Standby', variant: 'secondary', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' },
  under_repair: { label: 'Under Repair', variant: 'secondary', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  breakdown: { label: 'Breakdown', variant: 'destructive' },
  faulty: { label: 'Faulty', variant: 'secondary', className: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' },
  scrap: { label: 'Scrap', variant: 'secondary', className: 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
  missing: { label: 'Missing', variant: 'destructive', className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
  off_hire: { label: 'Off Hire', variant: 'outline' },
  gpm_assessment: { label: 'GPM Assessment', variant: 'secondary', className: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' },
  unverified: { label: 'Unverified', variant: 'outline', className: 'text-muted-foreground' },
};

function ConditionBadge({ condition }: { condition: PlantCondition | null }) {
  const style = CONDITION_STYLES[condition || 'unverified'] || CONDITION_STYLES.unverified;
  return (
    <Badge variant={style.variant} className={style.className}>
      {style.label}
    </Badge>
  );
}

function PlantTableSkeleton() {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[120px]">Fleet Number</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="w-[150px]">Type</TableHead>
            <TableHead className="w-[120px]">Condition</TableHead>
            <TableHead className="w-[80px] text-center">Verified</TableHead>
            <TableHead className="w-[120px] text-right">Maintenance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...Array(5)].map((_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-5 w-16" /></TableCell>
              <TableCell><Skeleton className="h-5 w-full max-w-[150px]" /></TableCell>
              <TableCell><Skeleton className="h-5 w-24" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16" /></TableCell>
              <TableCell><Skeleton className="h-5 w-5 mx-auto" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
