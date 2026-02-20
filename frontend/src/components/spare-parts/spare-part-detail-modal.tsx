'use client';

/**
 * Spare Part Detail Modal Component
 * Shows detailed information about a selected spare part.
 * Admins can toggle edit mode to update fields inline.
 */

import { useEffect, useRef, useState } from 'react';
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
  Edit2,
  Save,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useSparePart, useUpdateSparePart } from '@/hooks/use-spare-parts';
import { useAuth } from '@/providers/auth-provider';
import type { UpdateSparePartRequest } from '@/lib/api/spare-parts';

interface SparePartDetailModalProps {
  partId: string | null;
  onClose: () => void;
}

export function SparePartDetailModal({ partId, onClose }: SparePartDetailModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const { data: part, isLoading } = useSparePart(partId);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<UpdateSparePartRequest>({});
  const [error, setError] = useState<string | null>(null);
  const updateMutation = useUpdateSparePart();

  // Populate edit form when entering edit mode
  const startEditing = () => {
    if (!part) return;
    setEditForm({
      part_description: part.part_description,
      part_number: part.part_number || '',
      supplier: part.supplier || '',
      quantity: part.quantity,
      unit_cost: part.unit_cost ?? undefined,
      reason_for_change: part.reason_for_change || '',
      remarks: part.remarks || '',
    });
    setError(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditForm({});
    setError(null);
  };

  const handleSave = async () => {
    if (!partId) return;
    setError(null);

    // Build only changed fields
    const changes: UpdateSparePartRequest = {};
    if (part && editForm.part_description !== part.part_description) changes.part_description = editForm.part_description;
    if (part && editForm.part_number !== (part.part_number || '')) changes.part_number = editForm.part_number;
    if (part && editForm.supplier !== (part.supplier || '')) changes.supplier = editForm.supplier;
    if (part && editForm.quantity !== part.quantity) changes.quantity = editForm.quantity;
    if (part && editForm.unit_cost !== (part.unit_cost ?? undefined)) changes.unit_cost = editForm.unit_cost;
    if (part && editForm.reason_for_change !== (part.reason_for_change || '')) changes.reason_for_change = editForm.reason_for_change;
    if (part && editForm.remarks !== (part.remarks || '')) changes.remarks = editForm.remarks;

    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }

    try {
      await updateMutation.mutateAsync({ partId, data: changes });
      setEditing(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update';
      setError(msg);
    }
  };

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editing) cancelEditing();
        else onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose, editing]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        if (!editing) onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose, editing]);

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
                  {editing ? (
                    <Input
                      value={editForm.part_description || ''}
                      onChange={(e) => setEditForm({ ...editForm, part_description: e.target.value })}
                      className="font-bold text-lg h-8"
                    />
                  ) : (
                    <h2 className="text-lg font-bold">{part.part_description}</h2>
                  )}
                  {editing ? (
                    <Input
                      value={editForm.part_number || ''}
                      onChange={(e) => setEditForm({ ...editForm, part_number: e.target.value })}
                      placeholder="Part number"
                      className="mt-1 font-mono text-sm h-7"
                    />
                  ) : part.part_number ? (
                    <p className="text-sm text-muted-foreground font-mono">
                      {part.part_number}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {isAdmin && !editing && (
                  <Button variant="ghost" size="icon" onClick={startEditing} title="Edit">
                    <Edit2 className="h-4 w-4" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" onClick={editing ? cancelEditing : onClose}>
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>

            {/* Content */}
            <div className="p-4 space-y-6">
              {/* Error message */}
              {error && (
                <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3">
                  {error}
                </div>
              )}

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
                {editing ? (
                  <EditableItem
                    icon={User}
                    label="Supplier"
                    value={editForm.supplier || ''}
                    onChange={(v) => setEditForm({ ...editForm, supplier: v })}
                  />
                ) : (
                  <DetailItem
                    icon={User}
                    label="Supplier"
                    value={part.supplier || 'Not specified'}
                  />
                )}
                {editing ? (
                  <EditableItem
                    icon={Hash}
                    label="Quantity"
                    value={String(editForm.quantity ?? '')}
                    onChange={(v) => setEditForm({ ...editForm, quantity: v ? Number(v) : undefined })}
                    type="number"
                  />
                ) : (
                  <DetailItem
                    icon={Hash}
                    label="Quantity"
                    value={String(part.quantity)}
                  />
                )}
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
                  <div className="flex justify-between text-sm items-center">
                    <span className="text-muted-foreground">Unit Cost</span>
                    {editing ? (
                      <Input
                        type="number"
                        value={editForm.unit_cost ?? ''}
                        onChange={(e) => setEditForm({ ...editForm, unit_cost: e.target.value ? Number(e.target.value) : undefined })}
                        className="w-32 h-7 text-right"
                      />
                    ) : (
                      <span>{part.unit_cost != null ? formatCurrency(part.unit_cost) : '-'}</span>
                    )}
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Quantity</span>
                    <span>x {editing ? (editForm.quantity ?? part.quantity) : part.quantity}</span>
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
              {(part.reason_for_change || editing) && (
                <>
                  <Separator />
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground mb-1">
                      Reason for Change
                    </h3>
                    {editing ? (
                      <textarea
                        value={editForm.reason_for_change || ''}
                        onChange={(e) => setEditForm({ ...editForm, reason_for_change: e.target.value })}
                        className="w-full text-sm bg-muted/50 rounded-lg p-3 border resize-none"
                        rows={2}
                      />
                    ) : (
                      <p className="text-sm bg-muted/50 rounded-lg p-3">
                        {part.reason_for_change}
                      </p>
                    )}
                  </div>
                </>
              )}

              {/* Remarks */}
              {(part.remarks || editing) && (
                <>
                  <Separator />
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Remarks
                    </h3>
                    {editing ? (
                      <textarea
                        value={editForm.remarks || ''}
                        onChange={(e) => setEditForm({ ...editForm, remarks: e.target.value })}
                        className="w-full text-sm bg-muted/50 rounded-lg p-3 border resize-none"
                        rows={2}
                      />
                    ) : (
                      <p className="text-sm bg-muted/50 rounded-lg p-3">
                        {part.remarks}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-background border-t p-4 flex justify-end gap-2">
              {editing ? (
                <>
                  <Button variant="outline" onClick={cancelEditing} disabled={updateMutation.isPending}>
                    Cancel
                  </Button>
                  <Button onClick={handleSave} disabled={updateMutation.isPending}>
                    {updateMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-2" />
                    )}
                    Save Changes
                  </Button>
                </>
              ) : (
                <Button variant="outline" onClick={onClose}>
                  Close
                </Button>
              )}
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

function EditableItem({
  icon: Icon,
  label,
  value,
  onChange,
  type = 'text',
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="p-2 rounded-lg bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 text-sm mt-0.5"
        />
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
