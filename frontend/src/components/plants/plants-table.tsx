'use client';

/**
 * Plants Table Component
 * PW-branded table with toolbar (result count, column toggle, export)
 */

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { CheckCircle, XCircle, Wrench, Download, Columns3, ChevronDown, Plus } from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { exportPlantsExcel } from '@/lib/api/plants';
import type { PlantSummary } from '@/hooks/use-plants';
import type { PlantCondition } from '@/lib/api/plants';
import type { PaginationMeta } from '@/lib/api/plants';

// All possible column keys the table can display
export type ColumnKey =
  | 'fleet_number'
  | 'description'
  | 'fleet_type'
  | 'make'
  | 'model'
  | 'current_location'
  | 'state'
  | 'condition'
  | 'physical_verification'
  | 'chassis_number'
  | 'year_of_manufacture'
  | 'purchase_year'
  | 'purchase_cost'
  | 'total_maintenance_cost'
  | 'parts_replaced_count'
  | 'last_maintenance_date'
  | 'remarks';

interface ColumnDef {
  key: ColumnKey;
  header: string;
  width?: string;
  align?: 'left' | 'center' | 'right';
  render: (plant: PlantSummary) => React.ReactNode;
  skeleton?: string;
}

const COLUMN_DEFS: ColumnDef[] = [
  {
    key: 'fleet_number',
    header: 'Fleet Number',
    width: 'w-[130px]',
    render: (p) => <span className="font-mono font-medium">{p.fleet_number}</span>,
    skeleton: 'w-16',
  },
  {
    key: 'description',
    header: 'Description',
    render: (p) => (
      <span className="max-w-[300px] truncate block" title={p.description || ''}>
        {p.description || '-'}
      </span>
    ),
    skeleton: 'w-full max-w-[200px]',
  },
  {
    key: 'fleet_type',
    header: 'Type',
    width: 'w-[180px]',
    render: (p) =>
      p.fleet_type ? (
        <span className="text-sm text-muted-foreground">{p.fleet_type}</span>
      ) : (
        '-'
      ),
    skeleton: 'w-24',
  },
  {
    key: 'make',
    header: 'Make',
    width: 'w-[120px]',
    render: (p) => p.make || '-',
    skeleton: 'w-16',
  },
  {
    key: 'model',
    header: 'Model',
    width: 'w-[120px]',
    render: (p) => p.model || '-',
    skeleton: 'w-16',
  },
  {
    key: 'current_location',
    header: 'Site',
    width: 'w-[140px]',
    render: (p) => p.current_location || '-',
    skeleton: 'w-20',
  },
  {
    key: 'state',
    header: 'State',
    width: 'w-[100px]',
    render: (p) => p.state || '-',
    skeleton: 'w-16',
  },
  {
    key: 'condition',
    header: 'Condition',
    width: 'w-[120px]',
    render: (p) => <ConditionBadge condition={p.condition} />,
    skeleton: 'w-20',
  },
  {
    key: 'physical_verification',
    header: 'Verified',
    width: 'w-[80px]',
    align: 'center',
    render: (p) =>
      p.physical_verification ? (
        <CheckCircle className="h-5 w-5 text-success mx-auto" />
      ) : (
        <XCircle className="h-5 w-5 text-muted-foreground mx-auto" />
      ),
    skeleton: 'w-5',
  },
  {
    key: 'chassis_number',
    header: 'Chassis Number',
    width: 'w-[140px]',
    render: (p) => <span className="font-mono text-xs">{p.chassis_number || '-'}</span>,
    skeleton: 'w-20',
  },
  {
    key: 'year_of_manufacture',
    header: 'Year Mfg',
    width: 'w-[100px]',
    align: 'center',
    render: (p) => p.year_of_manufacture ?? '-',
    skeleton: 'w-12',
  },
  {
    key: 'purchase_year',
    header: 'Purchase Year',
    width: 'w-[120px]',
    align: 'center',
    render: (p) => p.purchase_year ?? '-',
    skeleton: 'w-12',
  },
  {
    key: 'purchase_cost',
    header: 'Purchase Cost',
    width: 'w-[130px]',
    align: 'right',
    render: (p) =>
      p.purchase_cost != null ? formatCurrency(p.purchase_cost) : '-',
    skeleton: 'w-16',
  },
  {
    key: 'total_maintenance_cost',
    header: 'Maintenance',
    width: 'w-[130px]',
    align: 'right',
    render: (p) =>
      p.total_maintenance_cost != null ? (
        <span className="flex items-center justify-end gap-1 text-sm">
          <Wrench className="h-3 w-3 text-muted-foreground" />
          {formatCurrency(p.total_maintenance_cost)}
        </span>
      ) : (
        '-'
      ),
    skeleton: 'w-16',
  },
  {
    key: 'parts_replaced_count',
    header: 'Parts',
    width: 'w-[80px]',
    align: 'center',
    render: (p) => p.parts_replaced_count ?? 0,
    skeleton: 'w-8',
  },
  {
    key: 'last_maintenance_date',
    header: 'Last Maint.',
    width: 'w-[120px]',
    render: (p) =>
      p.last_maintenance_date
        ? new Date(p.last_maintenance_date).toLocaleDateString('en-NG', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })
        : '-',
    skeleton: 'w-20',
  },
  {
    key: 'remarks',
    header: 'Remarks',
    render: (p) => (
      <span className="max-w-[200px] truncate block text-sm text-muted-foreground" title={p.remarks || ''}>
        {p.remarks || '-'}
      </span>
    ),
    skeleton: 'w-32',
  },
];

// Build a lookup map for quick access
const COLUMN_MAP = new Map(COLUMN_DEFS.map((c) => [c.key, c]));

// Column definitions for visibility toggle
export const ALL_COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: 'fleet_number', label: 'Fleet Number' },
  { key: 'description', label: 'Description' },
  { key: 'fleet_type', label: 'Type' },
  { key: 'make', label: 'Make' },
  { key: 'model', label: 'Model' },
  { key: 'current_location', label: 'Site' },
  { key: 'state', label: 'State' },
  { key: 'condition', label: 'Condition' },
  { key: 'physical_verification', label: 'Verified' },
  { key: 'chassis_number', label: 'Chassis Number' },
  { key: 'year_of_manufacture', label: 'Year Mfg' },
  { key: 'purchase_year', label: 'Purchase Year' },
  { key: 'purchase_cost', label: 'Purchase Cost' },
  { key: 'total_maintenance_cost', label: 'Maintenance Cost' },
  { key: 'parts_replaced_count', label: 'Parts Replaced' },
  { key: 'last_maintenance_date', label: 'Last Maintenance' },
  { key: 'remarks', label: 'Remarks' },
];

export const DEFAULT_VISIBLE_COLUMNS: ColumnKey[] = [
  'fleet_number',
  'description',
  'fleet_type',
  'current_location',
  'condition',
  'physical_verification',
  'total_maintenance_cost',
];

interface PlantsTableProps {
  plants: PlantSummary[];
  loading: boolean;
  onRowClick?: (plant: PlantSummary) => void;
  onRowHover?: (plantId: string) => void;
  visibleColumns: ColumnKey[];
  onVisibleColumnsChange: (columns: ColumnKey[]) => void;
  meta?: PaginationMeta;
  exportParams?: Record<string, string | undefined>;
}

export function PlantsTable({
  plants,
  loading,
  onRowClick,
  onRowHover,
  visibleColumns,
  onVisibleColumnsChange,
  meta,
  exportParams,
}: PlantsTableProps) {
  const { user } = useAuth();
  const [exporting, setExporting] = useState(false);
  const isAdmin = user?.role === 'admin';

  const columns = visibleColumns
    .map((key) => COLUMN_MAP.get(key))
    .filter((c): c is ColumnDef => c !== undefined);

  const toggleColumn = (key: ColumnKey) => {
    if (key === 'fleet_number') return;
    const next = visibleColumns.includes(key)
      ? visibleColumns.filter((c) => c !== key)
      : [...visibleColumns, key];
    onVisibleColumnsChange(next);
  };

  const columnsCustomized = visibleColumns.length !== DEFAULT_VISIBLE_COLUMNS.length ||
    visibleColumns.some((c) => !DEFAULT_VISIBLE_COLUMNS.includes(c));

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await exportPlantsExcel({
        ...exportParams,
        columns: visibleColumns.join(','),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `plants_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Export downloaded');
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  // Result count text
  const resultText = meta
    ? `Showing ${((meta.page - 1) * meta.limit) + 1}–${Math.min(meta.page * meta.limit, meta.total)} of ${meta.total.toLocaleString()} plants`
    : plants.length > 0
      ? `${plants.length} plants`
      : '';

  return (
    <div className="space-y-0">
      {/* Table Toolbar */}
      <div className="flex items-center justify-between py-2">
        <p className="text-sm text-muted-foreground">{resultText}</p>
        <div className="flex items-center gap-2">
          {/* Add Plant (admin only) */}
          {isAdmin && (
            <Button variant="default" size="sm" asChild>
              <Link href="/plants/create">
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add Plant
              </Link>
            </Button>
          )}

          {/* Columns Toggle */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3 className="h-3.5 w-3.5 mr-1.5" />
                Columns
                {columnsCustomized && (
                  <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-xs font-normal">
                    {visibleColumns.length}
                  </Badge>
                )}
                <ChevronDown className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[220px] max-h-[400px] overflow-y-auto">
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {ALL_COLUMNS.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.key}
                  checked={visibleColumns.includes(col.key)}
                  onCheckedChange={() => toggleColumn(col.key)}
                  disabled={col.key === 'fleet_number'}
                >
                  {col.label}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={false}
                onCheckedChange={() => onVisibleColumnsChange(DEFAULT_VISIBLE_COLUMNS)}
              >
                Reset to defaults
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Export */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exporting || plants.length === 0}
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            {exporting ? 'Exporting...' : 'Export'}
          </Button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <PlantsTableSkeleton columns={columns} />
      ) : plants.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-lg">
          <p className="text-lg">No plants found</p>
          <p className="text-sm mt-1">Try adjusting your filters or search term</p>
        </div>
      ) : (
        <div className="rounded-lg border-2 border-border overflow-x-auto">
          {/* PW Brand Banner */}
          <div className="flex items-center gap-3 px-4 py-2 bg-background border-b-2 border-border">
            <Image
              src="/images/logo.png"
              alt="P.W. Nigeria Ltd."
              width={55}
              height={55}
              className="rounded"
            />
            <span className="text-foreground font-bold text-base tracking-wide">
              P.W. NIGERIA LTD. — Plant Register
            </span>
          </div>
          <Table className="border-collapse">
            <TableHeader>
              <TableRow className="bg-[#ffbf36] hover:bg-[#ffbf36] border-b-2 border-[#e6ac31]">
                {columns.map((col) => (
                  <TableHead
                    key={col.key}
                    className={`
                      text-[#101415] font-semibold text-xs uppercase tracking-wider border-x border-[#e6ac31]/50
                      ${col.width || ''}
                      ${col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : ''}
                    `}
                  >
                    {col.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {plants.map((plant, idx) => (
                <TableRow
                  key={plant.id}
                  className={`
                    ${onRowClick ? 'cursor-pointer' : ''}
                    ${idx % 2 === 0 ? 'bg-background' : 'bg-muted/30'}
                    hover:bg-muted/60 border-b border-border
                  `}
                  onClick={() => onRowClick?.(plant)}
                  onMouseEnter={() => onRowHover?.(plant.id)}
                >
                  {columns.map((col) => (
                    <TableCell
                      key={col.key}
                      className={`text-sm border-x border-border/50 ${col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : ''}`}
                    >
                      {col.render(plant)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
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

function PlantsTableSkeleton({ columns }: { columns: ColumnDef[] }) {
  return (
    <div className="rounded-lg border-2 border-border">
      {/* PW Brand Banner */}
      <div className="flex items-center gap-3 px-4 py-2 bg-background border-b-2 border-border">
        <Image
          src="/images/logo.png"
          alt="P.W. Nigeria Ltd."
          width={55}
          height={55}
          className="rounded"
        />
        <span className="text-foreground font-bold text-base tracking-wide">
          P.W. NIGERIA LTD. — Plant Register
        </span>
      </div>
      <Table className="border-collapse">
        <TableHeader>
          <TableRow className="bg-[#ffbf36] hover:bg-[#ffbf36] border-b-2 border-[#e6ac31]">
            {columns.map((col) => (
              <TableHead
                key={col.key}
                className={`
                  text-[#101415] font-semibold text-xs uppercase tracking-wider border-x border-[#e6ac31]/50
                  ${col.width || ''}
                  ${col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : ''}
                `}
              >
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...Array(10)].map((_, i) => (
            <TableRow key={i} className={`${i % 2 === 0 ? 'bg-background' : 'bg-muted/30'} border-b border-border`}>
              {columns.map((col) => (
                <TableCell key={col.key} className="border-x border-border/50">
                  <Skeleton
                    className={`h-5 ${col.skeleton || 'w-16'} ${col.align === 'center' ? 'mx-auto' : col.align === 'right' ? 'ml-auto' : ''}`}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
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
