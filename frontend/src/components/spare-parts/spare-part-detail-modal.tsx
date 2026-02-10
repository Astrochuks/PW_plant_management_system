'use client';

/**
 * Spare Part Detail Modal Component
 * Shows detailed information about a selected spare part
 */

import { useEffect, useRef } from 'react';
import {
  X,
  Package,
  Truck,
  Calendar,
  User,
  Hash,
  FileText,
  DollarSign,
  Receipt,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useSparePart } from '@/hooks/use-spare-parts';

interface SparePartDetailModalProps {
  partId: string | null;
  onClose: () => void;
}

export function SparePartDetailModal({ partId, onClose }: SparePartDetailModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const { data: part, isLoading } = useSparePart(partId);

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

  if (!partId) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div
        ref={modalRef}
        className="bg-background rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
      >
        {isLoading ? (
          <SparePartDetailSkeleton onClose={onClose} />
        ) : part ? (
          <>
            {/* Header */}
            <div className="sticky top-0 bg-background border-b p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Package className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">{part.part_description}</h2>
                  {part.part_number && (
                    <p className="text-sm text-muted-foreground font-mono">
                      {part.part_number}
                    </p>
                  )}
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="h-5 w-5" />
              </Button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-6">
              {/* Plant Info */}
              <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                <Truck className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-mono font-medium">{part.fleet_number || 'Unknown'}</p>
                  {part.plant_description && (
                    <p className="text-sm text-muted-foreground">{part.plant_description}</p>
                  )}
                </div>
              </div>

              <Separator />

              {/* Details Grid */}
              <div className="grid grid-cols-2 gap-4">
                <DetailItem
                  icon={Calendar}
                  label="Replaced Date"
                  value={part.replaced_date ? formatDate(part.replaced_date) : 'Not specified'}
                />
                <DetailItem
                  icon={User}
                  label="Supplier"
                  value={part.supplier || 'Not specified'}
                />
                <DetailItem
                  icon={Hash}
                  label="Quantity"
                  value={String(part.quantity)}
                />
                <DetailItem
                  icon={Receipt}
                  label="PO Number"
                  value={part.purchase_order_number || 'Not specified'}
                />
              </div>

              <Separator />

              {/* Cost Breakdown */}
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Cost Breakdown
                </h3>
                <div className="space-y-2 bg-muted/50 rounded-lg p-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Unit Cost</span>
                    <span>{part.unit_cost != null ? formatCurrency(part.unit_cost) : '-'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Quantity</span>
                    <span>x {part.quantity}</span>
                  </div>
                  {part.vat_percentage > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">VAT</span>
                      <span>{part.vat_percentage}%</span>
                    </div>
                  )}
                  {part.discount_percentage > 0 && (
                    <div className="flex justify-between text-sm text-success">
                      <span>Discount</span>
                      <span>-{part.discount_percentage}%</span>
                    </div>
                  )}
                  {part.other_costs > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Other Costs</span>
                      <span>{formatCurrency(part.other_costs)}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between font-medium">
                    <span>Total Cost</span>
                    <span className="text-lg">
                      {part.total_cost != null ? formatCurrency(part.total_cost) : '-'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Reason for Change */}
              {part.reason_for_change && (
                <>
                  <Separator />
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground mb-1">
                      Reason for Change
                    </h3>
                    <p className="text-sm bg-muted/50 rounded-lg p-3">
                      {part.reason_for_change}
                    </p>
                  </div>
                </>
              )}

              {/* Remarks */}
              {part.remarks && (
                <>
                  <Separator />
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Remarks
                    </h3>
                    <p className="text-sm bg-muted/50 rounded-lg p-3">
                      {part.remarks}
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-background border-t p-4 flex justify-end">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          </>
        ) : (
          <div className="p-8 text-center">
            <p className="text-muted-foreground">Spare part not found</p>
            <Button variant="outline" className="mt-4" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailItem({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="p-2 rounded-lg bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

function SparePartDetailSkeleton({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="border-b p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div>
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-24 mt-1" />
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
      </div>
      <div className="p-4 space-y-4">
        <Skeleton className="h-16 w-full" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
    </>
  );
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
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
