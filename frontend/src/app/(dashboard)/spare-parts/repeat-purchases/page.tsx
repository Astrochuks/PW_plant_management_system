'use client';

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, AlertTriangle, Search, ShieldAlert, Info, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useRepeatPurchases, type RepeatPurchase } from '@/hooks/use-spare-parts';

function formatNGN(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function SeverityBadge({ severity }: { severity: string }) {
  const config: Record<string, { label: string; className: string; icon: typeof AlertTriangle }> = {
    critical: { label: 'Critical', className: 'bg-red-100 text-red-800 border-red-300', icon: ShieldAlert },
    warning: { label: 'Warning', className: 'bg-amber-100 text-amber-800 border-amber-300', icon: AlertTriangle },
    info: { label: 'Review', className: 'bg-blue-100 text-blue-800 border-blue-200', icon: Info },
    normal: { label: 'Normal', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle },
  };
  const c = config[severity] || config.normal;
  const Icon = c.icon;

  return (
    <Badge variant="outline" className={`text-[11px] gap-1 ${c.className}`}>
      <Icon className="h-3 w-3" />
      {c.label}
    </Badge>
  );
}

function PriceRatioBadge({ ratio }: { ratio: number }) {
  let className = 'text-emerald-700 bg-emerald-50';
  if (ratio >= 5) className = 'text-red-800 bg-red-100 font-bold';
  else if (ratio >= 2) className = 'text-amber-800 bg-amber-100 font-semibold';
  else if (ratio >= 1.3) className = 'text-blue-800 bg-blue-50';

  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${className}`}>
      {ratio}x
    </span>
  );
}

function StatCard({ label, value, subtext, color }: { label: string; value: string | number; subtext?: string; color?: string }) {
  const colorClass = {
    red: 'text-red-600',
    amber: 'text-amber-600',
    green: 'text-emerald-600',
    blue: 'text-blue-600',
  }[color || 'blue'] || '';

  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold mt-1 ${colorClass}`}>{value}</p>
        {subtext && <p className="text-xs text-muted-foreground mt-0.5">{subtext}</p>}
      </CardContent>
    </Card>
  );
}

export default function RepeatPurchasesPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('price_ratio');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [severityFilter, setSeverityFilter] = useState('all');

  const queryParams = useMemo(() => ({
    page,
    limit: 50,
    sort_by: sortBy,
    sort_order: sortOrder,
    min_price_ratio: severityFilter === 'critical' ? 5.0
      : severityFilter === 'warning' ? 2.0
      : severityFilter === 'info' ? 1.3
      : 1.0,
  }), [page, sortBy, sortOrder, severityFilter]);

  const { data, isLoading } = useRepeatPurchases(queryParams);

  const filteredData = useMemo(() => {
    if (!data?.data || !search) return data?.data || [];
    const q = search.toLowerCase();
    return data.data.filter(
      (r) =>
        r.fleet_number?.toLowerCase().includes(q) ||
        r.part_name?.toLowerCase().includes(q) ||
        r.suppliers?.some((s) => s.toLowerCase().includes(q))
    );
  }, [data?.data, search]);

  const handleSort = useCallback((col: string) => {
    if (sortBy === col) {
      setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(col);
      setSortOrder('desc');
    }
    setPage(1);
  }, [sortBy, sortOrder]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/spare-parts/analytics">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Repeat Purchase Detection</h1>
          <p className="text-sm text-muted-foreground">
            Parts bought more than once for the same plant across different POs
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : data?.summary ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total Repeat Items" value={data.summary.total_repeat_items} color="blue" />
          <StatCard
            label="Critical (5x+ price diff)"
            value={data.summary.critical_count}
            subtext="Likely errors or overcharging"
            color="red"
          />
          <StatCard
            label="Warning (2x-5x price diff)"
            value={data.summary.warning_count}
            subtext="Significant price difference"
            color="amber"
          />
          <StatCard
            label="Flagged Total Spend"
            value={formatNGN(data.summary.flagged_total_spent)}
            subtext="Total spent on critical + warning items"
            color="red"
          />
        </div>
      ) : null}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search fleet number, part, or supplier..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={severityFilter} onValueChange={(v) => { setSeverityFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Severities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            <SelectItem value="critical">Critical (5x+)</SelectItem>
            <SelectItem value="warning">Warning (2x+)</SelectItem>
            <SelectItem value="info">Review (1.3x+)</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground">
          {filteredData.length} items
        </span>
      </div>

      {/* Table */}
      {isLoading ? (
        <Skeleton className="h-96" />
      ) : filteredData.length === 0 ? (
        <div className="text-center py-16">
          <CheckCircle className="h-12 w-12 mx-auto text-emerald-400 mb-3" />
          <p className="font-medium text-lg">No repeat purchases found</p>
          <p className="text-sm text-muted-foreground mt-1">
            {severityFilter !== 'all' ? 'Try changing the severity filter' : 'All spare parts are unique purchases'}
          </p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[90px]">Severity</TableHead>
                  <TableHead
                    className="w-[100px] cursor-pointer hover:text-foreground"
                    onClick={() => handleSort('fleet_number')}
                  >
                    Fleet No. {sortBy === 'fleet_number' && (sortOrder === 'desc' ? '↓' : '↑')}
                  </TableHead>
                  <TableHead
                    className="min-w-[180px] cursor-pointer hover:text-foreground"
                    onClick={() => handleSort('part_name')}
                  >
                    Part {sortBy === 'part_name' && (sortOrder === 'desc' ? '↓' : '↑')}
                  </TableHead>
                  <TableHead
                    className="w-[80px] text-center cursor-pointer hover:text-foreground"
                    onClick={() => handleSort('purchase_count')}
                  >
                    Times {sortBy === 'purchase_count' && (sortOrder === 'desc' ? '↓' : '↑')}
                  </TableHead>
                  <TableHead className="w-[100px] text-right">Min Price</TableHead>
                  <TableHead className="w-[100px] text-right">Max Price</TableHead>
                  <TableHead
                    className="w-[80px] text-center cursor-pointer hover:text-foreground"
                    onClick={() => handleSort('price_ratio')}
                  >
                    Ratio {sortBy === 'price_ratio' && (sortOrder === 'desc' ? '↓' : '↑')}
                  </TableHead>
                  <TableHead
                    className="w-[120px] text-right cursor-pointer hover:text-foreground"
                    onClick={() => handleSort('total_spent')}
                  >
                    Total Spent {sortBy === 'total_spent' && (sortOrder === 'desc' ? '↓' : '↑')}
                  </TableHead>
                  <TableHead className="min-w-[180px]">PO Numbers</TableHead>
                  <TableHead className="min-w-[120px]">Suppliers</TableHead>
                  <TableHead className="w-[100px]">Date Range</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredData.map((item, idx) => (
                  <RepeatPurchaseRow key={`${item.plant_id}-${item.part_name}-${idx}`} item={item} />
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {data?.meta && data.meta.total_pages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Page {data.meta.page} of {data.meta.total_pages} ({data.meta.total} items)
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.meta.total_pages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function RepeatPurchaseRow({ item }: { item: RepeatPurchase }) {
  const rowBg = item.severity === 'critical' ? 'bg-red-50/50'
    : item.severity === 'warning' ? 'bg-amber-50/30'
    : '';

  const formatDate = (d: string | null) => {
    if (!d) return '-';
    return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: '2-digit',
    });
  };

  return (
    <TooltipProvider>
      <TableRow className={rowBg}>
        <TableCell>
          <SeverityBadge severity={item.severity} />
        </TableCell>
        <TableCell className="font-mono font-medium text-sm">
          {item.fleet_number ? (
            <Link href={`/plants/${item.plant_id}`} className="hover:underline text-primary">
              {item.fleet_number}
            </Link>
          ) : (
            <span className="text-muted-foreground">Workshop</span>
          )}
        </TableCell>
        <TableCell>
          <div className="text-sm font-medium">{item.part_name}</div>
          {item.plant_description && (
            <div className="text-xs text-muted-foreground truncate max-w-[200px]">{item.plant_description}</div>
          )}
        </TableCell>
        <TableCell className="text-center">
          <Badge variant="secondary" className="text-xs">
            {item.po_count} POs
          </Badge>
        </TableCell>
        <TableCell className="text-right text-sm tabular-nums">{formatNGN(item.min_unit_cost)}</TableCell>
        <TableCell className="text-right text-sm tabular-nums">{formatNGN(item.max_unit_cost)}</TableCell>
        <TableCell className="text-center">
          <PriceRatioBadge ratio={item.price_ratio} />
        </TableCell>
        <TableCell className="text-right text-sm font-medium tabular-nums">
          {formatNGN(item.total_spent)}
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {item.po_numbers.map((po) => (
              <Tooltip key={po}>
                <TooltipTrigger>
                  <Badge variant="outline" className="text-[10px] font-mono cursor-default">
                    {po.length > 18 ? po.slice(0, 18) + '...' : po}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>{po}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TableCell>
        <TableCell>
          <div className="text-xs text-muted-foreground">
            {item.suppliers.filter(Boolean).join(', ') || '-'}
          </div>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
          {formatDate(item.first_purchase_date)} — {formatDate(item.last_purchase_date)}
        </TableCell>
      </TableRow>
    </TooltipProvider>
  );
}
