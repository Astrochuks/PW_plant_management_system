'use client';

/**
 * Purchase Order Detail Page
 * Shows PO items, cost summary, document management, edit/delete actions
 */

import { useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  FileText,
  Truck,
  Package,
  DollarSign,
  Users,
  Trash2,
  Upload,
  Download,
  X,
  Loader2,
  Pencil,
  Calendar,
  MapPin,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  usePartsByPO,
  useDeletePartsByPO,
  useUploadPODocument,
  useDeletePODocument,
  useUpdatePO,
} from '@/hooks/use-spare-parts';
import { getPODocument, type UpdatePORequest } from '@/lib/api/spare-parts';
import { useAuth } from '@/providers/auth-provider';
import { useLocationsWithStats } from '@/hooks/use-locations';
import { SparePartDetailModal } from '@/components/spare-parts/spare-part-detail-modal';
import { useQuery } from '@tanstack/react-query';
import { sparePartsKeys } from '@/hooks/use-spare-parts';

export default function PODetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const poNumber = decodeURIComponent(params.poNumber as string);

  const { data: poData, isLoading } = usePartsByPO(poNumber);
  const { data: docData } = useQuery({
    queryKey: sparePartsKeys.poDocument(poNumber),
    queryFn: () => getPODocument(poNumber),
    staleTime: 5 * 60 * 1000,
  });

  const deletePO = useDeletePartsByPO();
  const uploadDoc = useUploadPODocument();
  const deleteDoc = useDeletePODocument();
  const updatePO = useUpdatePO();

  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<UpdatePORequest>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: locations } = useLocationsWithStats();

  const startEditing = useCallback(() => {
    const parts = poData?.data ?? [];
    const meta = poData?.meta;
    const first = parts[0];
    // Use overhead from meta (covers both single-fleet and multi-fleet POs)
    const overhead = meta?.overhead;
    const vatFromParts = parts.reduce((s, p) => s + (Number(p.vat_amount) || 0), 0);
    const discFromParts = parts.reduce((s, p) => s + (Number(p.discount_amount) || 0), 0);
    setEditForm({
      po_date: first?.po_date?.slice(0, 10) || '',
      supplier_id: first?.supplier_id || '',
      vat_amount: (overhead?.vat_amount || vatFromParts) || undefined,
      discount_amount: (overhead?.discount_amount || discFromParts) || undefined,
      location_id: first?.location_id || '',
      requisition_number: first?.requisition_number || '',
    });
    setEditing(true);
  }, [poData]);

  const handleSaveEdit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const data: UpdatePORequest = {};
      if (editForm.po_date) data.po_date = editForm.po_date;
      if (editForm.supplier_id) data.supplier_id = editForm.supplier_id;
      if (editForm.vat_amount != null) data.vat_amount = editForm.vat_amount;
      if (editForm.discount_amount != null) data.discount_amount = editForm.discount_amount;
      if (editForm.location_id) data.location_id = editForm.location_id;
      if (editForm.requisition_number) data.requisition_number = editForm.requisition_number;

      updatePO.mutate(
        { poNumber, data },
        {
          onSuccess: () => {
            toast.success('PO updated');
            setEditing(false);
          },
          onError: (err) =>
            toast.error(`Update failed: ${err instanceof Error ? err.message : 'Unknown error'}`),
        }
      );
    },
    [editForm, poNumber, updatePO]
  );

  const handleDeletePO = useCallback(() => {
    deletePO.mutate(poNumber, {
      onSuccess: () => {
        toast.success(`Deleted PO ${poNumber}`);
        router.push('/spare-parts/pos');
      },
      onError: (err) => {
        toast.error(`Failed to delete: ${err instanceof Error ? err.message : 'Unknown error'}`);
      },
    });
  }, [deletePO, poNumber, router]);

  const handleUploadDocument = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      uploadDoc.mutate(
        { poNumber, file },
        {
          onSuccess: () => toast.success('Document uploaded'),
          onError: (err) =>
            toast.error(`Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`),
        }
      );
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [uploadDoc, poNumber]
  );

  const handleDeleteDocument = useCallback(() => {
    deleteDoc.mutate(poNumber, {
      onSuccess: () => toast.success('Document deleted'),
      onError: (err) =>
        toast.error(`Delete failed: ${err instanceof Error ? err.message : 'Unknown error'}`),
    });
  }, [deleteDoc, poNumber]);

  if (isLoading) return <PODetailSkeleton />;

  const parts = poData?.data ?? [];
  const meta = poData?.meta;

  // Derive PO-level info from parts
  const poDate = parts[0]?.po_date;
  const poLocation = parts[0]?.location_id;
  const poReqNo = parts[0]?.requisition_number;

  // Use PO-level cost_type from backend meta (computed same as v_purchase_orders_summary view)
  // Fallback: compute from parts if meta not available
  const costType = meta?.cost_type ?? (() => {
    if (parts.length === 0) return null;
    const distinctPlants = new Set(parts.map(p => p.plant_id).filter(Boolean));
    const hasWorkshop = parts.some(p => p.is_workshop);
    const hasCategory = parts.some(p => p.is_category);
    if (distinctPlants.size === 1 && !hasWorkshop && !hasCategory) return 'direct';
    return 'shared';
  })();

  return (
    <div className="space-y-6">
      {/* Back Link + Header */}
      <div>
        <Link
          href="/spare-parts/pos"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Purchase Orders
        </Link>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <FileText className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight font-mono">{poNumber}</h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {meta?.suppliers && meta.suppliers.length > 0 && (
                  <span className="text-sm text-muted-foreground">
                    {meta.suppliers.map((s: { name: string }) => s.name).join(' / ')}
                  </span>
                )}
                {poDate && (
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {formatDate(poDate)}
                  </span>
                )}
                {costType && (
                  <Badge variant={costType === 'shared' ? 'secondary' : 'outline'}>
                    {costType === 'shared' ? 'Shared' : 'Direct'}
                  </Badge>
                )}
              </div>
            </div>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2">
              {!editing && (
                <Button variant="outline" size="sm" onClick={startEditing}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit PO
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={deletePO.isPending}>
                    {deletePO.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 mr-2" />
                    )}
                    Delete PO
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Purchase Order?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete PO <strong>{poNumber}</strong> and all{' '}
                      {meta?.items_count ?? 0} line items. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeletePO}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>
      </div>

      {/* Edit Form */}
      {editing && (
        <Card className="border-primary/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Pencil className="h-4 w-4" />
              Edit PO Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>PO Date</Label>
                  <Input
                    type="date"
                    value={editForm.po_date || ''}
                    onChange={(e) => setEditForm((p) => ({ ...p, po_date: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Requisition Number</Label>
                  <Input
                    value={editForm.requisition_number || ''}
                    onChange={(e) => setEditForm((p) => ({ ...p, requisition_number: e.target.value }))}
                    placeholder="Optional"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Location</Label>
                  <Select
                    value={editForm.location_id || 'none'}
                    onValueChange={(v) => setEditForm((p) => ({ ...p, location_id: v === 'none' ? '' : v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select location" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No location</SelectItem>
                      {locations?.map((loc) => (
                        <SelectItem key={loc.id} value={loc.id}>
                          {loc.location_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>VAT Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editForm.vat_amount ?? ''}
                    onChange={(e) =>
                      setEditForm((p) => ({
                        ...p,
                        vat_amount: e.target.value ? Number(e.target.value) : undefined,
                      }))
                    }
                    placeholder="Total VAT amount"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Discount Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editForm.discount_amount ?? ''}
                    onChange={(e) =>
                      setEditForm((p) => ({
                        ...p,
                        discount_amount: e.target.value ? Number(e.target.value) : undefined,
                      }))
                    }
                    placeholder="Total discount amount"
                  />
                </div>
              </div>
              <Separator />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updatePO.isPending}>
                  {updatePO.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Save Changes
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900">
                <Package className="h-4 w-4 text-blue-600 dark:text-blue-300" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Items</p>
                <p className="text-xl font-bold">{meta?.items_count ?? parts.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900">
                <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Cost</p>
                <p className="text-xl font-bold">
                  {formatCurrency(Number(meta?.total_cost) || 0)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-violet-100 dark:bg-violet-900">
                <Truck className="h-4 w-4 text-violet-600 dark:text-violet-300" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Plants</p>
                <p className="text-xl font-bold">{meta?.distinct_plants ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900">
                <Users className="h-4 w-4 text-amber-600 dark:text-amber-300" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  {(meta?.suppliers?.length ?? 0) > 1 ? 'Suppliers' : 'Supplier'}
                </p>
                {(meta?.suppliers?.length ?? 0) > 1 ? (
                  <p className="text-xl font-bold">{meta?.suppliers?.length}</p>
                ) : (
                  <p className="text-sm font-medium truncate max-w-[140px]">
                    {meta?.supplier?.name || '-'}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cost Breakdown */}
      {parts.length > 0 && (() => {
        const subtotal = parts.reduce((s, p) => s + (Number(p.unit_cost) || 0) * (p.quantity || 1), 0);
        // Use overhead from meta (PO-level costs for multi-fleet POs)
        // Fall back to summing from parts for single-fleet POs where overhead is embedded
        const overhead = meta?.overhead;
        const totalVat = overhead?.vat_amount || parts.reduce((s, p) => s + (Number(p.vat_amount) || 0), 0);
        const totalDiscount = overhead?.discount_amount || parts.reduce((s, p) => s + (Number(p.discount_amount) || 0), 0);
        const totalOther = overhead?.other_costs || parts.reduce((s, p) => s + (Number(p.other_costs) || 0), 0);
        const grandTotal = Number(meta?.total_cost) || 0;
        const hasOverhead = totalVat > 0 || totalDiscount > 0 || totalOther > 0;
        return (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Cost Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-w-md">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Items Subtotal ({parts.length} items)</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
                {totalVat > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">VAT</span>
                    <span>{formatCurrency(totalVat)}</span>
                  </div>
                )}
                {totalDiscount > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Discount</span>
                    <span>-{formatCurrency(totalDiscount)}</span>
                  </div>
                )}
                {totalOther > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Other Costs</span>
                    <span>{formatCurrency(totalOther)}</span>
                  </div>
                )}
                {hasOverhead && <Separator />}
                <div className={`flex justify-between font-medium ${hasOverhead ? 'text-base' : 'text-sm'}`}>
                  <span>{hasOverhead ? 'Grand Total' : 'Total'}</span>
                  <span>{formatCurrency(grandTotal)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* PO Info */}
      {(poReqNo || poLocation) && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-6">
              {poReqNo && (
                <div className="flex items-center gap-2 text-sm">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Requisition:</span>
                  <span className="font-medium">{poReqNo}</span>
                </div>
              )}
              {poLocation && locations && (
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Location:</span>
                  <span className="font-medium">
                    {locations.find((l) => l.id === poLocation)?.location_name || poLocation}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Document Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            PO Document
          </CardTitle>
        </CardHeader>
        <CardContent>
          {docData ? (
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{docData.document_name}</p>
                  <p className="text-xs text-muted-foreground">
                    Uploaded {new Date(docData.uploaded_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" asChild>
                  <a href={docData.document_url} target="_blank" rel="noopener noreferrer">
                    <Download className="h-4 w-4 mr-1" />
                    View
                  </a>
                </Button>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDeleteDocument}
                    disabled={deleteDoc.isPending}
                  >
                    {deleteDoc.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <X className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-muted-foreground">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No document attached</p>
              {isAdmin && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="hidden"
                    onChange={handleUploadDocument}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadDoc.isPending}
                  >
                    {uploadDoc.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4 mr-2" />
                    )}
                    Upload Document
                  </Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Line Items — grouped by supplier */}
      {(() => {
        // Group parts by supplier
        const groups = parts.reduce<Record<string, { name: string; parts: typeof parts }>>((acc, part) => {
          const key = part.supplier_id || part.supplier_name || part.supplier || 'Unknown';
          const name = part.supplier_name || part.supplier || 'Unknown';
          if (!acc[key]) acc[key] = { name, parts: [] };
          acc[key].parts.push(part);
          return acc;
        }, {});
        const supplierGroups = Object.entries(groups);
        const hasMultipleSuppliers = supplierGroups.length > 1;

        if (parts.length === 0) {
          return (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Line Items</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No items in this PO</p>
                </div>
              </CardContent>
            </Card>
          );
        }

        return supplierGroups.map(([key, group]) => {
          const groupSubtotal = group.parts.reduce(
            (s, p) => s + (Number(p.total_cost) || 0),
            0
          );
          return (
            <Card key={key}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    {hasMultipleSuppliers && <Users className="h-4 w-4" />}
                    {hasMultipleSuppliers ? group.name : 'Line Items'}
                  </CardTitle>
                  <div className="text-sm text-muted-foreground">
                    {group.parts.length} item{group.parts.length !== 1 ? 's' : ''}
                    {hasMultipleSuppliers && (
                      <span className="ml-2 font-medium text-foreground">
                        {formatCurrency(groupSubtotal)}
                      </span>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[100px]">Fleet #</TableHead>
                        <TableHead>Part Description</TableHead>
                        <TableHead className="w-[120px]">Part Number</TableHead>
                        <TableHead className="w-[60px] text-center">Qty</TableHead>
                        <TableHead className="w-[110px] text-right">Unit Cost</TableHead>
                        <TableHead className="w-[120px] text-right">Total Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.parts.map((part) => (
                        <TableRow
                          key={part.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setSelectedPartId(part.id)}
                        >
                          <TableCell className="font-mono font-medium">
                            {part.fleet_number
                              || part.fleet_number_raw
                              || (part.is_workshop ? 'WORKSHOP' : null)
                              || (part.is_category ? (part.category_name || 'CATEGORY') : null)
                              || '-'}
                          </TableCell>
                          <TableCell>
                            <div className="truncate max-w-[300px]" title={part.part_description}>
                              {part.part_description}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {part.part_number || '-'}
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
              </CardContent>
            </Card>
          );
        });
      })()}

      {/* Spare Part Detail Modal */}
      {selectedPartId && (
        <SparePartDetailModal
          partId={selectedPartId}
          onClose={() => setSelectedPartId(null)}
        />
      )}
    </div>
  );
}

function PODetailSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-4 w-40 mb-4" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div>
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-32 mt-1" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-[80px]" />
        ))}
      </div>
      <Skeleton className="h-[120px]" />
      <Skeleton className="h-[300px]" />
    </div>
  );
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-NG', {
    day: '2-digit',
    month: 'short',
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
