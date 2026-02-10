'use client';

/**
 * Plants Table Component
 * Displays a paginated table of plants with status badges
 */

import { CheckCircle, XCircle, Wrench } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { PlantSummary } from '@/hooks/use-plants';

interface PlantsTableProps {
  plants: PlantSummary[];
  loading: boolean;
  onRowClick?: (plant: PlantSummary) => void;
}

export function PlantsTable({ plants, loading, onRowClick }: PlantsTableProps) {
  if (loading) {
    return <PlantsTableSkeleton />;
  }

  if (plants.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg">No plants found</p>
        <p className="text-sm mt-1">Try adjusting your filters or search term</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[120px]">Fleet #</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="w-[180px]">Type</TableHead>
            <TableHead className="w-[140px]">Location</TableHead>
            <TableHead className="w-[100px]">Status</TableHead>
            <TableHead className="w-[80px] text-center">Verified</TableHead>
            <TableHead className="w-[120px] text-right">Maintenance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plants.map((plant) => (
            <TableRow
              key={plant.id}
              className={onRowClick ? 'cursor-pointer hover:bg-muted/50' : ''}
              onClick={() => onRowClick?.(plant)}
            >
              <TableCell className="font-mono font-medium">
                {plant.fleet_number}
              </TableCell>
              <TableCell className="max-w-[300px] truncate" title={plant.description || ''}>
                {plant.description || '-'}
              </TableCell>
              <TableCell>
                {plant.fleet_type ? (
                  <span className="text-sm text-muted-foreground">
                    {plant.fleet_type}
                  </span>
                ) : (
                  '-'
                )}
              </TableCell>
              <TableCell>
                {plant.current_location || '-'}
              </TableCell>
              <TableCell>
                <StatusBadge status={plant.status} />
              </TableCell>
              <TableCell className="text-center">
                {plant.physical_verification ? (
                  <CheckCircle className="h-5 w-5 text-success mx-auto" />
                ) : (
                  <XCircle className="h-5 w-5 text-muted-foreground mx-auto" />
                )}
              </TableCell>
              <TableCell className="text-right">
                {plant.total_maintenance_cost != null ? (
                  <span className="flex items-center justify-end gap-1 text-sm">
                    <Wrench className="h-3 w-3 text-muted-foreground" />
                    {formatCurrency(plant.total_maintenance_cost)}
                  </span>
                ) : (
                  '-'
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function StatusBadge({ status }: { status: PlantSummary['status'] }) {
  switch (status) {
    case 'active':
      return (
        <Badge variant="default" className="bg-success text-white">
          Active
        </Badge>
      );
    case 'archived':
      return (
        <Badge variant="secondary">
          Archived
        </Badge>
      );
    case 'disposed':
      return (
        <Badge variant="default" className="bg-muted text-muted-foreground">
          Disposed
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function PlantsTableSkeleton() {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[120px]">Fleet #</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="w-[180px]">Type</TableHead>
            <TableHead className="w-[140px]">Location</TableHead>
            <TableHead className="w-[100px]">Status</TableHead>
            <TableHead className="w-[80px] text-center">Verified</TableHead>
            <TableHead className="w-[120px] text-right">Maintenance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...Array(10)].map((_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-5 w-16" /></TableCell>
              <TableCell><Skeleton className="h-5 w-full max-w-[200px]" /></TableCell>
              <TableCell><Skeleton className="h-5 w-24" /></TableCell>
              <TableCell><Skeleton className="h-5 w-20" /></TableCell>
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
