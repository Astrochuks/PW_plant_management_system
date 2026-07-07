'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search, Printer, BookOpen, Settings2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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

// Column definitions for toggle control
type ColumnKey = 'row_num' | 'part_name' | 'part_number' | 'qty' | 'pos' | 'min_price' | 'avg_price' | 'max_price' | 'total_spent' | 'suppliers' | 'last_po';

const ALL_COLUMNS: { key: ColumnKey; label: string; alwaysScreen?: boolean }[] = [
  { key: 'row_num', label: '#' },
  { key: 'part_name', label: 'Part Name' },
  { key: 'part_number', label: 'Part No.' },
  { key: 'qty', label: 'Qty' },
  { key: 'pos', label: 'POs' },
  { key: 'min_price', label: 'Min Price' },
  { key: 'avg_price', label: 'Avg Price' },
  { key: 'max_price', label: 'Max Price' },
  { key: 'total_spent', label: 'Total Spent' },
  { key: 'suppliers', label: 'Suppliers', alwaysScreen: true },
  { key: 'last_po', label: 'Last PO', alwaysScreen: true },
];

const DEFAULT_PRINT_COLUMNS: Set<ColumnKey> = new Set([
  'row_num', 'part_name', 'part_number', 'qty', 'pos',
  'min_price', 'avg_price', 'max_price', 'total_spent',
]);

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
  const [isPrintMode, setIsPrintMode] = useState(false);

  // Print column visibility — which columns appear on the printed document
  const [printColumns, setPrintColumns] = useState<Set<ColumnKey>>(() => new Set(DEFAULT_PRINT_COLUMNS));

  const togglePrintColumn = useCallback((key: ColumnKey) => {
    setPrintColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        // Don't allow removing Part Name — always required
        if (key === 'part_name') return prev;
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const debouncedSearch = useDebounce(search, 300);

  const queryLimit = isPrintMode ? 10000 : 100;
  const queryPage = isPrintMode ? 1 : page;

  const { data, isLoading } = usePriceCatalog({
    search: debouncedSearch || undefined,
    sort_by: sortBy, sort_order: sortOrder,
    page: queryPage, limit: queryLimit,
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

  const handlePrint = useCallback(() => {
    setIsPrintMode(true);
  }, []);

  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const res = await apiClient.get<{
        success: boolean;
        data: CatalogItem[];
        meta: { total: number };
      }>('/spare-parts/analytics/price-catalog', {
        params: { sort_by: sortBy, sort_order: sortOrder, page: '1', limit: '10000' },
      });
      const items = res.data.data;
      const { utils, writeFile } = await import('xlsx');

      // Column config: key → { header, width, value extractor }
      const colDefs: { key: ColumnKey; header: string; wch: number; value: (item: CatalogItem, idx: number) => string | number }[] = [
        { key: 'row_num', header: '#', wch: 5, value: (_, i) => i + 1 },
        { key: 'part_name', header: 'Part Name', wch: 35, value: (item) => item.part_name },
        { key: 'part_number', header: 'Part Number', wch: 15, value: (item) => item.part_number || '-' },
        { key: 'qty', header: 'Qty', wch: 8, value: (item) => item.total_qty },
        { key: 'pos', header: 'POs', wch: 6, value: (item) => item.purchase_count },
        { key: 'min_price', header: 'Min Price (₦)', wch: 15, value: (item) => item.min_unit_cost },
        { key: 'avg_price', header: 'Avg Price (₦)', wch: 15, value: (item) => item.avg_unit_cost },
        { key: 'max_price', header: 'Max Price (₦)', wch: 15, value: (item) => item.max_unit_cost },
        { key: 'total_spent', header: 'Total Spent (₦)', wch: 18, value: (item) => item.total_spent },
        { key: 'suppliers', header: 'Suppliers', wch: 30, value: (item) => item.suppliers.filter(Boolean).join(', ') },
        { key: 'last_po', header: 'Last PO Date', wch: 14, value: (item) => item.last_purchased || '-' },
      ];

      // Only include selected columns
      const activeCols = colDefs.filter(c => printColumns.has(c.key));

      const rows = items.map((item, idx) => {
        const row: Record<string, string | number> = {};
        for (const col of activeCols) {
          row[col.header] = col.value(item, idx);
        }
        return row;
      });

      const ws = utils.json_to_sheet(rows);
      ws['!cols'] = activeCols.map(c => ({ wch: c.wch }));

      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, 'Price Catalog');
      writeFile(wb, `PW_Price_Catalog_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setIsExporting(false);
    }
  }, [sortBy, sortOrder, printColumns]);

  // When print mode is active, wait for ALL data to load then print
  useEffect(() => {
    if (!isPrintMode) return;
    const ready =
      (data && !isLoading && data.data.length > 100) ||
      (data && !isLoading && data.meta.total <= 100 && data.data.length === data.meta.total);
    if (!ready) return;

    const t = setTimeout(() => {
      // Nuke every fixed-position element from the DOM before printing
      // (catches React Query Devtools, toasts, overlays, etc.)
      const hidden: { el: HTMLElement; prev: string }[] = [];
      document.querySelectorAll('*').forEach(el => {
        const style = window.getComputedStyle(el);
        if (style.position === 'fixed' || style.position === 'sticky') {
          const htmlEl = el as HTMLElement;
          hidden.push({ el: htmlEl, prev: htmlEl.style.display });
          htmlEl.style.setProperty('display', 'none', 'important');
        }
      });

      window.print();

      // Restore everything after print dialog closes
      hidden.forEach(({ el, prev }) => {
        el.style.display = prev;
      });
      setIsPrintMode(false);
    }, 500);
    return () => clearTimeout(t);
  }, [isPrintMode, data, isLoading]);

  // Helper: should column be visible on screen? (always yes for screen)
  // Should column be visible in print?
  const printVis = (key: ColumnKey) => printColumns.has(key);

  // Build className for cells: always visible on screen, conditionally hidden in print
  const colClass = (key: ColumnKey, base: string) => {
    const hide = !printVis(key) ? ' print:hidden' : '';
    return base + hide;
  };

  return (
    <div className="space-y-4">
      {/* Header — hidden in print */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
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
        <div className="flex flex-wrap items-center gap-2">
          {/* Print column selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Settings2 className="h-4 w-4 mr-2" /> Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Print & Export Columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {ALL_COLUMNS.map(col => (
                <DropdownMenuCheckboxItem
                  key={col.key}
                  checked={printColumns.has(col.key)}
                  onCheckedChange={() => togglePrintColumn(col.key)}
                  disabled={col.key === 'part_name'}
                >
                  {col.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" onClick={handleExport} disabled={isExporting}>
            <Download className="h-4 w-4 mr-2" /> {isExporting ? 'Exporting...' : 'Export Excel'}
          </Button>
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" /> Print
          </Button>
        </div>
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
      {isLoading && isPrintMode ? (
        <div className="text-center py-8 print:hidden">Loading all data for print...</div>
      ) : isLoading ? (
        <Skeleton className="h-96" />
      ) : !data?.data.length ? (
        <div className="text-center py-16">
          <BookOpen className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
          <p className="font-medium">No parts found</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden print:border-0 print:overflow-visible">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={colClass('row_num', 'w-[40px] print:w-auto')}>#</TableHead>
                <TableHead className={colClass('part_name', 'min-w-[200px] print:min-w-0 cursor-pointer hover:text-foreground print:cursor-default')} onClick={() => handleSort('part_name')}>
                  Part Name{sortIcon('part_name')}
                </TableHead>
                <TableHead className={colClass('part_number', 'w-[100px] print:w-auto')}>Part No.</TableHead>
                <TableHead className={colClass('qty', 'w-[50px] text-center')}>Qty</TableHead>
                <TableHead className={colClass('pos', 'w-[50px] text-center cursor-pointer hover:text-foreground')} onClick={() => handleSort('purchase_count')}>
                  POs{sortIcon('purchase_count')}
                </TableHead>
                <TableHead className={colClass('min_price', 'w-[100px] text-right')}>Min Price</TableHead>
                <TableHead className={colClass('avg_price', 'w-[100px] text-right cursor-pointer hover:text-foreground')} onClick={() => handleSort('avg_unit_cost')}>
                  Avg Price{sortIcon('avg_unit_cost')}
                </TableHead>
                <TableHead className={colClass('max_price', 'w-[100px] text-right')}>Max Price</TableHead>
                <TableHead className={colClass('total_spent', 'w-[110px] text-right cursor-pointer hover:text-foreground')} onClick={() => handleSort('total_spent')}>
                  Total Spent{sortIcon('total_spent')}
                </TableHead>
                <TableHead className={colClass('suppliers', 'min-w-[120px]')}>Suppliers</TableHead>
                <TableHead className={colClass('last_po', 'w-[90px] cursor-pointer hover:text-foreground')} onClick={() => handleSort('last_purchased')}>
                  Last PO{sortIcon('last_purchased')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((item, idx) => (
                <TableRow key={`${item.part_name}-${item.part_number}-${idx}`} className="text-sm print:text-[7px]">
                  <TableCell className={colClass('row_num', 'text-xs print:text-[7px] text-muted-foreground')}>{idx + 1}</TableCell>
                  <TableCell className={colClass('part_name', 'font-medium print:whitespace-normal print:max-w-[200px]')}>{item.part_name}</TableCell>
                  <TableCell className={colClass('part_number', 'text-xs print:text-[7px] text-muted-foreground font-mono')}>{item.part_number || '-'}</TableCell>
                  <TableCell className={colClass('qty', 'text-center text-xs tabular-nums')}>{item.total_qty}</TableCell>
                  <TableCell className={colClass('pos', 'text-center')}>
                    <Badge variant="secondary" className="text-xs print:text-[7px]">{item.purchase_count}x</Badge>
                  </TableCell>
                  <TableCell className={colClass('min_price', 'text-right tabular-nums')}>{formatNGN(item.min_unit_cost)}</TableCell>
                  <TableCell className={colClass('avg_price', 'text-right tabular-nums font-medium')}>{formatNGN(item.avg_unit_cost)}</TableCell>
                  <TableCell className={colClass('max_price', 'text-right tabular-nums')}>{formatNGN(item.max_unit_cost)}</TableCell>
                  <TableCell className={colClass('total_spent', 'text-right tabular-nums font-medium')}>{formatNGN(item.total_spent)}</TableCell>
                  <TableCell className={colClass('suppliers', 'text-xs text-muted-foreground')}>
                    {item.suppliers.filter(Boolean).slice(0, 2).join(', ')}
                    {item.supplier_count > 2 && ` +${item.supplier_count - 2}`}
                  </TableCell>
                  <TableCell className={colClass('last_po', 'text-xs text-muted-foreground')}>
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
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
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
