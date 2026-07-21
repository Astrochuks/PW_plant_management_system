'use client'

/**
 * Overview — the PROJECT KPI DASHBOARD. Mirrors the company's Excel
 * dashboard block-for-block; every figure computed from ledgers and
 * atomic weekly facts (docs/WORKBOOK_ARITHMETIC.md). Tables in ₦m
 * (the workbook's unit); cards show full figures. Data-quality alerts
 * live on the admin Issues tab, not here.
 *
 * Color system: PW amber (#f59e0b) is THE accent — progress, this-week
 * emphasis, totals. Cost categories carry a FIXED per-name palette
 * (never index-cycled) shared by the donut and its table dots.
 */

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import ECharts from 'echarts-for-react'
import { toast } from 'sonner'
import { Banknote, Edit2, HardHat, Percent, TrendingUp, Wallet } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/providers/auth-provider'
import {
  projectsKeys, useProjectOverview, useUpdateProject,
} from '@/hooks/use-projects'
import type { CreateProjectRequest, ProjectOverview } from '@/lib/api/projects'
import { fmtDate, naira, nairaM, num, pctFmt, weekLabel } from '@/lib/format'

export default function ProjectOverviewPage() {
  const params = useParams<{ id: string }>()
  const { data: o, isLoading } = useProjectOverview(params.id)

  if (isLoading || !o) return <OverviewSkeleton />
  if (!o.latest_week) return <NoReportsYet />

  return (
    <div className="space-y-4">
      {/* Week banner */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <p className="text-sm">
          <span className="text-muted-foreground">Week No:</span>{' '}
          <b className="tabular-nums">{o.latest_week.week_number}</b>
          <span className="mx-2 text-muted-foreground">·</span>
          <span className="text-muted-foreground">Report Date:</span>{' '}
          <b className="tabular-nums">{fmtDate(o.latest_week.week_ending_date)}</b>
        </p>
      </div>

      <ContractCard o={o} />

      {/* Headline strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <Kpi label="Contract Value" value={naira(o.headline.contract_sum, true)}
          sub={naira(o.headline.contract_sum)} lineage="register" />
        <Kpi label="Total BEME (Incl. VAT)" value={naira(o.physical.ladder.works_incl_vat.beme, true)}
          sub={naira(o.physical.ladder.works_incl_vat.beme)}
          lineage="BEME sub-total × 1.075 · excl contingency" />
        <Kpi label="Work Done to Date (Incl. VAT)" value={naira(o.physical.ladder.works_incl_vat.to_date, true)}
          sub={naira(o.physical.ladder.works_incl_vat.to_date)}
          lineage="works × 1.075 · previous + stored weeks" />
        <Kpi label="Overall % Complete" value={pctFmt(o.headline.pct_complete)}
          sub={o.progress.reported_pct != null
            ? `workbook reports ${pctFmt(o.progress.reported_pct)}`
            : `${naira(o.physical.ladder.works.to_date, true)} of ${naira(o.physical.ladder.works.beme, true)}`}
          lineage="work done ÷ Total BEME" />
        <Kpi label="Certified to Date"
          value={o.certs_payments.certificates_total ? naira(o.headline.certified_to_date, true) : 'None yet'}
          sub={o.certs_payments.certificates_total ? naira(o.headline.certified_to_date) : 'no certificates recorded'}
          lineage="cert ledger cumulative" />
        <Kpi label="Paid – Gross"
          value={o.certs_payments.payments_count ? naira(o.headline.paid_gross, true) : 'None yet'}
          sub={o.certs_payments.payments_count ? naira(o.headline.paid_gross) : 'no payments recorded'}
          lineage="payments ledger" />
        <Kpi label="Cost to Date" value={naira(o.headline.cost_to_date, true)}
          sub={naira(o.headline.cost_to_date)} lineage="previous + stored weeks" />
        <Kpi label="Net Margin %" value={pctFmt(o.headline.net_margin_pct)}
          sub={`net ${naira(o.cost_profitability.net_to_date, true)} to date`}
          lineage="net ÷ work done incl VAT"
          tone={o.headline.net_margin_pct != null && o.headline.net_margin_pct < 0 ? 'bad' : 'good'} />
      </div>

      <ThisWeekCard o={o} />
      <PhysicalProgressCard o={o} />

      <div className="grid gap-3 lg:grid-cols-3">
        <CertsPaymentsCard o={o} />
        <ResourcesCard o={o} />
      </div>

      <CostProfitabilityCard o={o} />
    </div>
  )
}

/* ── Contract details & schedule — the workbook's own blocks ────────── */

function ContractCard({ o }: { o: ProjectOverview }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const s = o.schedule
  const overdue = s.status === 'overdue'
  const pct = o.headline.pct_complete ?? 0
  const [editOpen, setEditOpen] = useState(false)

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-3">
          <CardTitle className="text-sm">Contract details &amp; schedule</CardTitle>
          {s.status && (
            <Badge className={overdue
              ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'}>
              {overdue ? 'OVERDUE' : 'ON TRACK'}
            </Badge>
          )}
        </div>
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Edit2 className="mr-2 h-3.5 w-3.5" />
            Edit details
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Overall progress */}
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Overall % Complete
            </p>
            <p className="text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
              {pctFmt(o.headline.pct_complete)}
            </p>
          </div>
          <div className="relative h-3.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all"
              style={{ width: `${Math.min(100, pct * 100)}%` }}
            />
            <div
              className="absolute top-0 h-full w-0.5 bg-background/80"
              style={{ left: `calc(${Math.min(100, pct * 100)}% - 1px)` }}
            />
          </div>
          <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
            Work done {naira(o.physical.ladder.works_incl_vat.to_date, true)} of
            Total BEME {naira(o.physical.ladder.works_incl_vat.beme, true)} (Incl. VAT)
          </p>
        </div>

        <div className="grid gap-x-10 gap-y-5 lg:grid-cols-2">
          {/* CONTRACT DETAILS — workbook block */}
          <div>
            <p className="mb-2 border-b pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Contract details
            </p>
            <div className="space-y-2 text-sm">
              <KvBlock label="Client:" value={s.client ?? '—'} />
              <KvBlock label="Name of Contract:" value={o.project.project_name} />
              <KvBlock label="Short Name:" value={o.project.short_name ?? '—'} />
              <KvRow label="Original Contract Amount:" value={naira(o.project.original_contract_sum)} />
              <KvRow label="Current Contract Amount:" value={naira(o.project.current_contract_sum)}
                extra={<Badge variant="outline" className="ml-2 text-[10px]">RETC: {o.project.retc == null ? '—' : o.project.retc ? 'Yes' : 'No'}</Badge>} />
            </div>
          </div>

          {/* CONTRACT SCHEDULES — workbook block */}
          <div>
            <p className="mb-2 border-b pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Contract schedules
            </p>
            <div className="grid gap-x-8 sm:grid-cols-2">
              <div className="space-y-2 text-sm">
                <KvRow label="Date of Contract Award:" value={fmtDate(s.award_date)} />
                <KvRow label="Contract Commencement Date:" value={fmtDate(s.commencement_date)} />
                <KvRow label="Original Contract Duration (Months):"
                  value={s.original_duration_months != null ? num(s.original_duration_months, 0) : '—'} />
                <KvRow label="Original Contract Completion Date:" value={fmtDate(s.original_completion_date)} />
                <KvRow label="Extension of Time Requested (Months):"
                  value={s.eot_requested_months != null ? num(s.eot_requested_months, 0) : '0'} />
                <KvRow label="Extension of Time Granted (Months):"
                  value={s.eot_granted_months != null ? num(s.eot_granted_months, 0) : '0'} />
                <KvRow label="Revised Contract Duration (Months):"
                  value={s.revised_duration_months != null ? num(s.revised_duration_months, 0) : '—'} />
                <KvRow label="Revised Completion Date:" value={fmtDate(s.revised_completion_date)} />
              </div>
              <div className="mt-2 space-y-2 text-sm sm:mt-0">
                <KvRow label="Works Actually Commenced on Site:" value={fmtDate(s.works_commenced_date)} />
                <KvRow label="Duration Already on Site:"
                  value={`${(s.duration_on_site_months ?? 0).toFixed(1)} Mths`} />
                <KvRow label="Overdue to Original Completion Date:"
                  value={s.overdue_original_months != null && s.overdue_original_months > 0
                    ? `${num(s.overdue_original_months, 1)} Mths` : '—'}
                  bad={s.overdue_original_months != null && s.overdue_original_months > 0} />
                <KvRow label="Overdue to Revised Completion Date:"
                  value={s.overdue_revised_months != null && s.overdue_revised_months > 0
                    ? `${num(s.overdue_revised_months, 1)} Mths` : '—'}
                  bad={s.overdue_revised_months != null && s.overdue_revised_months > 0} />
              </div>
            </div>
          </div>
        </div>
      </CardContent>
      {isAdmin && (
        <EditContractDialog o={o} open={editOpen} onOpenChange={setEditOpen} />
      )}
    </Card>
  )
}

function KvRow({ label, value, extra, bad }: {
  label: string; value: string; extra?: React.ReactNode; bad?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dashed pb-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={`shrink-0 text-right font-medium tabular-nums ${bad ? 'font-semibold text-red-600' : ''}`}>
        {value}{extra}
      </span>
    </div>
  )
}

function KvBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-dashed pb-1">
      <span className="text-muted-foreground">{label}</span>{' '}
      <span className="font-medium">{value}</span>
    </div>
  )
}

/* Edit dialog — writes through the existing PATCH /projects/{id} */

function EditContractDialog({ o, open, onOpenChange }: {
  o: ProjectOverview; open: boolean; onOpenChange: (v: boolean) => void
}) {
  const s = o.schedule
  const update = useUpdateProject(o.project.id)
  const qc = useQueryClient()
  const [f, setF] = useState<Record<string, string>>({})

  // seed the form each time the dialog opens
  const seed = (): Record<string, string> => ({
    client: s.client ?? '',
    project_name: o.project.project_name ?? '',
    short_name: o.project.short_name ?? '',
    original_contract_sum: o.project.original_contract_sum != null ? String(o.project.original_contract_sum) : '',
    current_contract_sum: o.project.current_contract_sum != null ? String(o.project.current_contract_sum) : '',
    retc: o.project.retc == null ? 'unset' : o.project.retc ? 'yes' : 'no',
    award_date: s.award_date ?? '',
    commencement_date: s.commencement_date ?? '',
    original_duration_months: s.original_duration_months != null ? String(s.original_duration_months) : '',
    original_completion_date: s.original_completion_date ?? '',
    eot_requested_months: s.eot_requested_months != null ? String(s.eot_requested_months) : '',
    extension_of_time_months: s.eot_granted_months != null ? String(s.eot_granted_months) : '',
    revised_completion_date: s.revised_completion_date ?? '',
    works_commenced_date: s.works_commenced_date ?? '',
  })

  const openChange = (v: boolean) => {
    if (v) setF(seed())
    onOpenChange(v)
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }))

  const submit = () => {
    const p: Partial<CreateProjectRequest> = {}
    const str = (k: keyof CreateProjectRequest & string) => {
      if (f[k]?.trim()) (p as Record<string, unknown>)[k] = f[k].trim()
    }
    const numF = (k: keyof CreateProjectRequest & string, int = false) => {
      if (f[k]?.trim() !== '' && f[k] != null && !Number.isNaN(Number(f[k]))) {
        (p as Record<string, unknown>)[k] = int ? Math.round(Number(f[k])) : Number(f[k])
      }
    }
    str('client'); str('project_name'); str('short_name')
    numF('original_contract_sum'); numF('current_contract_sum')
    numF('original_duration_months', true)
    numF('eot_requested_months'); numF('extension_of_time_months', true)
    str('award_date'); str('commencement_date'); str('original_completion_date')
    str('revised_completion_date'); str('works_commenced_date')
    if (f.retc === 'yes') p.retc = true
    if (f.retc === 'no') p.retc = false

    update.mutate(p, {
      onSuccess: () => {
        toast.success('Contract details saved')
        qc.invalidateQueries({ queryKey: projectsKeys.detail(o.project.id) })
        onOpenChange(false)
      },
      onError: (err: Error) => toast.error('Save failed', { description: err.message }),
    })
  }

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit contract details &amp; schedule</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Client" full>
            <Input value={f.client ?? ''} onChange={set('client')} />
          </Field>
          <Field label="Name of Contract" full>
            <Textarea rows={2} value={f.project_name ?? ''} onChange={set('project_name')} />
          </Field>
          <Field label="Short Name">
            <Input value={f.short_name ?? ''} onChange={set('short_name')} />
          </Field>
          <Field label="RETC">
            <Select value={f.retc ?? 'unset'}
              onValueChange={(v) => setF((prev) => ({ ...prev, retc: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">—</SelectItem>
                <SelectItem value="no">No</SelectItem>
                <SelectItem value="yes">Yes</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Original Contract Amount (₦)">
            <Input type="number" value={f.original_contract_sum ?? ''} onChange={set('original_contract_sum')} />
          </Field>
          <Field label="Current Contract Amount (₦)">
            <Input type="number" value={f.current_contract_sum ?? ''} onChange={set('current_contract_sum')} />
          </Field>
          <Field label="Date of Contract Award">
            <Input type="date" value={f.award_date ?? ''} onChange={set('award_date')} />
          </Field>
          <Field label="Contract Commencement Date">
            <Input type="date" value={f.commencement_date ?? ''} onChange={set('commencement_date')} />
          </Field>
          <Field label="Original Contract Duration (Months)">
            <Input type="number" value={f.original_duration_months ?? ''} onChange={set('original_duration_months')} />
          </Field>
          <Field label="Original Contract Completion Date">
            <Input type="date" value={f.original_completion_date ?? ''} onChange={set('original_completion_date')} />
          </Field>
          <Field label="Extension of Time Requested (Months)">
            <Input type="number" value={f.eot_requested_months ?? ''} onChange={set('eot_requested_months')} />
          </Field>
          <Field label="Extension of Time Granted (Months)">
            <Input type="number" value={f.extension_of_time_months ?? ''} onChange={set('extension_of_time_months')} />
          </Field>
          <Field label="Revised Completion Date">
            <Input type="date" value={f.revised_completion_date ?? ''} onChange={set('revised_completion_date')} />
          </Field>
          <Field label="Works Actually Commenced on Site">
            <Input type="date" value={f.works_commenced_date ?? ''} onChange={set('works_commenced_date')} />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          Revised Contract Duration and the overdue figures are computed —
          original duration + EOT granted, and report date vs the completion
          dates.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children, full }: {
  label: string; children: React.ReactNode; full?: boolean
}) {
  return (
    <div className={`space-y-1.5 ${full ? 'sm:col-span-2' : ''}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  )
}

/* ── This week — the pulse ───────────────────────────────────────────── */

const VAT = 1.075

function Delta({ now, prev, prevLabel, downIsGood, pts }: {
  now: number; prev: number | null; prevLabel: string
  downIsGood?: boolean; pts?: boolean
}) {
  if (prev == null) return null
  const diff = now - prev
  if (pts ? Math.abs(diff) < 0.0005 : prev === 0) {
    return (
      <span className="inline-flex rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
        vs {prevLabel}: —
      </span>
    )
  }
  const up = diff > 0
  const good = downIsGood ? !up : up
  const label = pts
    ? `${up ? '+' : ''}${(diff * 100).toFixed(1)} pts`
    : `${up ? '+' : ''}${((diff / prev) * 100).toFixed(1)}%`
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
      good
        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
        : 'bg-red-500/10 text-red-600'
    }`}>
      {up ? '▲' : '▼'} {label} vs {prevLabel}
    </span>
  )
}

function ThisWeekCard({ o }: { o: ProjectOverview }) {
  const cp = o.cost_profitability
  const lw = o.latest_week!
  const pw = o.prev_week
  const prevLabel = pw ? `W${String(pw.week_number).padStart(2, '0')}` : ''
  const prevEarnings = pw ? pw.works_this_week * VAT : null
  const prevNet = pw ? pw.works_this_week * VAT - pw.cost_this_week : null
  const prevMargin = pw && pw.works_this_week > 0
    ? prevNet! / (pw.works_this_week * VAT) : null
  const gapWeeks = pw
    ? lw.year === pw.year && lw.week_number - pw.week_number > 1
      ? lw.week_number - pw.week_number - 1 : 0
    : 0

  const compare = [
    { label: 'Work Done (Incl. VAT)', now: cp.works_incl_vat_this_week, prev: prevEarnings },
    { label: 'Cost', now: cp.total_this_week, prev: pw?.cost_this_week ?? null },
  ]
  const maxVal = Math.max(...compare.flatMap((c) => [c.now, c.prev ?? 0]), 1)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          This week · {weekLabel(lw.year, lw.week_number)}
          <span className="ml-2 font-normal text-muted-foreground">
            w/e {fmtDate(lw.week_ending_date)}
          </span>
        </CardTitle>
        {pw && gapWeeks > 0 && (
          <p className="text-xs text-amber-700">
            Previous stored week is {prevLabel} — {gapWeeks} week{gapWeeks > 1 ? 's' : ''} missing in between
          </p>
        )}
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MiniKpi icon={HardHat} iconClass="bg-amber-500/10 text-amber-600"
            label="Work Done + VAT" value={naira(cp.works_incl_vat_this_week, true)}
            sub={naira(cp.works_incl_vat_this_week)}
            delta={<Delta now={cp.works_incl_vat_this_week} prev={prevEarnings} prevLabel={prevLabel} />} />
          <MiniKpi icon={Wallet} iconClass="bg-blue-500/10 text-blue-600"
            label="Cost" value={naira(cp.total_this_week, true)}
            sub={naira(cp.total_this_week)}
            delta={<Delta now={cp.total_this_week} prev={pw?.cost_this_week ?? null} prevLabel={prevLabel} downIsGood />} />
          <MiniKpi icon={TrendingUp} iconClass="bg-violet-500/10 text-violet-600"
            label="Work Added" value={pctFmt(lw.pct_added, 2)}
            sub="of BEME scope, this week alone"
            delta={pw && lw.pct_added != null
              ? <Delta now={lw.pct_added} prev={o.physical.ladder.works.beme ? pw.works_this_week / o.physical.ladder.works.beme : null} prevLabel={prevLabel} pts />
              : null} />
          <MiniKpi icon={Percent}
            iconClass={cp.net_this_week < 0 ? 'bg-red-500/10 text-red-600' : 'bg-emerald-500/10 text-emerald-600'}
            label="Net Margin" value={pctFmt(cp.margin_this_week)}
            sub={`net ${naira(cp.net_this_week, true)} this week`}
            delta={<Delta now={cp.margin_this_week ?? 0} prev={prevMargin} prevLabel={prevLabel} pts />} />
        </div>
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="mb-3 text-xs font-medium text-muted-foreground">
            {pw ? `This week vs ${prevLabel}` : 'No previous week stored yet'}
          </p>
          <div className="space-y-4">
            {pw && compare.map((c) => {
              const change = c.prev ? ((c.now - c.prev) / c.prev) * 100 : null
              return (
                <div key={c.label} className="space-y-1">
                  <div className="flex items-baseline justify-between">
                    <p className="text-xs font-medium">{c.label}</p>
                    {change != null && (
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {change > 0 ? '+' : ''}{change.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <CompareBar label={`W${String(lw.week_number).padStart(2, '0')}`} value={c.now} max={maxVal} strong />
                  <CompareBar label={prevLabel} value={c.prev ?? 0} max={maxVal} />
                </div>
              )
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function MiniKpi({ icon: Icon, iconClass, label, value, sub, delta }: {
  icon: React.ComponentType<{ className?: string }>
  iconClass: string
  label: string; value: string; sub?: string; delta?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${iconClass}`}>
          <Icon className="h-4 w-4" />
        </span>
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      </div>
      <p className="mt-2 text-lg font-bold tabular-nums">{value}</p>
      {sub && <p className="truncate text-[11px] tabular-nums text-muted-foreground" title={sub}>{sub}</p>}
      {delta && <div className="mt-1.5">{delta}</div>}
    </div>
  )
}

function CompareBar({ label, value, max, strong }: {
  label: string; value: number; max: number; strong?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">{label}</span>
      <div className="h-4 flex-1 overflow-hidden rounded-sm bg-muted">
        <div
          className={`h-full rounded-sm ${strong ? 'bg-amber-500' : 'bg-slate-400/50 dark:bg-slate-500/50'}`}
          style={{ width: `${Math.max(1.5, (value / max) * 100)}%` }}
        />
      </div>
      <span className={`w-20 shrink-0 text-right text-[11px] tabular-nums ${strong ? 'font-semibold' : 'text-muted-foreground'}`}>
        {naira(value, true)}
      </span>
    </div>
  )
}

/* ── Physical progress — works completed ─────────────────────────────── */

function PhysicalProgressCard({ o }: { o: ProjectOverview }) {
  const L = o.physical.ladder
  const bills = o.physical.bills

  const chartOption = useMemo(() => {
    const rows = [...bills].reverse()
    return {
      tooltip: {
        trigger: 'axis' as const,
        valueFormatter: (v: number) => `${v.toFixed(1)}%`,
      },
      grid: { left: 8, right: 48, top: 4, bottom: 4, containLabel: true },
      xAxis: {
        type: 'value' as const, max: 100,
        axisLabel: { show: false }, axisTick: { show: false },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'category' as const,
        data: rows.map((b) => titleCase(b.name)),
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { width: 165, overflow: 'truncate' as const, fontSize: 11 },
      },
      series: [{
        type: 'bar' as const,
        data: rows.map((b) => Math.round((b.pct_complete ?? 0) * 1000) / 10),
        barMaxWidth: 12,
        showBackground: true,
        backgroundStyle: { color: 'rgba(148, 163, 184, 0.12)', borderRadius: 6 },
        itemStyle: { color: '#f59e0b', borderRadius: 6 },
        label: {
          show: true, position: 'right' as const, fontSize: 11,
          formatter: ({ value }: { value: number }) => `${value}%`,
        },
      }],
    }
  }, [bills])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Physical progress — works completed</CardTitle>
        <p className="text-xs text-muted-foreground">
          Work sections from the BEME sheet, all amounts ₦m · to-date =
          previous + stored weeks (kobo-exact vs the workbook&apos;s own cumulative)
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 p-0 lg:grid-cols-[1fr_350px] lg:items-start">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="whitespace-nowrap px-4 py-2 font-medium">Work Section</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">BEME</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">Last Wk</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">This Wk</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">To Date</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">% Complete</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b, i) => (
                <tr key={b.bill_code ?? b.name}
                  className={`border-b ${i % 2 ? 'bg-muted/20' : ''}`}>
                  <td className="max-w-[280px] truncate px-4 py-1.5">{titleCase(b.name)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{nairaM(b.beme_amount)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums text-muted-foreground">{nairaM(b.last_week)}</td>
                  <td className={`px-4 py-1.5 text-right tabular-nums ${b.this_week > 0 ? 'font-medium text-amber-700 dark:text-amber-400' : ''}`}>
                    {nairaM(b.this_week)}
                  </td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{nairaM(b.to_date)}</td>
                  <td className="px-4 py-1.5">
                    <PctCell pct={b.pct_complete} />
                  </td>
                </tr>
              ))}
              <LadderRow label="Sub-Total" r={L.works} tone="subtotal" />
              <LadderRow label="Add VAT & State Levies (7.5%)" r={L.vat} />
              <LadderRow label="Total Works Completed (Incl. VAT)" r={L.works_incl_vat} tone="subtotal" />
              <LadderRow label="Contingency (Incl. VAT)" r={L.contingency_incl_vat}
                note="accrual: BEME tail sub-total₂ − sub-total₁, × 1.075" />
              <LadderRow label="TOTAL WORKS DONE (Incl. VAT & Contingency)"
                r={L.total_incl_contingency} tone="total" />
            </tbody>
          </table>
        </div>
        <div className="px-4 pb-4 lg:pt-2">
          <p className="mb-2 text-xs font-medium text-muted-foreground">% Complete by Work Section</p>
          <ECharts option={chartOption} style={{ height: Math.max(200, bills.length * 32 + 20) }} notMerge />
        </div>
      </CardContent>
    </Card>
  )
}

function PctCell({ pct }: { pct: number | null }) {
  const over = (pct ?? 0) > 1
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${over ? 'bg-red-500' : 'bg-amber-500'}`}
          style={{ width: `${Math.min(100, (pct ?? 0) * 100)}%` }} />
      </div>
      <span className={`w-12 text-right tabular-nums ${over ? 'font-semibold text-red-600' : ''}`}>
        {pctFmt(pct)}
      </span>
    </div>
  )
}

function LadderRow({ label, r, tone, note }: {
  label: string
  r: { beme: number | null; last_week: number | null; this_week: number | null; to_date: number | null }
  tone?: 'subtotal' | 'total'
  note?: string
}) {
  const pct = r.beme && r.to_date != null ? r.to_date / r.beme : null
  const rowClass = tone === 'total'
    ? 'border-t-2 border-amber-500/50 bg-amber-500/10 font-bold'
    : tone === 'subtotal'
      ? 'bg-amber-500/5 font-semibold'
      : ''
  return (
    <tr className={`border-b last:border-0 ${rowClass}`}>
      <td className="px-4 py-2" title={note}>{label}</td>
      <td className="px-4 py-2 text-right tabular-nums">{nairaM(r.beme)}</td>
      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{nairaM(r.last_week)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{nairaM(r.this_week)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{nairaM(r.to_date)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{pctFmt(pct)}</td>
    </tr>
  )
}

/* ── Certificates & payments ─────────────────────────────────────────── */

function CertsPaymentsCard({ o }: { o: ProjectOverview }) {
  const c = o.certs_payments
  const young = c.certificates_total === 0 && c.payments_count === 0
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Banknote className="h-4 w-4 text-muted-foreground" />
          Certificates &amp; payments
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Certificate + payments ledgers only — never the Contract Summary&apos;s
          frozen client block
        </p>
      </CardHeader>
      <CardContent>
        {young ? (
          <p className="py-3 text-xs text-muted-foreground">
            No certificates or payments recorded yet — young ledger.
          </p>
        ) : (
          <div className="grid gap-x-8 gap-y-1.5 text-sm md:grid-cols-2">
            <MoneyRow label="Certificates (No.)" text={String(c.certificates_total)} />
            <MoneyRow label="Advance Received" v={c.advance_received} />
            <MoneyRow label="Total Certified" v={c.certified_to_date} />
            <MoneyRow label="Advance Recovered" v={c.advance_recovered} />
            <MoneyRow label="Payments Received – Gross" v={c.payments_gross} />
            <MoneyRow label="Advance Outstanding" v={c.advance_outstanding} />
            <MoneyRow label="Payments Received – Net" v={c.payments_net} />
            <MoneyRow label="Retention Held" v={c.retention_held} />
            <MoneyRow label="Certified – Not Yet Paid" v={c.certified_not_paid}
              note="certified − cert-type payments (advances excluded)" />
            <MoneyRow label="% of Certified Value Paid" text={pctFmt(c.pct_certified_paid)} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ── Resources (this week) ───────────────────────────────────────────── */

function ResourcesCard({ o }: { o: ProjectOverview }) {
  const r = o.resources
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <HardHat className="h-4 w-4 text-muted-foreground" />
          Resources · this week
        </CardTitle>
        <p className="text-xs text-muted-foreground">Labour Strength + Diesel sheets, latest week</p>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        <MoneyRow label="Direct Labour Headcount" text={num(r.labour_direct)} />
        <MoneyRow label="Casual Labour Headcount" text={num(r.labour_casual)} />
        <MoneyRow label="Diesel Used This Week (L)" text={num(r.diesel_litres_week)} />
        <MoneyRow label="Diesel Cost This Week" v={r.diesel_cost_week}
          note="Cost Report AGO row — the money truth" />
      </CardContent>
    </Card>
  )
}

/* ── Cost & profitability ────────────────────────────────────────────── */

// FIXED per-category colors — the donut and the table dots share them,
// and a filter or new week never repaints survivors.
const CATEGORY_COLORS: Record<string, string> = {
  'Materials': '#3b82f6',
  'Plant': '#f59e0b',
  'AGO': '#8b5cf6',
  'Local Labour': '#10b981',
  'Site Level Expenses': '#06b6d4',
  'Overheads': '#f43f5e',
  'Sub Contractors': '#14b8a6',
  'Uncategorised': '#94a3b8',
}
const FALLBACK_COLORS = ['#eab308', '#64748b', '#ec4899', '#84cc16']

function categoryColor(name: string, i: number): string {
  return CATEGORY_COLORS[name] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]
}

function CostProfitabilityCard({ o }: { o: ProjectOverview }) {
  const cp = o.cost_profitability

  const donutOption = useMemo(() => ({
    tooltip: {
      trigger: 'item' as const,
      valueFormatter: (v: number) => `₦${nairaM(v)}m`,
    },
    legend: {
      orient: 'vertical' as const, right: 0, top: 'middle',
      textStyle: { fontSize: 11 }, itemWidth: 10, itemHeight: 10,
      formatter: (name: string) => {
        const cat = cp.categories.find((c) => c.category === name)
        return cat?.pct_of_total != null
          ? `${name}  ${(cat.pct_of_total * 100).toFixed(1)}%`
          : name
      },
    },
    title: {
      text: naira(cp.total_to_date, true),
      subtext: 'cost to date',
      left: '30%', top: '40%', textAlign: 'center' as const,
      textStyle: { fontSize: 15, fontWeight: 700 as const },
      subtextStyle: { fontSize: 10 },
    },
    series: [{
      type: 'pie' as const, radius: ['58%', '80%'], center: ['31%', '50%'],
      itemStyle: { borderWidth: 2, borderColor: 'transparent', borderRadius: 3 },
      label: { show: false },
      data: cp.categories.map((c, i) => ({
        name: c.category, value: Math.round(c.to_date),
        itemStyle: { color: categoryColor(c.category, i) },
      })),
    }],
  }), [cp])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Cost &amp; profitability</CardTitle>
        <p className="text-xs text-muted-foreground">
          Cost Report categories, all amounts ₦m · net earnings = work done
          incl VAT (excl contingency) − costs — the Weekly Summary definition
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 p-0 lg:grid-cols-[1fr_400px] lg:items-center">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="whitespace-nowrap px-4 py-2 font-medium">Cost Category</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">Last Wk</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">This Wk</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">To Date</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {cp.categories.map((c, i) => (
                <tr key={c.category} className={`border-b ${i % 2 ? 'bg-muted/20' : ''}`}>
                  <td className="px-4 py-1.5">
                    <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                      style={{ backgroundColor: categoryColor(c.category, i) }} />
                    {c.category}
                  </td>
                  <td className="px-4 py-1.5 text-right tabular-nums text-muted-foreground">{nairaM(c.last_week)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{nairaM(c.this_week)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{nairaM(c.to_date)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{pctFmt(c.pct_of_total)}</td>
                </tr>
              ))}
              <tr className="border-b bg-muted/40 font-semibold">
                <td className="px-4 py-2">Total Costs to Date</td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{nairaM(cp.total_last_week)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{nairaM(cp.total_this_week)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{nairaM(cp.total_to_date)}</td>
                <td className="px-4 py-2 text-right tabular-nums">100.0%</td>
              </tr>
              <tr className="border-b">
                <td className="px-4 py-2">Value of Work Done — Incl. VAT, Excl. Contingency</td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{nairaM(cp.works_incl_vat_last_week)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{nairaM(cp.works_incl_vat_this_week)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{nairaM(cp.works_incl_vat_to_date)}</td>
                <td className="px-4 py-2" />
              </tr>
              <tr className="border-b bg-emerald-500/5 font-semibold">
                <td className="px-4 py-2">Net Earnings</td>
                <td className={`px-4 py-2 text-right tabular-nums ${cp.net_last_week != null && cp.net_last_week < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                  {nairaM(cp.net_last_week)}
                </td>
                <td className={`px-4 py-2 text-right tabular-nums ${cp.net_this_week < 0 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-400'}`}>
                  {nairaM(cp.net_this_week)}
                </td>
                <td className={`px-4 py-2 text-right tabular-nums ${cp.net_to_date < 0 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-400'}`}>
                  {nairaM(cp.net_to_date)}
                </td>
                <td className="px-4 py-2" />
              </tr>
              <tr className="bg-emerald-500/5 font-bold">
                <td className="px-4 py-2">Net Margin %</td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{pctFmt(cp.margin_last_week)}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${cp.margin_this_week != null && cp.margin_this_week < 0 ? 'text-red-600' : ''}`}>
                  {pctFmt(cp.margin_this_week)}
                </td>
                <td className={`px-4 py-2 text-right tabular-nums ${cp.margin_to_date != null && cp.margin_to_date < 0 ? 'text-red-600' : ''}`}>
                  {pctFmt(cp.margin_to_date)}
                </td>
                <td className="px-4 py-2" />
              </tr>
            </tbody>
          </table>
        </div>
        <div className="px-4 pb-4">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Cost to Date by Category</p>
          <ECharts option={donutOption} style={{ height: 240 }} notMerge />
        </div>
      </CardContent>
    </Card>
  )
}

/* ── shared bits ─────────────────────────────────────────────────────── */

function Kpi({ label, value, sub, lineage, tone }: {
  label: string; value: string; sub?: string; lineage: string; tone?: 'good' | 'bad'
}) {
  return (
    <Card>
      <CardContent className="p-3.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-0.5 text-xl font-bold tabular-nums ${
          tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-emerald-700 dark:text-emerald-400' : ''
        }`}>{value}</p>
        {sub && <p className="truncate text-xs tabular-nums text-muted-foreground" title={sub}>{sub}</p>}
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={lineage}>{lineage}</p>
      </CardContent>
    </Card>
  )
}

function MoneyRow({ label, v, text, note }: {
  label: string; v?: number; text?: string; note?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed pb-1 last:border-0" title={note}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{text ?? naira(v)}</span>
    </div>
  )
}

const titleCase = (s: string): string =>
  s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())

function OverviewSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-44" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-56" />
      <Skeleton className="h-96" />
    </div>
  )
}

function NoReportsYet() {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <p className="font-medium">No weekly reports yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload the first 16-sheet workbook on the Submissions tab — the
          dashboard builds itself from the parsed ledgers.
        </p>
      </CardContent>
    </Card>
  )
}
