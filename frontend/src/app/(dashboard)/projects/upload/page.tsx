'use client'

/**
 * Weekly report upload — the Silver preview experience.
 *
 * Drop the file → we parse it in memory and show you the CLEANED data,
 * sheet by sheet (tabs like the Excel), with every check in plain
 * English. Nothing is saved until you press Accept.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, CheckCircle2, CircleAlert, CloudUpload, FileSpreadsheet,
  Loader2, ShieldCheck, Timer, X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import apiClient from '@/lib/api/client'
import { getErrorMessage } from '@/lib/api/client'
import { useProjects, useUploadWeeklyReport } from '@/hooks/use-projects'

// ─── types (loose on purpose — the preview is exploratory) ────────────────
interface SheetPreview {
  kind: 'parsed' | 'stored_only'
  status: string
  warnings: string[]
  rows?: Record<string, unknown>[]
  total_rows?: number
  grid?: string[][]
  cross_checks?: { check: string; ours: number; sheet: number; delta: number }[]
  bills?: { bill_code: string; name: string }[]
  totals?: Record<string, number>
  stock_maintained?: boolean
  sheet_total?: number | null
  calendar_weeks?: number
}
interface PreviewData {
  identity: Record<string, unknown> | null
  identity_warning: string | null
  drift: { clean: boolean; missing: string[]; drifted: string[] }
  sheets: Record<string, SheetPreview>
  parse_ms: number
  file_name: string
  file_size: number
}

const SHEET_ORDER = [
  'Contract Summary', 'Weekly Summary', 'BEME & Works Completed Fd',
  'Certificate Status', 'Payments Recieved', 'Cost Report',
  'Plant Return', 'Diesel Consumption', 'Hired Vehicles',
  'Labour Strength', 'Subcontractors', 'Materials & Civils',
  'Precast', 'Bill 1 Summary', 'Bill 1 Payments', 'Lists',
]
const SHORT_NAMES: Record<string, string> = {
  'BEME & Works Completed Fd': 'BEME',
  'Payments Recieved': 'Payments',
  'Certificate Status': 'Certificates',
  'Contract Summary': 'Contract',
  'Weekly Summary': 'Summary',
  'Diesel Consumption': 'Diesel',
  'Materials & Civils': 'Materials',
  'Labour Strength': 'Labour',
  'Hired Vehicles': 'Hired',
  'Subcontractors': 'Subs',
  'Bill 1 Summary': 'Bill 1',
  'Bill 1 Payments': 'Bill 1 Pay',
}

function fmtN(v: unknown): string {
  const n = Number(v)
  if (v === null || v === undefined || v === '' || Number.isNaN(n)) return String(v ?? '—')
  if (Number.isInteger(n) && Math.abs(n) < 10000) return String(n)
  return n.toLocaleString('en-NG', { maximumFractionDigits: 2 })
}

// the one-line cleaning report per sheet, in plain English
function cleaningLine(name: string, s: SheetPreview): string {
  if (s.kind === 'stored_only') {
    return 'Stored with the original file — not parsed (its figures post through the Cost Report).'
  }
  const n = s.total_rows ?? 0
  switch (name) {
    case 'BEME & Works Completed Fd':
      return `${n} real work items kept across ${s.bills?.length ?? 0} bills — bill totals, VAT/contingency lines and the summary table were set aside as checks, never data.`
    case 'Cost Report':
      return `${n} cost rows kept — the sheet's own Total row is used only to verify our sum.`
    case 'Plant Return':
      return `${n} machines on the roster — including idle ones (zero hours is information).`
    case 'Diesel Consumption':
      return `${n} fuel events kept — empty roster lines dropped; litres are attribution, money comes from the Cost Report.`
    case 'Certificate Status':
      return n ? `${n} certificates (cumulative ledger, retention checked at 5%).` : 'No certificates yet — normal for a young project.'
    case 'Payments Recieved':
      return n ? `${n} real payments kept — template placeholders and total rows dropped.` : 'No payments yet — normal for a young project.'
    case 'Labour Strength':
      return `${n} department lines — head-count totals verified against the Cost Report's labour row.`
    case 'Subcontractors':
      return `${n} work items — including standing rate-card agreements at zero quantity.`
    case 'Materials & Civils':
      return s.stock_maintained
        ? `${n} materials — stock ledger maintained, loss detection ACTIVE.`
        : `${n} materials — usage recorded, but the stock side isn't maintained at this site.`
    case 'Hired Vehicles':
      return `${n} hire lines kept — including standing arrangements at zero days.`
    case 'Weekly Summary':
      return `${n} summary lines — used only to cross-check our own arithmetic.`
    case 'Contract Summary':
      return 'Identity, schedule, APG and Bill 1 fields extracted; the stale client-position block is quarantined as a check.'
    case 'Lists':
      return `Company calendar (${s.calendar_weeks ?? '—'} weeks) + reference lists — master data, ingested once.`
    default:
      return `${n} rows kept.`
  }
}

export default function UploadWeeklyReportPage() {
  const router = useRouter()
  const upload = useUploadWeeklyReport()
  const { data: projectsData } = useProjects({ is_legacy: false, limit: 100 })
  const projects = projectsData?.data ?? []

  const [projectId, setProjectId] = useState('')
  const [yearStr, setYearStr] = useState(String(new Date().getFullYear()))
  const [weekStr, setWeekStr] = useState('')
  const year = Number(yearStr) || 0
  const week = Number(weekStr) || 0
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const [previewing, setPreviewing] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [activeSheet, setActiveSheet] = useState(SHEET_ORDER[0])
  const [accepting, setAccepting] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const runPreview = useCallback(async (f: File, pid: string) => {
    setPreviewing(true)
    setPreview(null)
    setElapsed(0)
    const t0 = performance.now()
    timerRef.current = setInterval(
      () => setElapsed(performance.now() - t0), 100)
    try {
      const form = new FormData()
      form.append('file', f)
      if (pid) form.append('project_id', pid)
      const res = await apiClient.post('/projects/preview-weekly-report', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000,
      })
      setPreview(res.data.data)
      setActiveSheet('BEME & Works Completed Fd')
    } catch (err) {
      toast.error('Could not read this workbook', {
        description: getErrorMessage(err), duration: 10000,
      })
      setFile(null)
    } finally {
      if (timerRef.current) clearInterval(timerRef.current)
      setPreviewing(false)
    }
  }, [])

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])

  const onFile = useCallback((f: File | null) => {
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.xlsx')) {
      toast.error('Only .xlsx weekly reports are accepted')
      return
    }
    if (!projectId) {
      toast.error('Pick the project first — the workbook is checked against it')
      return
    }
    if (week < 1 || week > 53) {
      toast.error('Enter the week number (1–53) before dropping the file')
      return
    }
    setFile(f)
    void runPreview(f, projectId)
  }, [projectId, runPreview])

  const warnCount = useMemo(() => {
    if (!preview) return 0
    return Object.values(preview.sheets)
      .reduce((a, s) => a + (s.warnings?.length ?? 0), 0)
      + (preview.identity_warning ? 1 : 0)
  }, [preview])

  const accept = async () => {
    if (!file || !projectId) return
    setAccepting(true)
    upload.mutate(
      { file, projectId, year, weekNumber: week },
      {
        onSuccess: () => {
          toast.success(`${year} · Week ${week} accepted — saving to the database`)
          router.push('/projects/submissions')
        },
        onError: (err: Error) => {
          toast.error('Save failed', { description: err.message, duration: 12000 })
          setAccepting(false)
        },
      },
    )
  }

  const idy = preview?.identity ?? {}

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/projects/submissions"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Upload weekly report</h1>
            <p className="text-muted-foreground text-sm">
              Drop the site&apos;s workbook — review the cleaned data — accept. Nothing is saved until you say so.
            </p>
          </div>
        </div>
        {preview && (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Timer className="h-4 w-4" />
            Parsed 16 sheets in <b className="text-foreground">{(preview.parse_ms / 1000).toFixed(1)}s</b>
          </div>
        )}
      </div>

      {/* step 1: context + drop zone */}
      <Card>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-[1fr_130px_130px]">
          <div className="space-y-1.5">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId} disabled={!!preview}>
              <SelectTrigger><SelectValue placeholder="Select active project" /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.short_name || p.project_name.slice(0, 50)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Year</Label>
            <Input inputMode="numeric" value={yearStr} disabled={!!preview}
                   onChange={(e) => setYearStr(e.target.value.replace(/\D/g, '').slice(0, 4))} />
          </div>
          <div className="space-y-1.5">
            <Label>Week</Label>
            <Input inputMode="numeric" placeholder="1–53" value={weekStr} disabled={!!preview}
                   onChange={(e) => setWeekStr(e.target.value.replace(/\D/g, '').slice(0, 2))} />
          </div>
        </CardContent>
      </Card>

      {!preview && !previewing && (
        <button
          type="button"
          onClick={() => document.getElementById('wk-file-input')?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragOver(false)
            onFile(e.dataTransfer.files?.[0] ?? null)
          }}
          className={`flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-20 transition-colors ${
            dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/60'
          }`}
        >
          <CloudUpload className="text-muted-foreground h-10 w-10" />
          <div className="text-center">
            <p className="font-medium">Drop the weekly report here, or click to browse</p>
          </div>
          <input id="wk-file-input" type="file" accept=".xlsx" className="hidden"
                 onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        </button>
      )}

      {previewing && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-20">
            <Loader2 className="text-primary h-8 w-8 animate-spin" />
            <p className="font-medium">Reading and cleaning {file?.name}</p>
            <p className="text-muted-foreground text-sm tabular-nums">
              {(elapsed / 1000).toFixed(1)}s — checking every sheet&apos;s arithmetic against itself
            </p>
          </CardContent>
        </Card>
      )}

      {/* step 2: the Silver preview */}
      {preview && (
        <>
          {/* verdict strip */}
          <Card>
            <CardContent className="space-y-3 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <FileSpreadsheet className="text-muted-foreground h-4 w-4" />
                <span className="font-medium">{preview.file_name}</span>
                <span className="text-muted-foreground text-xs">
                  {(preview.file_size / 1024 / 1024).toFixed(1)} MB
                </span>
                {preview.drift.clean ? (
                  <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                    <ShieldCheck className="mr-1 h-3 w-3" /> all 16 sheets present
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="bg-red-100 text-red-800">
                    sheets missing: {preview.drift.missing.join(', ') || '—'}
                  </Badge>
                )}
                {preview.identity_warning ? (
                  <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                    <CircleAlert className="mr-1 h-3 w-3" /> identity mismatch
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                    <CheckCircle2 className="mr-1 h-3 w-3" /> matches selected project
                  </Badge>
                )}
                <Badge variant="outline">
                  {warnCount === 0 ? 'no notes' : `${warnCount} note${warnCount > 1 ? 's' : ''}`}
                </Badge>
              </div>
              <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span>Workbook says: <b className="text-foreground">{String(idy.short_name ?? '—')}</b></span>
                <span>Client: <b className="text-foreground">{String(idy.client_raw ?? '—')}</b></span>
                {idy.original_contract_amount != null && (
                  <span>Contract: <b className="text-foreground tabular-nums">₦{fmtN(idy.original_contract_amount)}</b></span>
                )}
              </div>
              {preview.identity_warning && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  {preview.identity_warning}
                </p>
              )}
            </CardContent>
          </Card>

          {/* sheet tabs — like the Excel bottom strip */}
          <div className="border-border -mb-2 flex gap-1 overflow-x-auto border-b pb-0">
            {SHEET_ORDER.filter((n) => preview.sheets[n]).map((name) => {
              const s = preview.sheets[name]
              const on = activeSheet === name
              const dot =
                s.kind === 'stored_only' ? 'bg-muted-foreground/40'
                : s.warnings.length ? 'bg-amber-500'
                : 'bg-emerald-500'
              return (
                <button
                  key={name}
                  onClick={() => setActiveSheet(name)}
                  className={`-mb-px flex shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 text-xs font-medium transition-colors ${
                    on ? 'bg-background border-border text-foreground'
                       : 'text-muted-foreground border-transparent hover:text-foreground'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                  {SHORT_NAMES[name] ?? name}
                </button>
              )
            })}
          </div>

          <SheetPanel name={activeSheet} sheet={preview.sheets[activeSheet]} />

          {/* accept bar */}
          <div className="bg-background/95 sticky bottom-0 -mx-2 flex flex-wrap items-center justify-between gap-3 border-t px-2 py-3 backdrop-blur">
            <p className="text-muted-foreground text-sm">
              Accepting saves the cleaned data for{' '}
              <b className="text-foreground">
                {projects.find((p) => p.id === projectId)?.short_name} · {year} W{String(week).padStart(2, '0')}
              </b>{' '}
              and keeps the original file forever.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" disabled={accepting}
                      onClick={() => { setPreview(null); setFile(null) }}>
                <X className="mr-1.5 h-4 w-4" /> Discard
              </Button>
              <Button onClick={accept} disabled={accepting}>
                {accepting
                  ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                Accept &amp; Save
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── per-sheet panel ───────────────────────────────────────────────────────
function SheetPanel({ name, sheet }: { name: string; sheet?: SheetPreview }) {
  if (!sheet) return null

  return (
    <Card className="rounded-tl-none">
      <CardContent className="space-y-4 p-5">
        <p className="text-muted-foreground text-sm">{cleaningLine(name, sheet)}</p>

        {sheet.warnings.length > 0 && (
          <div className="space-y-1.5">
            {sheet.warnings.map((w) => (
              <p key={w} className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {w}
              </p>
            ))}
          </div>
        )}

        {sheet.cross_checks && sheet.cross_checks.length === 0 && sheet.kind === 'parsed' && (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            ✓ Every total on this sheet reconciles with our own arithmetic.
          </p>
        )}

        {sheet.kind === 'parsed' && sheet.rows && sheet.rows.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {Object.keys(sheet.rows[0]).slice(0, 10).map((k) => (
                    <TableHead key={k} className="whitespace-nowrap text-xs">
                      {k.replace(/_/g, ' ')}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sheet.rows.slice(0, 40).map((r, i) => (
                  <TableRow key={i}>
                    {Object.entries(r).slice(0, 10).map(([k, v]) => (
                      <TableCell key={k} className="max-w-[220px] truncate whitespace-nowrap text-xs tabular-nums">
                        {typeof v === 'number' ? fmtN(v) : String(v ?? '—')}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {(sheet.total_rows ?? 0) > 40 && (
              <p className="text-muted-foreground border-t px-3 py-2 text-xs">
                Showing 40 of {sheet.total_rows} rows — all {sheet.total_rows} are saved on Accept.
              </p>
            )}
          </div>
        )}

        {sheet.kind === 'stored_only' && (sheet.grid?.length ?? 0) > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <tbody>
                {sheet.grid!.map((row, i) => (
                  <tr key={i} className={i === 0 ? 'bg-muted/50 font-medium' : 'border-t'}>
                    {row.map((c, j) => (
                      <td key={j} className="max-w-[200px] truncate px-2 py-1">{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {sheet.kind === 'parsed' && (!sheet.rows || sheet.rows.length === 0)
          && name !== 'Contract Summary' && name !== 'Lists' && (
          <p className="text-muted-foreground text-sm italic">No rows this week.</p>
        )}
      </CardContent>
    </Card>
  )
}
