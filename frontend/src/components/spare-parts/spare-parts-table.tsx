'use client';

/**
 * Spare Parts Table Component
 * Displays a paginated table of spare parts records
 */

import Link from 'next/link';
import { Calendar, Truck, Package } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import type { SparePart } from '@/hooks/use-spare-parts';

interface SparePartsTableProps {
  parts: SparePart[];
  loading: boolean;
  onRowClick?: (part: SparePart) => void;
}

export function SparePartsTable({ parts, loading, onRowClick }: SparePartsTableProps) {
  if (loading) {
    return <SparePartsTableSkeleton />;
  }

  if (parts.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p className="text-lg">No spare parts found</p>
        <p className="text-sm mt-1">Try adjusting your filters or search term</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[100px]">Date</TableHead>
            <TableHead className="w-[100px]">Fleet #</TableHead>
            <TableHead>Part Description</TableHead>
            <TableHead className="w-[130px]">PO Number</TableHead>
            <TableHead className="w-[150px]">Supplier</TableHead>
            <TableHead className="w-[60px] text-center">Qty</TableHead>
            <TableHead className="w-[100px] text-right">Unit Cost</TableHead>
            <TableHead className="w-[120px] text-right">Total Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {parts.map((part) => (
            <TableRow
              key={part.id}
              className={onRowClick ? 'cursor-pointer hover:bg-muted/50' : ''}
              onClick={() => onRowClick?.(part)}
            >
              <TableCell className="text-sm">
                {part.replaced_date ? formatDate(part.replaced_date) : '-'}
              </TableCell>
              <TableCell className="font-mono font-medium">
                {part.fleet_number
                  || part.fleet_number_raw
                  || (part.is_workshop ? 'WORKSHOP' : null)
                  || (part.is_category ? (part.category_name || 'CATEGORY') : null)
                  || '-'}
              </TableCell>
              <TableCell className="max-w-[300px]">
                <div className="truncate" title={part.part_description}>
                  {part.part_description}
                </div>
                {part.part_number && (
                  <div className="text-xs text-muted-foreground font-mono">
                    {part.part_number}
                  </div>
                )}
              </TableCell>
              <TableCell className="font-mono text-sm">
                {part.purchase_order_number ? (
                  <Link
                    href={`/spare-parts/po/${encodeURIComponent(part.purchase_order_number)}`}
                    className="text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {part.purchase_order_number}
                  </Link>
                ) : '-'}
              </TableCell>
              <TableCell className="text-sm truncate" title={part.supplier_name || part.supplier || ''}>
                {part.supplier_name || part.supplier || '-'}
              </TableCell>
              <TableCell className="text-center">{part.quantity}</TableCell>
              <TableCell className="text-right">
                {part.unit_cost != null ? formatCurrency(part.unit_cost) : '-'}
              </TableCell>
              <TableCell className="text-right font-medium">
                {part.total_cost != null ? formatCurrency(part.total_cost) : '-'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SparePartsTableSkeleton() {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[100px]">Date</TableHead>
            <TableHead className="w-[100px]">Fleet #</TableHead>
            <TableHead>Part Description</TableHead>
            <TableHead className="w-[130px]">PO Number</TableHead>
            <TableHead className="w-[150px]">Supplier</TableHead>
            <TableHead className="w-[60px] text-center">Qty</TableHead>
            <TableHead className="w-[100px] text-right">Unit Cost</TableHead>
            <TableHead className="w-[120px] text-right">Total Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...Array(10)].map((_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-5 w-16" /></TableCell>
              <TableCell><Skeleton className="h-5 w-14" /></TableCell>
              <TableCell>
                <Skeleton className="h-5 w-full max-w-[200px]" />
                <Skeleton className="h-3 w-20 mt-1" />
              </TableCell>
              <TableCell><Skeleton className="h-5 w-20" /></TableCell>
              <TableCell><Skeleton className="h-5 w-24" /></TableCell>
              <TableCell><Skeleton className="h-5 w-8 mx-auto" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
              <TableCell><Skeleton className="h-5 w-20 ml-auto" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-NG', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
