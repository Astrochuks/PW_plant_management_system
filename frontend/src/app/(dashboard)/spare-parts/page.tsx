'use client';

/**
 * Spare Parts Page
 * Main page for viewing and managing spare parts / maintenance records
 */

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Package, Wrench, TrendingUp, Users, DollarSign, Truck, ChevronRight, BarChart3, Calendar, GitCompareArrows } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  useSpareParts,
  useSparePartsStats,
  useTopSuppliers,
  useHighCostPlants,
  useSparePartsSummary,
  useCostsByPeriod,
  useYearOverYear,
} from '@/hooks/use-spare-parts';
import { SparePartsTable } from '@/components/spare-parts/spare-parts-table';
import { SparePartsFilters, type SparePartsFiltersState } from '@/components/spare-parts/spare-parts-filters';
import { SparePartDetailModal } from '@/components/spare-parts/spare-part-detail-modal';
import { Pagination } from '@/components/plants/pagination';
import { useDebounce } from '@/hooks/use-debounce';
import type { SparePart } from '@/lib/api/spare-parts';

const DEFAULT_FILTERS: SparePartsFiltersState = {
  search: '',
  fleet_number: '',
  supplier: '',
  date_from: '',
  date_to: '',
};

export default function SparePartsPage() {
  const router = useRouter();

  // State
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<SparePartsFiltersState>(DEFAULT_FILTERS);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const currentYear = new Date().getFullYear();
  const [periodType, setPeriodType] = useState<'week' | 'month' | 'quarter'>('month');
  const [periodYear, setPeriodYear] = useState<number>(currentYear);
  const [yoyYears, setYoyYears] = useState<number[]>([currentYear, currentYear - 1]);
  const [yoyGroupBy, setYoyGroupBy] = useState<'month' | 'quarter'>('month');

  // Debounce text inputs
  const debouncedSearch = useDebounce(filters.search, 300);
  const debouncedFleet = useDebounce(filters.fleet_number, 300);
  const debouncedSupplier = useDebounce(filters.supplier, 300);

  // Build query params
  const queryParams = useMemo(
    () => ({
      page,
      limit: 25,
      search: debouncedSearch || undefined,
      fleet_number: debouncedFleet || undefined,
      supplier: debouncedSupplier || undefined,
      date_from: filters.date_from || undefined,
      date_to: filters.date_to || undefined,
    }),
    [page, debouncedSearch, debouncedFleet, debouncedSupplier, filters.date_from, filters.date_to]
  );

  // Data fetching
  const { data: partsData, isLoading: partsLoading } = useSpareParts(queryParams);
  const { data: stats, isLoading: statsLoading } = useSparePartsStats();
  const { data: topSuppliers } = useTopSuppliers({ limit: 5 });
  const { data: highCostPlants } = useHighCostPlants({ limit: 5 });
  const { data: summary } = useSparePartsSummary();
  const { data: periodData, isLoading: periodLoading } = useCostsByPeriod({
    period: periodType,
    year: periodYear,
  });
  const { data: yoyData, isLoading: yoyLoading } = useYearOverYear(
    yoyYears.length > 0 ? { years: yoyYears, group_by: yoyGroupBy } : null
  );

  // Handlers
  const handleFiltersChange = useCallback((newFilters: SparePartsFiltersState) => {
    setFilters(newFilters);
    setPage(1);
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
  }, []);

  const handleRowClick = useCallback((part: SparePart) => {
    setSelectedPartId(part.id);
  }, []);

  const handleCloseModal = useCallback(() => {
    setSelectedPartId(null);
  }, []);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Wrench className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Spare Parts</h1>
          <p className="text-sm text-muted-foreground">
            Maintenance records and purchase orders
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[100px]" />
          ))
        ) : stats ? (
          <>
            <StatsCard
              title="Total Records"
              value={stats.total_parts.toLocaleString()}
              icon={Package}
              iconBg="bg-blue-100 dark:bg-blue-900"
              iconColor="text-blue-600 dark:text-blue-300"
            />
            <StatsCard
              title="Total Spend"
              value={formatCurrency(Number(stats.total_spend) || 0)}
              icon={DollarSign}
              iconBg="bg-emerald-100 dark:bg-emerald-900"
              iconColor="text-emerald-600 dark:text-emerald-300"
            />
            <StatsCard
              title="Unique Plants"
              value={stats.unique_plants.toLocaleString()}
              icon={TrendingUp}
              iconBg="bg-violet-100 dark:bg-violet-900"
              iconColor="text-violet-600 dark:text-violet-300"
            />
            <StatsCard
              title="Suppliers"
              value={stats.unique_suppliers.toLocaleString()}
              icon={Users}
              iconBg="bg-amber-100 dark:bg-amber-900"
              iconColor="text-amber-600 dark:text-amber-300"
            />
          </>
        ) : null}
      </div>

      {/* Filters */}
      <SparePartsFilters
        filters={filters}
        onFiltersChange={handleFiltersChange}
      />

      {/* Table */}
      <SparePartsTable
        parts={partsData?.data ?? []}
        loading={partsLoading}
        onRowClick={handleRowClick}
      />

      {/* Pagination */}
      {partsData?.meta && (
        <Pagination
          meta={partsData.meta}
          onPageChange={handlePageChange}
          itemLabel="records"
        />
      )}

      {/* Analytics Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cost Summary Breakdown */}
        {summary && summary.total_cost > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Cost Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <CostDistBar label="Direct" amount={summary.direct_cost} total={summary.total_cost} color="bg-blue-500" />
                <CostDistBar label="Shared" amount={summary.shared_cost} total={summary.total_cost} color="bg-violet-500" />
                <CostDistBar label="Workshop" amount={summary.workshop_cost} total={summary.total_cost} color="bg-amber-500" />
                <CostDistBar label="Category" amount={summary.category_cost} total={summary.total_cost} color="bg-emerald-500" />
              </div>
              <div className="flex justify-between text-sm mt-4 pt-3 border-t">
                <span className="text-muted-foreground">Total ({summary.total_pos} POs, {summary.total_parts} items)</span>
                <span className="font-medium">{formatCurrency(summary.total_cost)}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Top Suppliers */}
        {topSuppliers && topSuppliers.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" />
                Top Suppliers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {topSuppliers.map((s, idx) => (
                  <div key={s.supplier} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-4">{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{s.supplier}</p>
                      <p className="text-xs text-muted-foreground">{s.parts_count} parts</p>
                    </div>
                    <span className="text-sm font-medium">{formatCurrency(Number(s.total_spend))}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* High Cost Plants */}
        {highCostPlants && highCostPlants.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Truck className="h-4 w-4" />
                Highest Maintenance Cost Plants
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[120px]">Fleet Number</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="w-[80px] text-center">Parts</TableHead>
                      <TableHead className="w-[130px] text-right">Total Cost</TableHead>
                      <TableHead className="w-[40px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {highCostPlants.map((p) => (
                      <TableRow
                        key={p.plant_id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => router.push(`/plants/${p.plant_id}`)}
                      >
                        <TableCell className="font-mono font-medium">{p.fleet_number}</TableCell>
                        <TableCell className="max-w-[250px] truncate text-sm">{p.description || '-'}</TableCell>
                        <TableCell className="text-center">{p.parts_count}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(Number(p.total_cost))}</TableCell>
                        <TableCell>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Cost by Period Section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Cost by Period
            </CardTitle>
            <div className="flex items-center gap-2">
              <Select value={periodType} onValueChange={(v) => setPeriodType(v as 'week' | 'month' | 'quarter')}>
                <SelectTrigger className="w-[120px] h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">Weekly</SelectItem>
                  <SelectItem value="month">Monthly</SelectItem>
                  <SelectItem value="quarter">Quarterly</SelectItem>
                </SelectContent>
              </Select>
              <Select value={String(periodYear)} onValueChange={(v) => setPeriodYear(Number(v))}>
                <SelectTrigger className="w-[100px] h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[currentYear, currentYear - 1, currentYear - 2].map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {periodLoading ? (
            <Skeleton className="h-[200px]" />
          ) : periodData && periodData.data.length > 0 ? (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[150px]">Period</TableHead>
                      <TableHead className="w-[100px] text-center">Items</TableHead>
                      <TableHead className="w-[100px] text-center">POs</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="w-[200px]">Distribution</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {periodData.data.map((row) => {
                      const pct = periodData.meta.grand_total > 0
                        ? Math.round((row.total_cost / periodData.meta.grand_total) * 100)
                        : 0;
                      return (
                        <TableRow key={row.period}>
                          <TableCell className="font-medium">
                            {formatPeriodLabel(periodType, row.period)}
                          </TableCell>
                          <TableCell className="text-center">{row.items_count}</TableCell>
                          <TableCell className="text-center">{row.po_count}</TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(row.total_cost)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-between text-sm mt-3 pt-3 border-t">
                <span className="text-muted-foreground">
                  {periodData.meta.periods_count} {periodType === 'week' ? 'weeks' : periodType === 'month' ? 'months' : 'quarters'}
                </span>
                <span className="font-semibold">Total: {formatCurrency(periodData.meta.grand_total)}</span>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Calendar className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No cost data for {periodYear}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Year-over-Year Comparison */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <GitCompareArrows className="h-4 w-4" />
              Year-over-Year Comparison
            </CardTitle>
            <div className="flex items-center gap-2">
              <Select value={yoyGroupBy} onValueChange={(v) => setYoyGroupBy(v as 'month' | 'quarter')}>
                <SelectTrigger className="w-[120px] h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">Monthly</SelectItem>
                  <SelectItem value="quarter">Quarterly</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1">
                {[currentYear, currentYear - 1, currentYear - 2].map((y) => (
                  <Button
                    key={y}
                    variant={yoyYears.includes(y) ? 'default' : 'outline'}
                    size="sm"
                    className="h-8 text-sm px-3"
                    onClick={() => {
                      setYoyYears((prev) =>
                        prev.includes(y) ? prev.filter((x) => x !== y) : [...prev, y].sort((a, b) => a - b)
                      );
                    }}
                  >
                    {y}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {yoyLoading ? (
            <Skeleton className="h-[200px]" />
          ) : yoyData && yoyData.data.length > 0 && yoyYears.length > 0 ? (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[120px]">
                        {yoyGroupBy === 'month' ? 'Month' : 'Quarter'}
                      </TableHead>
                      {yoyYears.map((y) => (
                        <TableHead key={y} className="text-right">{y}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {yoyData.data.map((row) => {
                      const periodVal = row[yoyGroupBy] ?? 0;
                      return (
                        <TableRow key={periodVal}>
                          <TableCell className="font-medium">
                            {yoyGroupBy === 'month'
                              ? MONTH_NAMES[periodVal - 1] || `Month ${periodVal}`
                              : `Q${periodVal}`}
                          </TableCell>
                          {yoyYears.map((y) => (
                            <TableCell key={y} className="text-right font-medium">
                              {row[String(y)] ? formatCurrency(Number(row[String(y)])) : '-'}
                            </TableCell>
                          ))}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {yoyData.meta.yearly_totals && (
                <div className="flex items-center justify-between text-sm mt-3 pt-3 border-t">
                  <span className="text-muted-foreground">Yearly Totals</span>
                  <div className="flex gap-6">
                    {yoyYears.map((y) => (
                      <span key={y} className="font-semibold">
                        {y}: {formatCurrency(Number(yoyData.meta.yearly_totals[String(y)] || 0))}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <GitCompareArrows className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">
                {yoyYears.length === 0
                  ? 'Select at least one year to compare'
                  : 'No data available for the selected years'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Modal */}
      {selectedPartId && (
        <SparePartDetailModal
          partId={selectedPartId}
          onClose={handleCloseModal}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats Card
// ---------------------------------------------------------------------------
function StatsCard({
  title,
  value,
  icon: Icon,
  iconBg,
  iconColor,
}: {
  title: string;
  value: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {title}
            </p>
            <p className="text-2xl font-bold mt-1">{value}</p>
          </div>
          <div className={`p-2.5 rounded-lg ${iconBg}`}>
            <Icon className={`h-5 w-5 ${iconColor}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Cost Distribution Bar
// ---------------------------------------------------------------------------
function CostDistBar({ label, amount, total, color }: {
  label: string;
  amount: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm w-20 text-muted-foreground">{label}</span>
      <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium w-10 text-right">{pct}%</span>
      <span className="text-xs text-muted-foreground w-20 text-right">{formatCurrency(amount)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) {
    return `₦${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `₦${(amount / 1_000).toFixed(0)}K`;
  }
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatPeriodLabel(type: 'week' | 'month' | 'quarter', period: number): string {
  if (type === 'week') return `Week ${period}`;
  if (type === 'month') return MONTH_NAMES[period - 1] || `Month ${period}`;
  if (type === 'quarter') return `Q${period}`;
  return String(period);
}
