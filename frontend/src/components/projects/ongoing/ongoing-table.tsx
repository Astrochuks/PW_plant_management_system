'use client'

/**
 * Ongoing-projects register table — the Plant Register's table, for
 * projects: brand banner, gold header row, Columns picker, Export.
 *
 * Export writes exactly what is on screen: the rows the page filtered,
 * the columns that are visible, in that order (UI standard §3).
 * Money figures are the stored figures — nothing is rounded here.
 */

import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { ChevronDown, Columns3, Download, FolderKanban } from 'lucide-react'
import { toast } from 'sonner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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
import type { OngoingProject } from '@/lib/api/projects'
import { STATUS_STYLES } from '@/components/projects/projects-table'
import { type Figures, marginOf } from '@/components/projects/ongoing/lens'
import { fmtDate, money } from '@/lib/format'

export interface OngoingRow {
  project: OngoingProject
  /** sum of every week on file for this project */
  figures: Figures
}

// ── Columns ──────────────────────────────────────────────────────────────

export type OngoingColumnKey =
  | 'project_name'
  | 'client'
  | 'state'
  | 'status'
  | 'project_type'
  | 'contract_sum'
  | 'status_since'
  | 'last_report'
  | 'weeks_on_file'
  | 'work_done'
  | 'cost'
  | 'net_earnings'
  | 'margin'

interface ColumnDef {
  key: OngoingColumnKey
  header: string
  width?: string
  align?: 'left' | 'right'
  render: (row: OngoingRow) => React.ReactNode
  /** value written to the export cell */
  cell: (row: OngoingRow) => string | number | null
  numFmt?: string
  exportWidth: number
  skeleton?: string
}

const dash = <span className="text-muted-foreground">—</span>

const COLUMN_DEFS: ColumnDef[] = [
  {
    key: 'project_name',
    header: 'Project Name',
    render: ({ project: p }) => (
      <div className="max-w-[320px]">
        <span className="font-medium line-clamp-1">{p.project_name}</span>
        {p.short_name && <div className="text-xs text-muted-foreground">{p.short_name}</div>}
      </div>
    ),
    cell: ({ project: p }) => p.project_name,
    exportWidth: 60,
    skeleton: 'w-full max-w-[300px]',
  },
  {
    key: 'client',
    header: 'Client',
    width: 'w-[180px]',
    render: ({ project: p }) => <span className="text-sm">{p.client}</span>,
    cell: ({ project: p }) => p.client,
    exportWidth: 34,
    skeleton: 'w-24',
  },
  {
    key: 'state',
    header: 'State',
    width: 'w-[120px]',
    render: ({ project: p }) => <span className="text-sm">{p.state_name || dash}</span>,
    cell: ({ project: p }) => p.state_name ?? '',
    exportWidth: 14,
    skeleton: 'w-20',
  },
  {
    key: 'status',
    header: 'Status',
    width: 'w-[150px]',
    render: ({ project: p, figures }) => {
      if (figures.weeks === 0) {
        return <Badge variant="outline" className="text-muted-foreground">Awaiting first report</Badge>
      }
      const style = STATUS_STYLES[p.status] || STATUS_STYLES.active
      return <Badge variant={style.variant} className={style.className}>{style.label}</Badge>
    },
    cell: ({ project: p, figures }) =>
      figures.weeks === 0 ? 'Awaiting first report' : (STATUS_STYLES[p.status]?.label ?? p.status),
    exportWidth: 22,
    skeleton: 'w-16',
  },
  {
    key: 'project_type',
    header: 'Type',
    width: 'w-[110px]',
    render: ({ project: p }) =>
      p.project_type
        ? <Badge variant="outline" className="w-fit text-[10px] capitalize">{p.project_type}</Badge>
        : dash,
    cell: ({ project: p }) => p.project_type ?? '',
    exportWidth: 12,
    skeleton: 'w-16',
  },
  {
    key: 'contract_sum',
    header: 'Contract Sum',
    width: 'w-[190px]',
    align: 'right',
    render: ({ project: p }) => (
      <span className="font-medium tabular-nums">{p.contract_sum != null ? money(p.contract_sum) : dash}</span>
    ),
    cell: ({ project: p }) => p.contract_sum,
    numFmt: '#,##0.00',
    exportWidth: 22,
    skeleton: 'w-28 ml-auto',
  },
  {
    key: 'status_since',
    header: 'Since',
    width: 'w-[110px]',
    render: ({ project: p }) => <span className="text-sm tabular-nums">{fmtDate(p.status_since)}</span>,
    cell: ({ project: p }) => p.status_since,
    exportWidth: 12,
    skeleton: 'w-20',
  },
  {
    key: 'last_report',
    header: 'Last Report',
    width: 'w-[110px]',
    render: ({ figures }) => (
      <span className="text-sm tabular-nums">{figures.last_week_ending ? fmtDate(figures.last_week_ending) : dash}</span>
    ),
    cell: ({ figures }) => figures.last_week_ending ?? '',
    exportWidth: 12,
    skeleton: 'w-20',
  },
  {
    key: 'weeks_on_file',
    header: 'Weeks',
    width: 'w-[80px]',
    align: 'right',
    render: ({ figures }) => <span className="text-sm tabular-nums">{figures.weeks}</span>,
    cell: ({ figures }) => figures.weeks,
    exportWidth: 8,
    skeleton: 'w-8 ml-auto',
  },
  {
    key: 'work_done',
    header: 'Work Done incl. VAT',
    width: 'w-[190px]',
    align: 'right',
    render: ({ figures }) => <span className="text-sm tabular-nums">{figures.weeks ? money(figures.works_incl_vat) : dash}</span>,
    cell: ({ figures }) => (figures.weeks ? figures.works_incl_vat : null),
    numFmt: '#,##0.00',
    exportWidth: 24,
    skeleton: 'w-28 ml-auto',
  },
  {
    key: 'cost',
    header: 'Cost',
    width: 'w-[170px]',
    align: 'right',
    render: ({ figures }) => <span className="text-sm tabular-nums">{figures.weeks ? money(figures.cost) : dash}</span>,
    cell: ({ figures }) => (figures.weeks ? figures.cost : null),
    numFmt: '#,##0.00',
    exportWidth: 22,
    skeleton: 'w-28 ml-auto',
  },
  {
    key: 'net_earnings',
    header: 'Net Earnings',
    width: 'w-[180px]',
    align: 'right',
    render: ({ figures }) => (
      <span className={`text-sm font-medium tabular-nums ${figures.weeks && figures.net < 0 ? 'text-red-600' : ''}`}>
        {figures.weeks ? money(figures.net) : dash}
      </span>
    ),
    cell: ({ figures }) => (figures.weeks ? figures.net : null),
    numFmt: '#,##0.00',
    exportWidth: 22,
    skeleton: 'w-28 ml-auto',
  },
  {
    key: 'margin',
    header: 'Margin',
    width: 'w-[90px]',
    align: 'right',
    render: ({ figures }) => {
      const m = marginOf(figures)
      return <span className="text-sm tabular-nums">{m == null ? dash : `${(m * 100).toFixed(2)}%`}</span>
    },
    cell: ({ figures }) => marginOf(figures),
    numFmt: '0.00%',
    exportWidth: 10,
    skeleton: 'w-12 ml-auto',
  },
]

const COLUMN_MAP = new Map(COLUMN_DEFS.map((c) => [c.key, c]))

export const ONGOING_COLUMNS: { key: OngoingColumnKey; label: string }[] =
  COLUMN_DEFS.map((c) => ({ key: c.key, label: c.header }))

export const DEFAULT_ONGOING_COLUMNS: OngoingColumnKey[] = [
  'project_name',
  'client',
  'state',
  'status',
  'contract_sum',
  'net_earnings',
  'last_report',
]

// ── Export ───────────────────────────────────────────────────────────────

/** Writes the filtered rows with the visible columns, in order, to .xlsx */
export async function exportOngoingRows(
  rows: OngoingRow[],
  columns: ColumnDef[],
  filterLine: string,
): Promise<void> {
  const { Workbook } = await import('exceljs')
  const wb = new Workbook()
  const ws = wb.addWorksheet('Ongoing projects')
  ws.addRow(['P.W. NIGERIA LTD. — PROJECT REGISTER']).font = { bold: true, size: 13 }
  ws.addRow([filterLine])
  ws.addRow([])
  const headerRow = ws.addRow(['S/NO', ...columns.map((c) => c.header.toUpperCase())])
  headerRow.font = { bold: true }
  rows.forEach((r, i) => ws.addRow([i + 1, ...columns.map((c) => c.cell(r))]))
  // totals over the money columns actually exported
  const totals = columns.map((c) =>
    c.numFmt === '#,##0.00' ? rows.reduce((a, r) => a + Number(c.cell(r) ?? 0), 0) : null)
  if (totals.some((t) => t != null)) {
    const totalRow = ws.addRow(['', 'TOTAL', ...totals.slice(1)])
    totalRow.font = { bold: true }
  }
  ws.getColumn(1).width = 6
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 2)
    col.width = c.exportWidth
    if (c.numFmt) col.numFmt = c.numFmt
  })
  const buf = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
  const a = document.createElement('a')
  a.href = url
  a.download = `ongoing-projects-${new Date().toISOString().slice(0, 10)}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Component ────────────────────────────────────────────────────────────

interface OngoingTableProps {
  rows: OngoingRow[]
  isLoading: boolean
  visibleColumns: OngoingColumnKey[]
  onVisibleColumnsChange: (columns: OngoingColumnKey[]) => void
  resultText?: string
  /** one line describing the active filters, written into the export */
  filterLine: string
  actions?: React.ReactNode
}

export function OngoingTable({
  rows,
  isLoading,
  visibleColumns,
  onVisibleColumnsChange,
  resultText,
  filterLine,
  actions,
}: OngoingTableProps) {
  const router = useRouter()
  const [exporting, setExporting] = useState(false)

  const columns = visibleColumns
    .map((key) => COLUMN_MAP.get(key))
    .filter((c): c is ColumnDef => c !== undefined)

  const toggleColumn = (key: OngoingColumnKey) => {
    if (key === 'project_name') return
    const next = visibleColumns.includes(key)
      ? visibleColumns.filter((c) => c !== key)
      : [...visibleColumns, key]
    onVisibleColumnsChange(next)
  }

  const columnsCustomized = visibleColumns.length !== DEFAULT_ONGOING_COLUMNS.length ||
    visibleColumns.some((c) => !DEFAULT_ONGOING_COLUMNS.includes(c))

  const handleExport = async () => {
    setExporting(true)
    try {
      await exportOngoingRows(rows, columns, filterLine)
      toast.success('Export downloaded')
    } catch (err) {
      console.error('[ongoing-table] export failed', err)
      toast.error('Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-0">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 py-2">
        <p className="text-sm text-muted-foreground">{resultText}</p>
        <div className="flex flex-wrap items-center gap-2">
          {actions}

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
              {ONGOING_COLUMNS.map((col) => (
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
                onCheckedChange={() => onVisibleColumnsChange(DEFAULT_ONGOING_COLUMNS)}
              >
                Reset to defaults
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || isLoading || rows.length === 0}>
            <Download className="h-3.5 w-3.5 mr-1.5" />
            {exporting ? 'Exporting...' : 'Export'}
          </Button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <OngoingTableSkeleton columns={columns} />
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-lg">
          <FolderKanban className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg">No projects found</p>
          <p className="text-sm mt-1">Try adjusting your filters or search term</p>
        </div>
      ) : (
        <div className="rounded-lg border-2 border-border overflow-x-auto">
          <BrandBanner />
          <Table className="border-collapse">
            <TableHeader>
              <TableRow className="bg-[#ffbf36] hover:bg-[#ffbf36] border-b-2 border-[#e6ac31]">
                {columns.map((col) => (
                  <TableHead
                    key={col.key}
                    className={`text-[#101415] font-semibold text-xs uppercase tracking-wider border-x border-[#e6ac31]/50 whitespace-nowrap ${col.width || ''} ${col.align === 'right' ? 'text-right' : ''}`}
                  >
                    {col.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, idx) => (
                <TableRow
                  key={row.project.id}
                  className={`cursor-pointer ${idx % 2 === 0 ? 'bg-background' : 'bg-muted/30'} hover:bg-muted/60 border-b border-border`}
                  onClick={() => router.push(`/projects/${row.project.id}`)}
                >
                  {columns.map((col) => (
                    <TableCell
                      key={col.key}
                      className={`text-sm border-x border-border/50 ${col.align === 'right' ? 'text-right' : ''}`}
                    >
                      {col.render(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function BrandBanner() {
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-background border-b-2 border-border">
      <Image src="/images/logo.png" alt="P.W. Nigeria Ltd." width={55} height={55} className="rounded" />
      <span className="text-foreground font-bold text-base tracking-wide">
        P.W. NIGERIA LTD. — Project Register
      </span>
    </div>
  )
}

function OngoingTableSkeleton({ columns }: { columns: ColumnDef[] }) {
  return (
    <div className="rounded-lg border-2 border-border overflow-x-auto">
      <BrandBanner />
      <Table className="border-collapse">
        <TableHeader>
          <TableRow className="bg-[#ffbf36] hover:bg-[#ffbf36] border-b-2 border-[#e6ac31]">
            {columns.map((col) => (
              <TableHead
                key={col.key}
                className={`text-[#101415] font-semibold text-xs uppercase tracking-wider border-x border-[#e6ac31]/50 whitespace-nowrap ${col.width || ''} ${col.align === 'right' ? 'text-right' : ''}`}
              >
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...Array(6)].map((_, i) => (
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
