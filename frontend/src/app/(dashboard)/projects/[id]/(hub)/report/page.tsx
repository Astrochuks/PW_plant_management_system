'use client'

/**
 * Report — the printable report pack (PDF / Excel). Scaffold only:
 * the pack's structure is outlined here; generation is not built yet.
 */

import { useState } from 'react'
import { FileSpreadsheet, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const PERIODS = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'to-date', label: 'To date' },
] as const

const PACK_SECTIONS = [
  { title: 'Contract summary', body: 'The living Contract Summary — contract sum, work done, certified, paid, net earnings, all showing their working.' },
  { title: 'Weekly summary', body: 'Earnings vs costs for the period, week by week, with the net earnings ladder.' },
  { title: 'Work done', body: 'BEME bills and items — this period and cumulative, % complete per bill.' },
  { title: 'Costs', body: 'Cost report by category — this period, cumulative, and share of total.' },
  { title: 'Plant & diesel', body: 'Per-plant hours and cost, diesel charged vs logged.' },
  { title: 'Financials', body: 'Certificates and payments ledgers as at the period end.' },
]

export default function ReportPage() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['key']>('week')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                period === p.key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled title="Coming soon">
            <FileText className="mr-2 h-3.5 w-3.5" />
            Export PDF
          </Button>
          <Button variant="outline" size="sm" disabled title="Coming soon">
            <FileSpreadsheet className="mr-2 h-3.5 w-3.5" />
            Export Excel
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Report pack — coming soon</CardTitle>
          <p className="text-xs text-muted-foreground">
            A formatted document you can print or hand over — reads like the
            workbook, generated from the same ledgers the tabs use. Pick a
            period above; these are the sections it will contain.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {PACK_SECTIONS.map((s) => (
            <div key={s.title} className="rounded-lg border border-dashed p-3">
              <p className="text-sm font-medium">{s.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
