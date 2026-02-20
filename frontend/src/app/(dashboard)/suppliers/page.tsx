'use client';

/**
 * Suppliers List Page
 * Shows all suppliers with search, filtering, and inline create
 */

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  Search,
  X,
  Plus,
  ChevronRight,
  Loader2,
  Phone,
  Mail,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
import { useSuppliers, useCreateSupplier } from '@/hooks/use-suppliers';
import { useDebounce } from '@/hooks/use-debounce';
import { useAuth } from '@/providers/auth-provider';
import type { Supplier, CreateSupplierRequest } from '@/lib/api/suppliers';

export default function SuppliersPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // Filters
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const debouncedSearch = useDebounce(search, 300);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CreateSupplierRequest>({ name: '' });
  const createSupplier = useCreateSupplier();

  const queryParams = useMemo(
    () => ({
      page,
      limit: 25,
      search: debouncedSearch || undefined,
      active_only: activeOnly,
    }),
    [page, debouncedSearch, activeOnly]
  );

  const { data, isLoading } = useSuppliers(queryParams);

  const handleRowClick = useCallback(
    (supplier: Supplier) => {
      router.push(`/suppliers/${supplier.id}`);
    },
    [router]
  );

  const handleCreateSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!createForm.name.trim()) {
        toast.error('Supplier name is required');
        return;
      }
      createSupplier.mutate(createForm, {
        onSuccess: (newSupplier) => {
          toast.success(`Created supplier: ${newSupplier.name}`);
          setShowCreate(false);
          setCreateForm({ name: '' });
        },
        onError: (err) => {
          toast.error(
            `Failed to create: ${err instanceof Error ? err.message : 'Unknown error'}`
          );
        },
      });
    },
    [createForm, createSupplier]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Users className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Suppliers</h1>
            <p className="text-sm text-muted-foreground">
              Manage vendors and view their purchase history
            </p>
          </div>
        </div>
        {isAdmin && (
          <Button onClick={() => setShowCreate(!showCreate)}>
            {showCreate ? (
              <>
                <X className="h-4 w-4 mr-2" />
                Cancel
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Add Supplier
              </>
            )}
          </Button>
        )}
      </div>

      {/* Create Form (inline) */}
      {showCreate && (
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name *</Label>
                  <Input
                    id="name"
                    placeholder="Supplier name"
                    value={createForm.name}
                    onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contact">Contact Person</Label>
                  <Input
                    id="contact"
                    placeholder="Contact name"
                    value={createForm.contact_person || ''}
                    onChange={(e) =>
                      setCreateForm((p) => ({ ...p, contact_person: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    placeholder="Phone number"
                    value={createForm.phone || ''}
                    onChange={(e) => setCreateForm((p) => ({ ...p, phone: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="Email address"
                    value={createForm.email || ''}
                    onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address">Address</Label>
                  <Input
                    id="address"
                    placeholder="Address"
                    value={createForm.address || ''}
                    onChange={(e) => setCreateForm((p) => ({ ...p, address: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={createSupplier.isPending}>
                  {createSupplier.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  Create Supplier
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search supplier name..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={activeOnly}
            onCheckedChange={(v) => { setActiveOnly(v); setPage(1); }}
            id="active-only"
          />
          <Label htmlFor="active-only" className="text-sm">
            Active only
          </Label>
        </div>
        {search && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setPage(1); }}>
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <SuppliersTableSkeleton />
      ) : !data?.data.length ? (
        <div className="text-center py-12 text-muted-foreground">
          <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg">No suppliers found</p>
          <p className="text-sm mt-1">
            {search ? 'Try adjusting your search' : 'Add your first supplier to get started'}
          </p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-[150px]">Contact</TableHead>
                <TableHead className="w-[130px]">Phone</TableHead>
                <TableHead className="w-[80px] text-center">POs</TableHead>
                <TableHead className="w-[130px] text-right">Total Spend</TableHead>
                <TableHead className="w-[80px] text-center">Status</TableHead>
                <TableHead className="w-[40px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((supplier) => (
                <TableRow
                  key={supplier.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleRowClick(supplier)}
                >
                  <TableCell className="font-medium">{supplier.name}</TableCell>
                  <TableCell className="text-sm">
                    {supplier.contact_person || '-'}
                  </TableCell>
                  <TableCell className="text-sm">
                    {supplier.phone ? (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3 text-muted-foreground" />
                        {supplier.phone}
                      </span>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell className="text-center">{supplier.po_count}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(Number(supplier.total_spend) || 0)}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={supplier.is_active ? 'default' : 'secondary'}>
                      {supplier.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination */}
      {data?.meta && (
        <Pagination
          meta={data.meta}
          onPageChange={setPage}
          itemLabel="suppliers"
        />
      )}
    </div>
  );
}

function SuppliersTableSkeleton() {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="w-[150px]">Contact</TableHead>
            <TableHead className="w-[130px]">Phone</TableHead>
            <TableHead className="w-[80px] text-center">POs</TableHead>
            <TableHead className="w-[130px] text-right">Total Spend</TableHead>
            <TableHead className="w-[80px] text-center">Status</TableHead>
            <TableHead className="w-[40px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...Array(8)].map((_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-5 w-32" /></TableCell>
              <TableCell><Skeleton className="h-5 w-24" /></TableCell>
              <TableCell><Skeleton className="h-5 w-24" /></TableCell>
              <TableCell><Skeleton className="h-5 w-8 mx-auto" /></TableCell>
              <TableCell><Skeleton className="h-5 w-20 ml-auto" /></TableCell>
              <TableCell><Skeleton className="h-5 w-14 mx-auto" /></TableCell>
              <TableCell />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
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
