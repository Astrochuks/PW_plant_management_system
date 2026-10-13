'use client'

/**
 * Ongoing-projects register table — the Plant Register's table, for
 * projects: brand banner, gold header row, Columns picker, Export.
 *
 * Export writes exactly what is on screen: the rows the page filtered,
 * the columns that are visible, in that order (UI standard §3).
 * Money figures are the stored figures — nothing is rounded here.
 *
 * Four columns by decision of 2026-10-12: Project Name, Client, State,
 * Contract Sum. No Status column — everything here is ongoing by
 * definition; the dated status history lives in project_status_events.
 * More columns come back only when asked for.
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
import { projectPath, type OngoingProject } from '@/lib/api/projects'
import { money, titleCase } from '@/lib/format'
import { exportRegisterExcel } from '@/lib/register-export'

export interface OngoingRow {
  project: OngoingProject
}

// ── Columns ──────────────────────────────────────────────────────────────

export type OngoingColumnKey = 'project_name' | 'client' | 'state' | 'contract_sum'

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
    // the full name, wrapped — never clipped; the column takes the width the
    // others leave, and keeps a floor so it never collapses on narrow screens
    render: ({ project: p }) => (
      <div className="min-w-[260px] whitespace-normal break-words">
        <span className="font-medium leading-snug">{titleCase(p.project_name)}</span>
        {p.short_name && <div className="mt-0.5 text-xs text-muted-foreground">{titleCase(p.short_name)}</div>}
      </div>
    ),
    cell: ({ project: p }) => titleCase(p.project_name),
    exportWidth: 70,
    skeleton: 'w-full max-w-[400px]',
  },
  {
    key: 'client',
    header: 'Client',
    width: 'w-[30%]',
    render: ({ project: p }) => <div className="min-w-[200px] whitespace-normal break-words text-sm">{titleCase(p.client)}</div>,
    cell: ({ project: p }) => titleCase(p.client),
    exportWidth: 40,
    skeleton: 'w-40',
  },
  {
    key: 'state',
    header: 'State',
    width: 'w-[130px]',
    render: ({ project: p }) => <span className="text-sm">{p.state_name || dash}</span>,
    cell: ({ project: p }) => p.state_name ?? '',
    exportWidth: 14,
    skeleton: 'w-20',
  },
  {
    key: 'contract_sum',
    header: 'Contract Sum',
    width: 'w-[200px]',
    align: 'right',
    render: ({ project: p }) => (
      <span className="font-medium tabular-nums whitespace-nowrap">{p.contract_sum != null ? money(p.contract_sum) : dash}</span>
    ),
    cell: ({ project: p }) => p.contract_sum,
    numFmt: '#,##0.00',
    exportWidth: 22,
    skeleton: 'w-28 ml-auto',
  },
]

const COLUMN_MAP = new Map(COLUMN_DEFS.map((c) => [c.key, c]))

export const ONGOING_COLUMNS: { key: OngoingColumnKey; label: string }[] =
  COLUMN_DEFS.map((c) => ({ key: c.key, label: c.header }))

export const DEFAULT_ONGOING_COLUMNS: OngoingColumnKey[] = ['project_name', 'client', 'state', 'contract_sum']

// ── Export ───────────────────────────────────────────────────────────────

/** Writes the filtered rows with the visible columns, in order, in the
 *  shared register layout (lib/register-export.ts). Title = the banner. */
export async function exportOngoingRows(rows: OngoingRow[], columns: ColumnDef[], title: string): Promise<string> {
  const totals = columns.map((c) =>
    c.numFmt === '#,##0.00' ? rows.reduce((a, r) => a + Number(c.cell(r) ?? 0), 0) : null)
  return exportRegisterExcel({
    title,
    sheetName: 'Ongoing projects',
    columns: columns.map((c) => ({ header: c.header, width: c.exportWidth, numFmt: c.numFmt })),
    rows: rows.map((r) => columns.map((c) => c.cell(r))),
    totals,
  })
}

// ── Component ────────────────────────────────────────────────────────────

interface OngoingTableProps {
  rows: OngoingRow[]
  isLoading: boolean
  visibleColumns: OngoingColumnKey[]
  onVisibleColumnsChange: (columns: OngoingColumnKey[]) => void
  /** what the table holds, e.g. "for all states" / "in Kaduna" — the banner and the export title say it */
  scope: string
  actions?: React.ReactNode
}

export function OngoingTable({
  rows,
  isLoading,
  visibleColumns,
  onVisibleColumnsChange,
  scope,
  actions,
}: OngoingTableProps) {
  const router = useRouter()
  const [exporting, setExporting] = useState(false)
  const bannerTitle = `P.W. NIGERIA LTD. — Ongoing Projects ${scope}`.trim()

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
      await exportOngoingRows(rows, columns, bannerTitle)
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
      {/* Toolbar — actions only; the banner already says what the table holds */}
      <div className="flex flex-wrap items-center justify-end gap-2 py-2">
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
        <OngoingTableSkeleton columns={columns} title={bannerTitle} />
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-lg">
          <FolderKanban className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg">No projects found</p>
          <p className="text-sm mt-1">Try adjusting your filters or search term</p>
        </div>
      ) : (
        <div className="rounded-lg border-2 border-border overflow-x-auto">
          <BrandBanner title={bannerTitle} />
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
                  onClick={() => router.push(projectPath(row.project))}
                >
                  {columns.map((col) => (
                    <TableCell
                      key={col.key}
                      className={`text-sm border-x border-border/50 align-top py-3 ${col.align === 'right' ? 'text-right' : ''}`}
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

function BrandBanner({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-background border-b-2 border-border">
      <Image src="/images/logo.png" alt="P.W. Nigeria Ltd." width={55} height={55} className="rounded shrink-0" />
      <span className="text-foreground font-bold text-base tracking-wide">{title}</span>
    </div>
  )
}

function OngoingTableSkeleton({ columns, title }: { columns: ColumnDef[]; title: string }) {
  return (
    <div className="rounded-lg border-2 border-border overflow-x-auto">
      <BrandBanner title={title} />
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
