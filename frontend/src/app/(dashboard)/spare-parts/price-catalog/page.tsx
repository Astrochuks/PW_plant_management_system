'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search, Printer, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import apiClient from '@/lib/api/client';

function formatNGN(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency', currency: 'NGN',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(amount);
}

interface CatalogItem {
  part_name: string;
  part_number: string;
  purchase_count: number;
  total_qty: number;
  min_unit_cost: number;
  max_unit_cost: number;
  avg_unit_cost: number;
  total_spent: number;
  last_purchased: string | null;
  supplier_count: number;
  suppliers: string[];
}

function usePriceCatalog(params: { search?: string; sort_by: string; sort_order: string; page: number; limit: number }) {
  return useQuery({
    queryKey: ['spare-parts', 'price-catalog', params],
    queryFn: async () => {
      const qp: Record<string, string> = {
        sort_by: params.sort_by, sort_order: params.sort_order,
        page: String(params.page), limit: String(params.limit),
      };
      if (params.search) qp.search = params.search;
      const res = await apiClient.get<{
        success: boolean;
        data: CatalogItem[];
        meta: { page: number; limit: number; total: number; total_pages: number };
      }>('/spare-parts/analytics/price-catalog', { params: qp });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

export default function PriceCatalogPage() {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('part_name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading } = usePriceCatalog({
    search: debouncedSearch || undefined,
    sort_by: sortBy, sort_order: sortOrder,
    page, limit: 100,
  });

  const handleSort = useCallback((col: string) => {
    if (sortBy === col) {
      setSortOrder(o => o === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(col);
      setSortOrder(col === 'part_name' ? 'asc' : 'desc');
    }
    setPage(1);
  }, [sortBy]);

  const sortIcon = (col: string) => sortBy === col ? (sortOrder === 'desc' ? ' ↓' : ' ↑') : '';

  const handlePrint = useCallback(() => window.print(), []);

  return (
    <div className="space-y-4">
      {/* Header — hidden in print */}
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/spare-parts/analytics"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <BookOpen className="h-6 w-6" /> Parts Price Catalog
            </h1>
            <p className="text-sm text-muted-foreground">
              {data?.meta.total ?? '...'} unique parts across all purchase orders
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={handlePrint}>
          <Printer className="h-4 w-4 mr-2" /> Print
        </Button>
      </div>

      {/* Print header — only visible in print */}
      <div className="hidden print:block text-center mb-4">
        <h1 className="text-xl font-bold">P.W. NIGERIA LTD.</h1>
        <h2 className="text-lg">Parts Price Catalog</h2>
        <p className="text-sm text-muted-foreground">Generated {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
      </div>

      {/* Search — hidden in print */}
      <div className="flex items-center gap-3 print:hidden">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search part name or part number..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {data?.data.length ?? 0} of {data?.meta.total ?? 0} parts
        </span>
      </div>

      {/* Table */}
      {isLoading ? (
        <Skeleton className="h-96" />
      ) : !data?.data.length ? (
        <div className="text-center py-16">
          <BookOpen className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
          <p className="font-medium">No parts found</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden print:border-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px] print:w-auto">#</TableHead>
                <TableHead className="min-w-[200px] cursor-pointer hover:text-foreground print:cursor-default" onClick={() => handleSort('part_name')}>
                  Part Name{sortIcon('part_name')}
                </TableHead>
                <TableHead className="w-[100px]">Part No.</TableHead>
                <TableHead className="w-[70px] text-center cursor-pointer hover:text-foreground" onClick={() => handleSort('purchase_count')}>
                  Bought{sortIcon('purchase_count')}
                </TableHead>
                <TableHead className="w-[100px] text-right">Min Price</TableHead>
                <TableHead className="w-[100px] text-right cursor-pointer hover:text-foreground" onClick={() => handleSort('avg_unit_cost')}>
                  Avg Price{sortIcon('avg_unit_cost')}
                </TableHead>
                <TableHead className="w-[100px] text-right">Max Price</TableHead>
                <TableHead className="w-[110px] text-right cursor-pointer hover:text-foreground" onClick={() => handleSort('total_spent')}>
                  Total Spent{sortIcon('total_spent')}
                </TableHead>
                <TableHead className="min-w-[120px] print:hidden">Suppliers</TableHead>
                <TableHead className="w-[90px] cursor-pointer hover:text-foreground print:hidden" onClick={() => handleSort('last_purchased')}>
                  Last PO{sortIcon('last_purchased')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((item, idx) => (
                <TableRow key={item.part_name} className="text-sm">
                  <TableCell className="text-xs text-muted-foreground">{(page - 1) * 100 + idx + 1}</TableCell>
                  <TableCell className="font-medium">{item.part_name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">{item.part_number || '-'}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary" className="text-xs">{item.purchase_count}x</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNGN(item.min_unit_cost)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{formatNGN(item.avg_unit_cost)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNGN(item.max_unit_cost)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{formatNGN(item.total_spent)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground print:hidden">
                    {item.suppliers.filter(Boolean).slice(0, 2).join(', ')}
                    {item.supplier_count > 2 && ` +${item.supplier_count - 2}`}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground print:hidden">
                    {item.last_purchased ? new Date(item.last_purchased + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination — hidden in print */}
      {data?.meta && data.meta.total_pages > 1 && (
        <div className="flex items-center justify-between print:hidden">
          <span className="text-sm text-muted-foreground">
            Page {data.meta.page} of {data.meta.total_pages} ({data.meta.total} parts)
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= data.meta.total_pages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function useDebounce(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
