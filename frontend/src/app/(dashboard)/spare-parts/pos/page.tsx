'use client';

/**
 * Purchase Orders List Page
 * Shows all POs with filters, stats, and navigation to detail/create
 */

import { Suspense, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  FileText,
  DollarSign,
  Search,
  X,
  Calendar,
  Plus,
  ChevronRight,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
import { Pagination } from '@/components/plants/pagination';
import { usePurchaseOrders } from '@/hooks/use-spare-parts';
import { useDebounce } from '@/hooks/use-debounce';
import { useAuth } from '@/providers/auth-provider';
import { useUrlFilters } from '@/hooks/use-url-filters';
import type { POSummary } from '@/lib/api/spare-parts';

const FILTER_DEFAULTS = {
  search: '',
  costType: '',
  year: '',
  dateFrom: '',
  dateTo: '',
  page: '1',
};

function PurchaseOrdersPageInner() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [filters, setFilters, clearFilters] = useUrlFilters(FILTER_DEFAULTS);
  const page = Number(filters.page) || 1;
  const search = filters.search;
  const costType = filters.costType;
  const year = filters.year;
  const dateFrom = filters.dateFrom;
  const dateTo = filters.dateTo;

  const debouncedSearch = useDebounce(search, 300);

  const queryParams = useMemo(
    () => ({
      page,
      limit: 25,
      search: debouncedSearch || undefined,
      cost_type: costType || undefined,
      year: year ? Number(year) : undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      sort_by: 'po_date' as const,
      sort_order: 'desc' as const,
    }),
    [page, debouncedSearch, costType, year, dateFrom, dateTo]
  );

  const { data, isLoading } = usePurchaseOrders(queryParams);

  const hasActiveFilters = search || costType || year || dateFrom || dateTo;

  const handleRowClick = useCallback(
    (po: POSummary) => {
      router.push(`/spare-parts/po/${encodeURIComponent(po.po_number)}`);
    },
    [router]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <FileText className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Purchase Orders</h1>
            <p className="text-sm text-muted-foreground">
              Manage purchase orders and their line items
            </p>
          </div>
        </div>
        {isAdmin && (
          <Button onClick={() => router.push('/spare-parts/create')}>
            <Plus className="h-4 w-4 mr-2" />
            New PO Entry
          </Button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-4">
        {isLoading ? (
          <>
            <Skeleton className="h-[80px]" />
            <Skeleton className="h-[80px]" />
          </>
        ) : data ? (
          <>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Total POs
                    </p>
                    <p className="text-2xl font-bold mt-1">{data.meta.total.toLocaleString()}</p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-blue-100 dark:bg-blue-900">
                    <FileText className="h-5 w-5 text-blue-600 dark:text-blue-300" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Total Amount
                    </p>
                    <p className="text-2xl font-bold mt-1">
                      {formatCurrency(Number(data.meta.total_amount) || 0)}
                    </p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-emerald-100 dark:bg-emerald-900">
                    <DollarSign className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>

      {/* Filters */}
      <div className="space-y-4">
        <div className="flex gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search PO number or vendor..."
              value={search}
              onChange={(e) => setFilters({ search: e.target.value, page: '1' })}
              className="pl-9"
            />
          </div>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-4 w-4 mr-1" />
              Clear filters
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <Select value={costType || 'all'} onValueChange={(v) => setFilters({ costType: v === 'all' ? '' : v, page: '1' })}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Cost type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="direct">Direct</SelectItem>
              <SelectItem value="shared">Shared</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="Year"
            type="number"
            value={year}
            onChange={(e) => setFilters({ year: e.target.value, page: '1' })}
            className="w-[100px]"
          />
          <div className="flex items-center gap-2">
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setFilters({ dateFrom: e.target.value, page: '1' })}
                className="w-[160px] pl-9"
              />
            </div>
            <span className="text-muted-foreground">to</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setFilters({ dateTo: e.target.value, page: '1' })}
              className="w-[140px]"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <POTableSkeleton />
      ) : !data?.data.length ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg">No purchase orders found</p>
          <p className="text-sm mt-1">Try adjusting your filters</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[150px]">PO Number</TableHead>
                <TableHead className="w-[100px]">Date</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead className="w-[150px]">Location</TableHead>
                <TableHead className="w-[80px] text-center">Items</TableHead>
                <TableHead className="w-[130px] text-right">Amount</TableHead>
                <TableHead className="w-[100px] text-center">Type</TableHead>
                <TableHead className="w-[40px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((po) => (
                <TableRow
                  key={po.po_number}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleRowClick(po)}
                >
                  <TableCell className="font-mono font-medium">{po.po_number}</TableCell>
                  <TableCell className="text-sm">
                    {po.po_date ? formatDate(po.po_date) : '-'}
                  </TableCell>
                  <TableCell className="truncate max-w-[200px]" title={po.vendor}>
                    {po.vendor || '-'}
                  </TableCell>
                  <TableCell className="text-sm truncate" title={po.location_name || ''}>
                    {po.location_name || '-'}
                  </TableCell>
                  <TableCell className="text-center">{po.items_count}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(Number(po.total_amount) || 0)}
                  </TableCell>
                  <TableCell className="text-center">
                    <CostTypeBadge type={po.cost_type} />
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
          onPageChange={(p) => setFilters({ page: String(p) })}
          itemLabel="purchase orders"
        />
      )}
    </div>
  );
}

export default function PurchaseOrdersPage() {
  return (
    <Suspense>
      <PurchaseOrdersPageInner />
    </Suspense>
  );
}

function CostTypeBadge({ type }: { type: string }) {
  if (type === 'shared') {
    return <Badge variant="secondary">Shared</Badge>;
  }
  return <Badge variant="outline">Direct</Badge>;
}

function POTableSkeleton() {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[150px]">PO Number</TableHead>
            <TableHead className="w-[100px]">Date</TableHead>
            <TableHead>Vendor</TableHead>
            <TableHead className="w-[150px]">Location</TableHead>
            <TableHead className="w-[80px] text-center">Items</TableHead>
            <TableHead className="w-[130px] text-right">Amount</TableHead>
            <TableHead className="w-[100px] text-center">Type</TableHead>
            <TableHead className="w-[40px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...Array(8)].map((_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-5 w-24" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16" /></TableCell>
              <TableCell><Skeleton className="h-5 w-32" /></TableCell>
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
