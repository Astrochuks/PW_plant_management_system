'use client'

/**
 * Overview — the project's dashboard, kept basic (decision 2026-10-13):
 * three cards, progress by bill, the register facts. Nothing from the
 * parked sheets. Work done is the sum of the weeks on file — never the
 * workbook's own "to date". Three API calls, all cached by the hub.
 */

import Image from 'next/image'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MiniKpi, MiniKpiRow, MiniKpiSkeleton } from '@/components/shared/mini-kpi'
import { useAuth } from '@/providers/auth-provider'
import { useBillsProgress, useProject, useProjectBills } from '@/hooks/use-projects'
import { fmtDate, money } from '@/lib/format'

const HEAD = 'text-[#101415] font-semibold text-xs uppercase tracking-wider border-x border-[#e6ac31]/50 whitespace-nowrap'
const CELL = 'text-sm border-x border-border/50 py-2'
const dash = <span className="text-muted-foreground">—</span>
const pctOf = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(2)}%` : null)

export default function ProjectOverviewPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { data: project, isLoading: loadingProject } = useProject(id)
  const { data: bills, isLoading: loadingBills } = useProjectBills(id)
  const { data: progress, isLoading: loadingProgress } = useBillsProgress(id)
  const isLoading = loadingProject || loadingBills || loadingProgress

  const revision = bills?.revision ?? null
  const worksTotal = bills?.summary?.works_total ?? 0
  const rows = progress?.bills ?? []
  const toDate = rows.reduce((a, b) => a + b.to_date, 0)
  const thisWeek = rows.reduce((a, b) => a + b.this_week, 0)
  const latest = progress?.latest_week ?? null
  const weeks = progress?.weeks_on_file ?? 0
  const name = project?.short_name || project?.project_name || ''

  return (
    <div className="space-y-6">
      {/* Three cards */}
      <MiniKpiRow>
        {isLoading ? <MiniKpiSkeleton count={3} /> : (
          <>
            <MiniKpi label="Contract sum" value={project?.current_contract_sum != null ? money(project.current_contract_sum) : '—'} />
            <MiniKpi
              label="Work done to date"
              value={weeks ? money(toDate) : '—'}
              sub={!revision ? 'no bill of quantities yet' : !weeks ? 'no week on file yet' : (pctOf(toDate, worksTotal) ? `${pctOf(toDate, worksTotal)} of the works total` : undefined)}
            />
            <MiniKpi
              label="Last report"
              value={latest ? `W${String(latest.week_number).padStart(2, '0')}` : '—'}
              sub={latest?.week_ending_date ? `${fmtDate(latest.week_ending_date)} · ${weeks} week${weeks !== 1 ? 's' : ''} on file` : undefined}
            />
          </>
        )}
      </MiniKpiRow>

      {/* Progress by bill — the BEME read the way site and head office read it */}
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : !revision ? (
        <div className="text-center py-12 text-muted-foreground border rounded-lg">
          <p className="text-lg">No bill of quantities yet</p>
          <p className="text-sm mt-1">Progress is measured against the bill. {isAdmin ? 'Enter or import it on the Bill of Quantities tab.' : 'The admin has not recorded it yet.'}</p>
          {isAdmin && <Button className="mt-4" size="sm" asChild><Link href={`/projects/${id}/bills`}>Open Bill of Quantities</Link></Button>}
        </div>
      ) : (
        <div className="rounded-lg border-2 border-border overflow-x-auto">
          <div className="flex items-center gap-3 px-4 py-2 bg-background border-b-2 border-border">
            <Image src="/images/logo.png" alt="P.W. Nigeria Ltd." width={55} height={55} className="rounded shrink-0" />
            <span className="text-foreground font-bold text-base tracking-wide">P.W. NIGERIA LTD. — Progress by bill · {name}</span>
          </div>
          <Table className="border-collapse">
            <TableHeader>
              <TableRow className="bg-[#ffbf36] hover:bg-[#ffbf36] border-b-2 border-[#e6ac31]">
                <TableHead className={`${HEAD} w-[90px]`}>Bill</TableHead>
                <TableHead className={HEAD}>Description</TableHead>
                <TableHead className={`${HEAD} w-[200px] text-right`}>Bill amount</TableHead>
                <TableHead className={`${HEAD} w-[180px] text-right`}>This week</TableHead>
                <TableHead className={`${HEAD} w-[200px] text-right`}>To date</TableHead>
                <TableHead className={`${HEAD} w-[100px] text-right`}>% done</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b, idx) => (
                <TableRow key={b.bill_code} className={`${idx % 2 === 0 ? 'bg-background' : 'bg-muted/30'} hover:bg-muted/60 border-b border-border`}>
                  <TableCell className={`${CELL} tabular-nums whitespace-nowrap`}>{b.bill_code}</TableCell>
                  <TableCell className={`${CELL} whitespace-normal`}>{b.name || dash}</TableCell>
                  <TableCell className={`${CELL} text-right tabular-nums whitespace-nowrap`}>{money(b.amount)}</TableCell>
                  <TableCell className={`${CELL} text-right tabular-nums whitespace-nowrap`}>{weeks ? money(b.this_week) : dash}</TableCell>
                  <TableCell className={`${CELL} text-right tabular-nums whitespace-nowrap`}>{weeks ? money(b.to_date) : dash}</TableCell>
                  <TableCell className={`${CELL} text-right tabular-nums whitespace-nowrap`}>{weeks ? (pctOf(b.to_date, b.amount) ?? dash) : dash}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-background hover:bg-background border-t-2 border-border">
                <TableCell colSpan={2} className={`${CELL} font-bold uppercase tracking-wide`}>Works total</TableCell>
                <TableCell className={`${CELL} text-right font-bold tabular-nums whitespace-nowrap`}>{money(worksTotal)}</TableCell>
                <TableCell className={`${CELL} text-right font-bold tabular-nums whitespace-nowrap`}>{weeks ? money(thisWeek) : dash}</TableCell>
                <TableCell className={`${CELL} text-right font-bold tabular-nums whitespace-nowrap`}>{weeks ? money(toDate) : dash}</TableCell>
                <TableCell className={`${CELL} text-right font-bold tabular-nums whitespace-nowrap`}>{weeks ? (pctOf(toDate, worksTotal) ?? dash) : dash}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      {/* The register facts, in one block */}
      {project && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border p-4 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Fact label="Client" value={project.client} />
          <Fact label="State" value={project.state_name ?? '—'} />
          <Fact label="Type" value={project.project_type ? project.project_type.charAt(0).toUpperCase() + project.project_type.slice(1) : '—'} />
          <Fact label="Award date" value={project.award_date ? fmtDate(project.award_date) : '—'} />
          <Fact label="Commencement" value={project.commencement_date ? fmtDate(project.commencement_date) : '—'} />
          <Fact label="Expected completion" value={project.revised_completion_date ? fmtDate(project.revised_completion_date) : project.original_completion_date ? fmtDate(project.original_completion_date) : '—'} />
          <Fact label="Bill in force" value={revision ? `Revision ${revision.revision_no} · effective ${fmtDate(revision.effective_date)}` : 'none yet'} />
          <Fact label="Contract figure per bill" value={bills?.summary ? money(bills.summary.contract_total) : '—'} />
        </dl>
      )}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words font-medium">{value}</dd>
    </div>
  )
}
