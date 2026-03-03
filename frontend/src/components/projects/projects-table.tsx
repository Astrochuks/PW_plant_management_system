'use client'

import { useRouter } from 'next/navigation'
import { FolderKanban, Columns3, ChevronDown } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Project } from '@/hooks/use-projects'

// ── Column definitions ────────────────────────────────────────────────────

export type ColumnKey =
  | 'project_name'
  | 'client'
  | 'state'
  | 'site'
  | 'status'
  | 'contract_sum'
  | 'award_date'
  | 'award_letter'
  | 'substantial_cert'
  | 'substantial_date'
  | 'final_cert'
  | 'final_date'
  | 'maintenance_cert'
  | 'maintenance_date'
  | 'retention_date'
  | 'retention_paid'
  | 'amount_paid'
  | 'source_sheet'

interface ColumnDef {
  key: ColumnKey
  header: string
  width?: string
  align?: 'left' | 'center' | 'right'
  render: (project: Project) => React.ReactNode
  skeleton?: string
}

const STATUS_STYLES: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  active: { label: 'Active', variant: 'default', className: 'bg-emerald-600 hover:bg-emerald-600 text-white' },
  completed: { label: 'Completed', variant: 'secondary', className: 'bg-gray-200 text-gray-700' },
  retention_period: { label: 'Retention', variant: 'secondary', className: 'bg-amber-100 text-amber-800' },
  on_hold: { label: 'On Hold', variant: 'outline' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
  legacy: { label: 'Legacy', variant: 'outline', className: 'bg-blue-50 text-blue-700 border-blue-200' },
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function CertBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">-</span>
  const lower = value.toLowerCase()
  if (lower === 'yes') return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">Yes</Badge>
  if (lower === 'ongoing') return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]">Ongoing</Badge>
  return <span className="text-xs text-muted-foreground truncate max-w-[100px] block">{value}</span>
}

const COLUMN_DEFS: ColumnDef[] = [
  {
    key: 'project_name',
    header: 'Project Name',
    render: (p) => (
      <div className="max-w-[300px]">
        <span className="font-medium line-clamp-1">{p.project_name}</span>
        {p.short_name && <div className="text-xs text-muted-foreground">{p.short_name}</div>}
      </div>
    ),
    skeleton: 'w-full max-w-[300px]',
  },
  {
    key: 'client',
    header: 'Client',
    width: 'w-[150px]',
    render: (p) => <span className="text-sm">{p.client}</span>,
    skeleton: 'w-24',
  },
  {
    key: 'state',
    header: 'State',
    width: 'w-[120px]',
    render: (p) => <span className="text-sm">{p.state_name || '-'}</span>,
    skeleton: 'w-20',
  },
  {
    key: 'site',
    header: 'Site',
    width: 'w-[130px]',
    render: (p) => (
      <span className="text-sm">
        {p.linked_location_name || <span className="text-muted-foreground">-</span>}
      </span>
    ),
    skeleton: 'w-24',
  },
  {
    key: 'status',
    header: 'Status',
    width: 'w-[110px]',
    render: (p) => {
      const style = STATUS_STYLES[p.status] || STATUS_STYLES.active
      return <Badge variant={style.variant} className={style.className}>{style.label}</Badge>
    },
    skeleton: 'w-16',
  },
  {
    key: 'contract_sum',
    header: 'Contract Sum',
    width: 'w-[150px]',
    align: 'right',
    render: (p) => (
      <span className="font-medium">
        {p.current_contract_sum != null ? formatCurrency(p.current_contract_sum) : '-'}
      </span>
    ),
    skeleton: 'w-28 ml-auto',
  },
  {
    key: 'award_date',
    header: 'Award Date',
    width: 'w-[110px]',
    render: (p) => <span className="text-sm">{p.award_date ? formatDate(p.award_date) : '-'}</span>,
    skeleton: 'w-20',
  },
  {
    key: 'award_letter',
    header: 'Award Letter',
    width: 'w-[100px]',
    render: (p) => (
      <span className="text-sm">{p.has_award_letter ? 'Yes' : 'No'}</span>
    ),
    skeleton: 'w-12',
  },
  {
    key: 'substantial_cert',
    header: 'Subst. Cert',
    width: 'w-[100px]',
    render: (p) => <CertBadge value={p.substantial_completion_cert} />,
    skeleton: 'w-16',
  },
  {
    key: 'substantial_date',
    header: 'Subst. Date',
    width: 'w-[110px]',
    render: (p) => <span className="text-xs">{p.substantial_completion_date ? formatDate(p.substantial_completion_date) : '-'}</span>,
    skeleton: 'w-20',
  },
  {
    key: 'final_cert',
    header: 'Final Cert',
    width: 'w-[100px]',
    render: (p) => <CertBadge value={p.final_completion_cert} />,
    skeleton: 'w-16',
  },
  {
    key: 'final_date',
    header: 'Final Date',
    width: 'w-[110px]',
    render: (p) => <span className="text-xs">{p.final_completion_date ? formatDate(p.final_completion_date) : '-'}</span>,
    skeleton: 'w-20',
  },
  {
    key: 'maintenance_cert',
    header: 'Maint. Cert',
    width: 'w-[100px]',
    render: (p) => <CertBadge value={p.maintenance_cert} />,
    skeleton: 'w-16',
  },
  {
    key: 'maintenance_date',
    header: 'Maint. Date',
    width: 'w-[110px]',
    render: (p) => <span className="text-xs">{p.maintenance_cert_date ? formatDate(p.maintenance_cert_date) : '-'}</span>,
    skeleton: 'w-20',
  },
  {
    key: 'retention_date',
    header: 'Retention Appl.',
    width: 'w-[110px]',
    render: (p) => <span className="text-xs">{p.retention_application_date ? formatDate(p.retention_application_date) : '-'}</span>,
    skeleton: 'w-20',
  },
  {
    key: 'retention_paid',
    header: 'Paid',
    width: 'w-[70px]',
    render: (p) => <span className="text-sm capitalize">{p.retention_paid || '-'}</span>,
    skeleton: 'w-10',
  },
  {
    key: 'amount_paid',
    header: 'Amount Paid',
    width: 'w-[130px]',
    align: 'right',
    render: (p) => (
      <span className="text-sm">
        {p.retention_amount_paid != null ? formatCurrency(p.retention_amount_paid) : '-'}
      </span>
    ),
    skeleton: 'w-24 ml-auto',
  },
  {
    key: 'source_sheet',
    header: 'Source Sheet',
    width: 'w-[120px]',
    render: (p) => <span className="text-xs text-muted-foreground">{p.source_sheet || '-'}</span>,
    skeleton: 'w-20',
  },
]

const COLUMN_MAP = new Map(COLUMN_DEFS.map((c) => [c.key, c]))

export const ALL_COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: 'project_name', label: 'Project Name' },
  { key: 'client', label: 'Client' },
  { key: 'state', label: 'State' },
  { key: 'site', label: 'Site' },
  { key: 'status', label: 'Status' },
  { key: 'contract_sum', label: 'Contract Sum' },
  { key: 'award_date', label: 'Award Date' },
  { key: 'award_letter', label: 'Award Letter' },
  { key: 'substantial_cert', label: 'Substantial Cert' },
  { key: 'substantial_date', label: 'Substantial Date' },
  { key: 'final_cert', label: 'Final Cert' },
  { key: 'final_date', label: 'Final Date' },
  { key: 'maintenance_cert', label: 'Maintenance Cert' },
  { key: 'maintenance_date', label: 'Maintenance Date' },
  { key: 'retention_date', label: 'Retention Application' },
  { key: 'retention_paid', label: 'Paid (Yes/No)' },
  { key: 'amount_paid', label: 'Amount Paid' },
  { key: 'source_sheet', label: 'Source Sheet' },
]

export const DEFAULT_VISIBLE_COLUMNS: ColumnKey[] = [
  'project_name',
  'client',
  'state',
  'status',
  'contract_sum',
  'award_date',
]

// ── Component ─────────────────────────────────────────────────────────────

interface ProjectsTableProps {
  projects: Project[]
  isLoading: boolean
  onPrefetch?: (id: string) => void
  visibleColumns: ColumnKey[]
  onVisibleColumnsChange: (columns: ColumnKey[]) => void
  resultText?: string
}

export function ProjectsTable({
  projects,
  isLoading,
  onPrefetch,
  visibleColumns,
  onVisibleColumnsChange,
  resultText,
}: ProjectsTableProps) {
  const router = useRouter()

  const columns = visibleColumns
    .map((key) => COLUMN_MAP.get(key))
    .filter((c): c is ColumnDef => c !== undefined)

  const toggleColumn = (key: ColumnKey) => {
    if (key === 'project_name') return
    const next = visibleColumns.includes(key)
      ? visibleColumns.filter((c) => c !== key)
      : [...visibleColumns, key]
    onVisibleColumnsChange(next)
  }

  const columnsCustomized = visibleColumns.length !== DEFAULT_VISIBLE_COLUMNS.length ||
    visibleColumns.some((c) => !DEFAULT_VISIBLE_COLUMNS.includes(c))

  return (
    <div className="space-y-0">
      {/* Toolbar */}
      <div className="flex items-center justify-between py-2">
        <p className="text-sm text-muted-foreground">{resultText}</p>
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
                disabled={col.key === 'project_name'}
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
      </div>

      {/* Table */}
      {isLoading ? (
        <ProjectsTableSkeleton columns={columns} />
      ) : projects.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-lg">
          <FolderKanban className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg">No projects found</p>
          <p className="text-sm mt-1">Try adjusting your filters or search term</p>
        </div>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((col) => (
                    <TableHead
                      key={col.key}
                      className={`${col.width || ''} ${col.align === 'right' ? 'text-right' : ''}`}
                    >
                      {col.header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((project) => (
                  <TableRow
                    key={project.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => router.push(`/projects/${project.id}`)}
                    onMouseEnter={() => onPrefetch?.(project.id)}
                  >
                    {columns.map((col) => (
                      <TableCell
                        key={col.key}
                        className={col.align === 'right' ? 'text-right' : ''}
                      >
                        {col.render(project)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}

function ProjectsTableSkeleton({ columns }: { columns: ColumnDef[] }) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.key} className={col.width || ''}>
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...Array(8)].map((_, i) => (
            <TableRow key={i}>
              {columns.map((col) => (
                <TableCell key={col.key}>
                  <Skeleton className={`h-5 ${col.skeleton || 'w-full'}`} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
