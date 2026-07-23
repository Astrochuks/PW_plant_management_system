'use client'

/**
 * Report — the report pack. Pick any period (any week, month, quarter,
 * year, or to-date — as long as the data exists), Generate, and the
 * document renders on the page from the same ledgers the tabs use.
 * Export PDF prints just the document (print CSS strips the app
 * chrome); Export Excel builds a workbook client-side (SheetJS), one
 * sheet per section — the fleet report generator's pattern.
 */

import { useCallback, useState } from 'react'
import { useParams } from 'next/navigation'
import { FileBarChart, FileSpreadsheet, FileText, Loader2 } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Legend } from '@/components/projects/hub-ui'
import { generateProjectReport, type ProjectReportPack, type ReportPeriod } from '@/lib/api/projects'
import { getErrorMessage } from '@/lib/api/client'
import { naira, num, pctFmt, fmtDate, weekLabel } from '@/lib/format'

const PERIODS: Array<{ key: ReportPeriod; label: string }> = [
  { key: 'weekly', label: 'Week' },
  { key: 'monthly', label: 'Month' },
  { key: 'quarterly', label: 'Quarter' },
  { key: 'yearly', label: 'Year' },
  { key: 'to-date', label: 'To date' },
]

export default function ReportPage() {
  const params = useParams<{ id: string }>()
  const [period, setPeriod] = useState<ReportPeriod>('weekly')
  const [refDate, setRefDate] = useState(() => new Date().toISOString().slice(0, 10))

  const { data: report, isPending, mutate } = useMutation({
    mutationFn: () => generateProjectReport(params.id, period, refDate),
    onError: (err) => toast.error(getErrorMessage(err)),
  })

  const handleExportExcel = useCallback(async () => {
    if (!report) return
    const XLSX = await import('xlsx')
    const { utils, writeFile } = XLSX
    const wb = utils.book_new()
    const m = report.meta

    const header = (section: string): (string | number)[][] => [
      ['P.W. NIGERIA LTD.'],
      [`${m.short_name || m.project_name} — Project Report · ${m.label}`],
      [`Period: ${m.date_from} to ${m.date_to}${m.as_of ? `  |  To-date figures as of ${weekLabel(m.as_of.year, m.as_of.week_number)}` : ''}`],
      [`Generated: ${m.generated_at}`],
      [],
      [section],
      [],
    ]

    const sheet = (
      name: string, section: string, headers: string[],
      rows: (string | number)[][], widths: number[],
    ) => {
      const aoa = [...header(section), headers, ...rows]
      const ws = utils.aoa_to_sheet(aoa)
      ws['!cols'] = widths.map((w) => ({ wch: w }))
      const nc = headers.length
      ws['!merges'] = [0, 1, 2, 3, 5].map((r) => ({ s: { r, c: 0 }, e: { r, c: Math.max(nc - 1, 1) } }))
      utils.book_append_sheet(wb, ws, name)
    }

    const cs = report.contract_summary
    sheet('Summary', 'CONTRACT SUMMARY', ['Item', 'Value'], [
      ['Contract Sum', cs.contract_sum ?? '—'],
      ['Total BEME (Incl. VAT)', cs.beme_incl_vat],
      ['Work Done to Date (Incl. VAT)', cs.works_incl_vat],
      ['% Complete', cs.pct_complete == null ? '—' : `${(cs.pct_complete * 100).toFixed(2)}%`],
      ['Cost to Date', cs.cost_to_date],
      ['Net to Date', cs.net_to_date],
      ['Margin', cs.margin == null ? '—' : `${(cs.margin * 100).toFixed(1)}%`],
      ['Certified (cumulative)', cs.certified ?? '—'],
      ['Paid (gross)', cs.paid_gross ?? '—'],
      ['Certified, Not Yet Paid', cs.certified_not_paid ?? '—'],
      ['Retention Held', cs.retention_held ?? '—'],
      ['Retention Released', cs.retention_released],
    ], [34, 24])

    sheet('Period', `PERIOD SUMMARY — ${m.label.toUpperCase()}`,
      ['Week', 'Week Ending', 'Works', 'Works Incl. VAT', 'Cost', 'Net'],
      [
        ...report.period_summary.weeks.map((w) => [
          weekLabel(w.year, w.week_number), w.week_ending_date,
          w.works, w.earnings, w.cost, w.net,
        ]),
        [],
        ['TOTAL', '', report.period_summary.totals.works, report.period_summary.totals.earnings,
          report.period_summary.totals.cost, report.period_summary.totals.net],
      ], [14, 14, 20, 20, 20, 20])

    sheet('Work Done', 'WORK DONE — BY BILL',
      ['Bill', 'Description', 'Contract Amount', 'This Period', 'To Date', '% Complete'],
      report.work_done.bills.map((b) => [
        b.bill_code ?? '—', b.name ?? '—', b.contract_amount,
        b.period_amount, b.to_date_amount,
        b.pct_complete == null ? '—' : `${(b.pct_complete * 100).toFixed(1)}%`,
      ]), [8, 40, 20, 20, 20, 12])

    sheet('Costs', 'COSTS — BY CATEGORY',
      ['Category', 'This Period', 'To Date', 'Share of Cost to Date'],
      report.costs.categories.map((c) => [
        c.category, c.period_amount, c.to_date_amount,
        c.share_to_date == null ? '—' : `${(c.share_to_date * 100).toFixed(1)}%`,
      ]), [28, 20, 20, 18])

    const pd = report.plant_diesel
    sheet('Plant & Diesel', `PLANT & DIESEL — ${m.label.toUpperCase()}`, ['Item', 'Value'], [
      ['Plants Seen', pd.plants_seen],
      ['Hours Worked', pd.worked],
      ['Standby Hours', pd.standby],
      ['Breakdown Hours', pd.breakdown],
      ['Fleet Availability', pd.availability == null ? '—' : `${(pd.availability * 100).toFixed(1)}%`],
      ['Utilisation', pd.utilisation == null ? '—' : `${(pd.utilisation * 100).toFixed(1)}%`],
      ['Plant Cost', pd.plant_cost],
      ['Diesel (AGO)', pd.diesel_cost],
      ['Diesel Charged (L)', pd.diesel_charged],
      ['Diesel Logged (L)', pd.diesel_logged],
      ['Attribution', pd.attribution == null ? '—' : `${(pd.attribution * 100).toFixed(0)}%`],
    ], [30, 22])

    const fin = report.financials
    sheet('Financials', 'FINANCIALS — AS AT PERIOD END',
      ['Item', 'Value'],
      [
        ['Certified (cumulative)', fin.certified ?? '—'],
        ['Paid Gross (to period end)', fin.paid_gross ?? '—'],
        ['Payments Count', fin.payments_count],
        ['Retention Held', fin.retention_held ?? '—'],
        ['Retention Released', fin.retention_released],
        [],
        ['UNPAID CERTIFICATES (FIFO)', ''],
        ['Certificate', 'Outstanding'],
        ...fin.unpaid_certificates.map((u) => [`Cert ${u.cert}`, u.outstanding]),
      ], [30, 24])

    const fileName = `PW_${(m.short_name || m.project_name).replace(/[^\w]+/g, '_')}_Report_${m.label.replace(/[\s,·]+/g, '_')}.xlsx`
    writeFile(wb, fileName)
  }, [report])

  return (
    <div className="space-y-4">
      {/* print CSS: only the document leaves the printer */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #report-doc, #report-doc * { visibility: visible; }
          #report-doc { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
          #report-doc .report-section { break-inside: avoid; }
          @page { size: A4; margin: 14mm; }
        }
      `}</style>

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={period} onValueChange={(v) => setPeriod(v as ReportPeriod)}>
            <SelectTrigger className="h-9 w-32 font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={refDate}
            onChange={(e) => setRefDate(e.target.value)}
            className="h-9 w-40"
          />
          <Button size="sm" onClick={() => mutate()} disabled={isPending}>
            {isPending
              ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              : <FileBarChart className="mr-2 h-3.5 w-3.5" />}
            Generate
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={!report} onClick={() => window.print()}>
            <FileText className="mr-2 h-3.5 w-3.5" />
            Export PDF
          </Button>
          <Button variant="outline" size="sm" disabled={!report} onClick={handleExportExcel}>
            <FileSpreadsheet className="mr-2 h-3.5 w-3.5" />
            Export Excel
          </Button>
        </div>
      </div>

      {!report && !isPending && (
        <div className="rounded-lg border py-12 text-center text-muted-foreground">
          <p className="text-lg font-medium text-foreground">Pick a period, then Generate</p>
          <p className="mt-1 text-sm">
            Any week, month, quarter or year works — the date picks which one.
            The pack is computed from the ledgers at generation time.
          </p>
        </div>
      )}

      {report && <ReportDocument report={report} />}
    </div>
  )
}

// ── The document ─────────────────────────────────────────────────────

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 border-b border-dashed py-1 text-sm last:border-0 ${strong ? 'font-semibold' : ''}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 border-b-2 border-foreground pb-1 text-sm font-bold uppercase tracking-wide">
      {children}
    </h2>
  )
}

function ReportDocument({ report }: { report: ProjectReportPack }) {
  const m = report.meta
  const cs = report.contract_summary
  const ps = report.period_summary
  const pd = report.plant_diesel
  const fin = report.financials

  return (
    <Card className="relative">
      <Legend>Report · {m.label}</Legend>
      <CardContent className="pt-4">
        <div id="report-doc" className="mx-auto max-w-4xl space-y-6 py-2">
          {/* Header block */}
          <div className="report-section space-y-1 border-b-4 border-double border-foreground pb-4 text-center">
            <p className="text-lg font-bold tracking-wide">P.W. NIGERIA LTD.</p>
            <p className="text-base font-semibold">{m.project_name}</p>
            {m.client && <p className="text-xs text-muted-foreground">{m.client}</p>}
            <p className="pt-1 text-sm font-medium">
              Project Report — {m.label}
            </p>
            <p className="text-xs text-muted-foreground">
              Period {fmtDate(m.date_from)} to {fmtDate(m.date_to)}
              {m.weeks_covered.length > 0 && ` · ${m.weeks_covered.length} stored week${m.weeks_covered.length > 1 ? 's' : ''}`}
              {m.as_of && ` · to-date figures as of ${weekLabel(m.as_of.year, m.as_of.week_number)}`}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Generated {fmtDate(m.generated_at)} — computed from stored weekly ledgers
            </p>
          </div>

          {/* Contract summary */}
          <div className="report-section">
            <SectionTitle>Contract Summary</SectionTitle>
            <div className="grid gap-x-10 md:grid-cols-2">
              <div>
                <Row label="Contract Sum" value={naira(cs.contract_sum)} />
                <Row label="Total BEME (Incl. VAT)" value={naira(cs.beme_incl_vat)} />
                <Row label="Work Done to Date (Incl. VAT)" value={naira(cs.works_incl_vat)} strong />
                <Row label="% Complete" value={pctFmt(cs.pct_complete)} strong />
                <Row label="Cost to Date" value={naira(cs.cost_to_date)} />
                <Row label="Net to Date" value={naira(cs.net_to_date)} strong />
                <Row label="Margin" value={pctFmt(cs.margin)} />
              </div>
              <div>
                <Row label="Certified (cumulative)" value={naira(cs.certified)} />
                <Row label="Paid (gross)" value={naira(cs.paid_gross)} />
                <Row label="Certified, Not Yet Paid" value={naira(cs.certified_not_paid)} strong />
                <Row label="Retention Held" value={naira(cs.retention_held)} />
                <Row label="Retention Released" value={naira(cs.retention_released)} />
              </div>
            </div>
          </div>

          {/* Period summary */}
          <div className="report-section">
            <SectionTitle>Period Summary — {m.label}</SectionTitle>
            {ps.weeks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stored weeks fall inside this period.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-1.5 pr-2 font-medium">Week</th>
                    <th className="py-1.5 pr-2 font-medium">Ending</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Works</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Works Incl. VAT</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Cost</th>
                    <th className="py-1.5 text-right font-medium">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {ps.weeks.map((w) => (
                    <tr key={`${w.year}-${w.week_number}`} className="border-b last:border-0">
                      <td className="py-1 pr-2 font-medium tabular-nums">{weekLabel(w.year, w.week_number)}</td>
                      <td className="py-1 pr-2 text-muted-foreground">{fmtDate(w.week_ending_date)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{naira(w.works)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{naira(w.earnings)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{naira(w.cost)}</td>
                      <td className={`py-1 text-right tabular-nums font-medium ${w.net < 0 ? 'text-red-600' : ''}`}>
                        {naira(w.net)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-foreground font-semibold">
                    <td className="py-1.5 pr-2" colSpan={2}>Total</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{naira(ps.totals.works)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{naira(ps.totals.earnings)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{naira(ps.totals.cost)}</td>
                    <td className={`py-1.5 text-right tabular-nums ${ps.totals.net < 0 ? 'text-red-600' : ''}`}>
                      {naira(ps.totals.net)}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>

          {/* Work done by bill */}
          <div className="report-section">
            <SectionTitle>Work Done — by Bill</SectionTitle>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1.5 pr-2 font-medium">Bill</th>
                  <th className="py-1.5 pr-2 font-medium">Description</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Contract Amount</th>
                  <th className="py-1.5 pr-2 text-right font-medium">This Period</th>
                  <th className="py-1.5 pr-2 text-right font-medium">To Date</th>
                  <th className="py-1.5 text-right font-medium">% Complete</th>
                </tr>
              </thead>
              <tbody>
                {report.work_done.bills.map((b) => (
                  <tr key={String(b.bill_code)} className="border-b last:border-0">
                    <td className="py-1 pr-2 font-medium tabular-nums">{b.bill_code ?? '—'}</td>
                    <td className="max-w-[240px] truncate py-1 pr-2">{b.name ?? '—'}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{naira(b.contract_amount)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{naira(b.period_amount)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{naira(b.to_date_amount)}</td>
                    <td className="py-1 text-right tabular-nums font-medium">{pctFmt(b.pct_complete)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Costs by category */}
          <div className="report-section">
            <SectionTitle>Costs — by Category</SectionTitle>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1.5 pr-2 font-medium">Category</th>
                  <th className="py-1.5 pr-2 text-right font-medium">This Period</th>
                  <th className="py-1.5 pr-2 text-right font-medium">To Date</th>
                  <th className="py-1.5 text-right font-medium">Share of Cost to Date</th>
                </tr>
              </thead>
              <tbody>
                {report.costs.categories.map((c) => (
                  <tr key={c.category} className="border-b last:border-0">
                    <td className="py-1 pr-2 font-medium">{c.category}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{naira(c.period_amount)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{naira(c.to_date_amount)}</td>
                    <td className="py-1 text-right tabular-nums">{pctFmt(c.share_to_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Plant & diesel */}
          <div className="report-section">
            <SectionTitle>Plant &amp; Diesel — {m.label}</SectionTitle>
            <div className="grid gap-x-10 md:grid-cols-2">
              <div>
                <Row label="Plants Seen" value={String(pd.plants_seen)} />
                <Row label="Hours Worked" value={`${num(Math.round(pd.worked))} h`} />
                <Row label="Standby Hours" value={`${num(Math.round(pd.standby))} h`} />
                <Row label="Breakdown Hours" value={`${num(Math.round(pd.breakdown))} h`} />
                <Row label="Fleet Availability" value={pctFmt(pd.availability)} strong />
                <Row label="Utilisation" value={pctFmt(pd.utilisation)} strong />
              </div>
              <div>
                <Row label="Plant Cost" value={naira(pd.plant_cost)} />
                <Row label="Diesel (AGO)" value={naira(pd.diesel_cost)} />
                <Row label="Diesel Charged" value={`${num(Math.round(pd.diesel_charged))} L`} />
                <Row label="Diesel Logged to Plants" value={`${num(Math.round(pd.diesel_logged))} L`} />
                <Row label="Attribution" value={pctFmt(pd.attribution, 0)} />
              </div>
            </div>
          </div>

          {/* Financials */}
          <div className="report-section">
            <SectionTitle>Financials — as at {fmtDate(m.date_to)}</SectionTitle>
            <div className="grid gap-x-10 md:grid-cols-2">
              <div>
                <Row label="Certified (cumulative)" value={naira(fin.certified)} />
                <Row label="Paid Gross (to period end)" value={naira(fin.paid_gross)} />
                <Row label="Payments Recorded" value={String(fin.payments_count)} />
              </div>
              <div>
                <Row label="Retention Held" value={naira(fin.retention_held)} />
                <Row label="Retention Released" value={naira(fin.retention_released)} />
              </div>
            </div>
            {fin.unpaid_certificates.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                  Unpaid certificates (payments applied oldest-first)
                </p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-1.5 pr-2 font-medium">Cert</th>
                      <th className="py-1.5 pr-2 text-right font-medium">This Certificate</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Paid Against It</th>
                      <th className="py-1.5 text-right font-medium">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fin.unpaid_certificates.map((u) => (
                      <tr key={u.cert} className="border-b last:border-0">
                        <td className="py-1 pr-2 font-medium tabular-nums">{u.cert}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{naira(u.this_certificate)}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{naira(u.paid_against)}</td>
                        <td className="py-1 text-right tabular-nums font-semibold text-red-600">
                          {naira(u.outstanding)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
