'use client';

/**
 * Plant Detail Modal Component
 * Shows detailed information about a selected plant
 */

import { useEffect, useRef } from 'react';
import {
  X,
  Truck,
  MapPin,
  Wrench,
  Calendar,
  CheckCircle,
  XCircle,
  Hash,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { usePlant } from '@/hooks/use-plants';
import type { PlantCondition } from '@/lib/api/plants';

interface PlantDetailModalProps {
  plantId: string | null;
  onClose: () => void;
}

export function PlantDetailModal({ plantId, onClose }: PlantDetailModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const { data: plant, isLoading } = usePlant(plantId);

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

  if (!plantId) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div
        ref={modalRef}
        className="bg-background rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
      >
        {isLoading ? (
          <PlantDetailSkeleton onClose={onClose} />
        ) : plant ? (
          <>
            {/* Header */}
            <div className="sticky top-0 bg-background border-b p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Truck className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-bold font-mono">{plant.fleet_number}</h2>
                  <p className="text-sm text-muted-foreground">
                    {plant.fleet_type || 'No type assigned'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ConditionBadge condition={plant.condition} />
                {plant.physical_verification ? (
                  <Badge variant="outline" className="text-success border-success">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Verified
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    <XCircle className="h-3 w-3 mr-1" />
                    Not Verified
                  </Badge>
                )}
                <Button variant="ghost" size="icon" onClick={onClose}>
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>

            {/* Content */}
            <div className="p-4 space-y-6">
              {/* Description */}
              {plant.description && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-1">Description</h3>
                  <p className="text-foreground">{plant.description}</p>
                </div>
              )}

              <Separator />

              {/* Details Grid */}
              <div className="grid grid-cols-2 gap-4">
                <DetailItem
                  icon={MapPin}
                  label="Current Site"
                  value={plant.current_location || 'Not assigned'}
                />
                <DetailItem
                  icon={Truck}
                  label="Make / Model"
                  value={
                    plant.make || plant.model
                      ? `${plant.make || ''} ${plant.model || ''}`.trim()
                      : 'Not specified'
                  }
                />
                <DetailItem
                  icon={Hash}
                  label="Chassis Number"
                  value={plant.chassis_number || 'Not specified'}
                />
                <DetailItem
                  icon={Calendar}
                  label="Year of Manufacture"
                  value={plant.year_of_manufacture?.toString() || 'Not specified'}
                />
              </div>

              <Separator />

              {/* Maintenance Summary */}
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                  <Wrench className="h-4 w-4" />
                  Maintenance Summary
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-2xl font-bold text-foreground">
                      {plant.total_maintenance_cost != null
                        ? formatCurrency(plant.total_maintenance_cost)
                        : '₦0'}
                    </p>
                    <p className="text-xs text-muted-foreground">Total Cost</p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-2xl font-bold text-foreground">
                      {plant.parts_replaced_count ?? 0}
                    </p>
                    <p className="text-xs text-muted-foreground">Parts Replaced</p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-2xl font-bold text-foreground">
                      {plant.last_maintenance_date
                        ? formatDate(plant.last_maintenance_date)
                        : 'Never'}
                    </p>
                    <p className="text-xs text-muted-foreground">Last Maintenance</p>
                  </div>
                </div>
              </div>

              {/* Remarks */}
              {plant.remarks && (
                <>
                  <Separator />
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Remarks
                    </h3>
                    <p className="text-foreground text-sm bg-muted/50 rounded-lg p-3">
                      {plant.remarks}
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-background border-t p-4 flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          </>
        ) : (
          <div className="p-8 text-center">
            <p className="text-muted-foreground">Plant not found</p>
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
        <p className="text-sm font-medium text-foreground">{value}</p>
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

function PlantDetailSkeleton({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="border-b p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div>
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-4 w-32 mt-1" />
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
      </div>
      <div className="p-4 space-y-4">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      </div>
    </>
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

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
