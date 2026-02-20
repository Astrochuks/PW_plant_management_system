'use client';

/**
 * Supplier Detail Page
 * Shows supplier info, edit form, and PO history
 */

import { useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Users,
  Phone,
  Mail,
  MapPin,
  FileText,
  DollarSign,
  Loader2,
  Pencil,
  X,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Pagination } from '@/components/plants/pagination';
import { useSupplier, useSupplierPOs, useUpdateSupplier } from '@/hooks/use-suppliers';
import { useAuth } from '@/providers/auth-provider';
import type { UpdateSupplierRequest } from '@/lib/api/suppliers';

export default function SupplierDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const supplierId = params.id as string;

  const { data: supplier, isLoading } = useSupplier(supplierId);
  const [poPage, setPOPage] = useState(1);
  const { data: posData, isLoading: posLoading } = useSupplierPOs(supplierId, {
    page: poPage,
    limit: 15,
  });

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<UpdateSupplierRequest>({});
  const updateSupplier = useUpdateSupplier(supplierId);

  const startEditing = useCallback(() => {
    if (!supplier) return;
    setEditForm({
      name: supplier.name,
      contact_person: supplier.contact_person || '',
      phone: supplier.phone || '',
      email: supplier.email || '',
      address: supplier.address || '',
      is_active: supplier.is_active,
    });
    setEditing(true);
  }, [supplier]);

  const handleSave = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!editForm.name?.trim()) {
        toast.error('Name is required');
        return;
      }
      updateSupplier.mutate(editForm, {
        onSuccess: () => {
          toast.success('Supplier updated');
          setEditing(false);
        },
        onError: (err) => {
          toast.error(
            `Update failed: ${err instanceof Error ? err.message : 'Unknown error'}`
          );
        },
      });
    },
    [editForm, updateSupplier]
  );

  if (isLoading) return <SupplierDetailSkeleton />;

  if (!supplier) {
    return (
      <div className="text-center py-12">
        <Users className="h-12 w-12 mx-auto mb-4 opacity-50 text-muted-foreground" />
        <p className="text-lg text-muted-foreground">Supplier not found</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push('/suppliers')}>
          Back to Suppliers
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back Link + Header */}
      <div>
        <Link
          href="/suppliers"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Suppliers
        </Link>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Users className="h-6 w-6 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight">{supplier.name}</h1>
                <Badge variant={supplier.is_active ? 'default' : 'secondary'}>
                  {supplier.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Created {new Date(supplier.created_at).toLocaleDateString()}
              </p>
            </div>
          </div>
          {isAdmin && !editing && (
            <Button variant="outline" size="sm" onClick={startEditing}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </Button>
          )}
        </div>
      </div>

      {/* Info / Edit Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {editing ? 'Edit Supplier' : 'Supplier Details'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {editing ? (
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Name *</Label>
                  <Input
                    value={editForm.name || ''}
                    onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Contact Person</Label>
                  <Input
                    value={editForm.contact_person || ''}
                    onChange={(e) =>
                      setEditForm((p) => ({ ...p, contact_person: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input
                    value={editForm.phone || ''}
                    onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={editForm.email || ''}
                    onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Address</Label>
                  <Input
                    value={editForm.address || ''}
                    onChange={(e) => setEditForm((p) => ({ ...p, address: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={editForm.is_active ?? true}
                  onCheckedChange={(v) => setEditForm((p) => ({ ...p, is_active: v }))}
                  id="is-active"
                />
                <Label htmlFor="is-active">Active</Label>
              </div>
              <Separator />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateSupplier.isPending}>
                  {updateSupplier.isPending && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  Save Changes
                </Button>
              </div>
            </form>
          ) : (
            <div className="grid grid-cols-2 gap-6">
              <InfoItem icon={Users} label="Contact Person" value={supplier.contact_person} />
              <InfoItem icon={Phone} label="Phone" value={supplier.phone} />
              <InfoItem icon={Mail} label="Email" value={supplier.email} />
              <InfoItem icon={MapPin} label="Address" value={supplier.address} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900">
                <FileText className="h-4 w-4 text-blue-600 dark:text-blue-300" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Purchase Orders</p>
                <p className="text-xl font-bold">{supplier.po_count}</p>
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
                <p className="text-xs text-muted-foreground">Total Spend</p>
                <p className="text-xl font-bold">
                  {formatCurrency(Number(supplier.total_spend) || 0)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* PO History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Purchase Order History</CardTitle>
        </CardHeader>
        <CardContent>
          {posLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !posData?.data.length ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No purchase orders yet</p>
            </div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[150px]">PO Number</TableHead>
                      <TableHead className="w-[100px]">Date</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="w-[80px] text-center">Items</TableHead>
                      <TableHead className="w-[130px] text-right">Amount</TableHead>
                      <TableHead className="w-[40px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {posData.data.map((po) => (
                      <TableRow
                        key={po.po_number}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() =>
                          router.push(
                            `/spare-parts/po/${encodeURIComponent(po.po_number)}`
                          )
                        }
                      >
                        <TableCell className="font-mono font-medium">
                          {po.po_number}
                        </TableCell>
                        <TableCell className="text-sm">
                          {po.po_date ? formatDate(po.po_date) : '-'}
                        </TableCell>
                        <TableCell className="text-sm">{po.location || '-'}</TableCell>
                        <TableCell className="text-center">{po.items_count}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(Number(po.total_amount) || 0)}
                        </TableCell>
                        <TableCell>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {posData.meta && (
                <div className="mt-4">
                  <Pagination
                    meta={posData.meta}
                    onPageChange={setPOPage}
                    itemLabel="purchase orders"
                  />
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InfoItem({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="p-2 rounded-lg bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value || 'Not specified'}</p>
      </div>
    </div>
  );
}

function SupplierDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-4 w-32 mb-4" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div>
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-32 mt-1" />
          </div>
        </div>
      </div>
      <Skeleton className="h-[200px]" />
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-[80px]" />
        <Skeleton className="h-[80px]" />
      </div>
      <Skeleton className="h-[300px]" />
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
  if (amount >= 1_000_000) {
    return `\u20A6${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `\u20A6${(amount / 1_000).toFixed(0)}K`;
  }
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
