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
  bills?: { bill_code: string; name: string; sheet_total_contract?: number | null; sheet_total_this_week?: number | null }[]
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
  declared: {
    week_number: number | null
    year: number | null
    week_ending_date: string | null
    consistent: boolean
    votes: number
    disagreements: { sheet: string; week: number; date: string }[]
  }
  matched_project: { id: string; short_name: string; project_name: string } | null
  already_ingested: boolean
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

  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  // detection overrides (only for the rare unmatched / mislabeled cases)
  const [overrideProjectId, setOverrideProjectId] = useState('')
  const [overrideAck, setOverrideAck] = useState(false)
  const [manualWeek, setManualWeek] = useState(false)
  const [manualWeekStr, setManualWeekStr] = useState('')
  const [manualYearStr, setManualYearStr] = useState('')

  const [previewing, setPreviewing] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [activeSheet, setActiveSheet] = useState(SHEET_ORDER[0])
  const [accepting, setAccepting] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const runPreview = useCallback(async (f: File) => {
    setPreviewing(true)
    setPreview(null)
    setElapsed(0)
    const t0 = performance.now()
    timerRef.current = setInterval(
      () => setElapsed(performance.now() - t0), 100)
    try {
      const form = new FormData()
      form.append('file', f)
      const res = await apiClient.post('/projects/preview-weekly-report', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000,
      })
      setPreview(res.data.data)
      setOverrideProjectId('')
      setOverrideAck(false)
      setManualWeek(false)
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
    setFile(f)
    void runPreview(f)
  }, [runPreview])

  const warnCount = useMemo(() => {
    if (!preview) return 0
    return Object.values(preview.sheets)
      .reduce((a, s) => a + (s.warnings?.length ?? 0), 0)
      + (preview.identity_warning ? 1 : 0)
  }, [preview])

  const resolvedProjectId = preview?.matched_project?.id ?? overrideProjectId
  const projectResolved = !!preview?.matched_project ||
    (!!overrideProjectId && overrideAck)
  const effYear = manualWeek
    ? Number(manualYearStr) || 0 : preview?.declared.year ?? 0
  const effWeek = manualWeek
    ? Number(manualWeekStr) || 0 : preview?.declared.week_number ?? 0
  const weekResolved = manualWeek
    ? effWeek >= 1 && effWeek <= 53 && effYear >= 2020
    : !!preview?.declared.consistent && !!preview?.declared.week_number
  const canAccept = projectResolved && weekResolved && !accepting

  const accept = async () => {
    if (!file || !resolvedProjectId) return
    setAccepting(true)
    upload.mutate(
      { file, projectId: resolvedProjectId, year: effYear, weekNumber: effWeek },
      {
        onSuccess: () => {
          toast.success(`${effYear} · Week ${effWeek} accepted — saving to the database`)
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
          </div>
        </div>
        {preview && (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Timer className="h-4 w-4" />
            Parsed 16 sheets in <b className="text-foreground">{(preview.parse_ms / 1000).toFixed(1)}s</b>
          </div>
        )}
      </div>

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
          {/* detection card — the workbook is the truth */}
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <FileSpreadsheet className="text-muted-foreground h-4 w-4" />
                <span className="font-medium break-all">{preview.file_name}</span>
                <span className="text-muted-foreground text-xs">
                  {(preview.file_size / 1024 / 1024).toFixed(1)} MB
                </span>
                {preview.drift.clean ? (
                  <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                    <ShieldCheck className="mr-1 h-3 w-3" /> all 16 sheets present
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200">
                    {preview.drift.missing.length} of 16 sheets missing
                  </Badge>
                )}
                <Badge variant="outline">
                  {warnCount === 0 ? 'no notes' : `${warnCount} note${warnCount > 1 ? 's' : ''}`}
                </Badge>
              </div>

              {preview.drift.missing.length >= 8 && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
                  This doesn&apos;t look like the company&apos;s 16-sheet weekly report —
                  check you picked the right file. Missing:{' '}
                  <span className="break-words">{preview.drift.missing.join(', ')}</span>
                </p>
              )}
              {!preview.drift.clean && preview.drift.missing.length < 8 && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm break-words text-red-900 dark:bg-red-950 dark:text-red-200">
                  Missing sheets: {preview.drift.missing.join(', ')}
                </p>
              )}

              {/* what the workbook says it is */}
              <div className="rounded-lg border p-4">
                <p className="text-lg font-semibold">
                  {String(idy.short_name ?? 'Unknown project')}
                  <span className="text-muted-foreground font-normal">
                    {' '}— Week {preview.declared.week_number ?? '?'},{' '}
                    {preview.declared.year ?? '?'}
                    {preview.declared.week_ending_date &&
                      ` (week ending ${new Date(preview.declared.week_ending_date)
                        .toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })})`}
                  </span>
                </p>
                <p className="text-muted-foreground mt-0.5 text-sm">
                  Client {String(idy.client_raw ?? '—')}
                  {idy.original_contract_amount != null &&
                    <> · Contract <b className="text-foreground tabular-nums">₦{fmtN(idy.original_contract_amount)}</b></>}
                  {' '}· {preview.declared.votes} sheets declare this week
                  {preview.declared.consistent ? ' unanimously' : ''}
                </p>

                <div className="mt-3 space-y-2">
                  {/* project resolution */}
                  {preview.matched_project ? (
                    <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" />
                      Matched in your register — saves to{' '}
                      <b>{preview.matched_project.short_name}</b>
                    </p>
                  ) : (
                    <div className="space-y-2 rounded-md bg-amber-50 p-3 dark:bg-amber-950">
                      <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                        This project isn&apos;t in your register yet.
                      </p>
                      <p className="text-sm text-amber-900/80 dark:text-amber-200/80">
                        <Link href="/projects/create" className="underline">Create it</Link>{' '}
                        (recommended — use the short name above), or save against an existing project:
                      </p>
                      <Select value={overrideProjectId} onValueChange={setOverrideProjectId}>
                        <SelectTrigger className="bg-background max-w-sm">
                          <SelectValue placeholder="Select a project (override)" />
                        </SelectTrigger>
                        <SelectContent>
                          {projects.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.short_name || p.project_name.slice(0, 50)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {overrideProjectId && (
                        <label className="flex items-start gap-2 text-sm text-amber-900 dark:text-amber-200">
                          <input type="checkbox" className="mt-0.5" checked={overrideAck}
                                 onChange={(e) => setOverrideAck(e.target.checked)} />
                          I understand the workbook says{' '}
                          <b>{String(idy.short_name ?? '?')}</b> and I&apos;m saving it
                          against a different project.
                        </label>
                      )}
                    </div>
                  )}

                  {/* week resolution */}
                  {!preview.declared.consistent && preview.declared.votes > 0 && (
                    <div className="rounded-md bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
                      <p className="font-medium">The sheets disagree about which week this is — saving is blocked.</p>
                      <ul className="mt-1 list-inside list-disc">
                        {preview.declared.disagreements.slice(0, 5).map((d) => (
                          <li key={d.sheet}>{d.sheet}: week {d.week}, {d.date}</li>
                        ))}
                      </ul>
                      <p className="mt-1">Ask the site which week this file is — it looks assembled from different weeks.</p>
                    </div>
                  )}
                  {preview.already_ingested && (
                    <p className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                      <CircleAlert className="h-4 w-4" />
                      Week {preview.declared.week_number}, {preview.declared.year} is already in the
                      database — accepting <b>replaces</b> it with this file.
                    </p>
                  )}

                  {/* manual adjust (rare) */}
                  {!manualWeek ? (
                    <button className="text-muted-foreground text-xs underline"
                            onClick={() => setManualWeek(true)}>
                      The workbook mislabels its week? Adjust manually
                    </button>
                  ) : (
                    <div className="flex flex-wrap items-end gap-2 rounded-md bg-amber-50 p-3 dark:bg-amber-950">
                      <div>
                        <Label className="text-xs">Year</Label>
                        <Input inputMode="numeric" className="bg-background h-8 w-24" value={manualYearStr}
                               onChange={(e) => setManualYearStr(e.target.value.replace(/\D/g, '').slice(0, 4))} />
                      </div>
                      <div>
                        <Label className="text-xs">Week</Label>
                        <Input inputMode="numeric" placeholder="1–53" className="bg-background h-8 w-20" value={manualWeekStr}
                               onChange={(e) => setManualWeekStr(e.target.value.replace(/\D/g, '').slice(0, 2))} />
                      </div>
                      <button className="text-muted-foreground pb-2 text-xs underline"
                              onClick={() => setManualWeek(false)}>
                        use the workbook&apos;s own week instead
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* sheet chips — all 16 visible, nothing hidden off-screen */}
          <div className="flex flex-wrap gap-1.5">
            {SHEET_ORDER.filter((n) => preview.sheets[n]).map((name) => {
              const sh = preview.sheets[name]
              const on = activeSheet === name
              const stored = sh.kind === 'stored_only'
              const nWarn = sh.warnings?.length ?? 0
              const count = stored ? null : (sh.total_rows ?? null)
              return (
                <button
                  key={name}
                  onClick={() => setActiveSheet(name)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    on
                      ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                      : stored
                        ? 'border-dashed text-muted-foreground hover:border-foreground/30 hover:text-foreground'
                        : 'bg-card text-foreground/80 hover:border-foreground/30 hover:text-foreground'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    on ? 'bg-primary-foreground/70'
                    : stored ? 'bg-muted-foreground/40'
                    : nWarn ? 'bg-amber-500' : 'bg-emerald-500'
                  }`} />
                  {SHORT_NAMES[name] ?? name}
                  {count !== null && count > 0 && (
                    <span className={`tabular-nums ${on ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                      {count}
                    </span>
                  )}
                  {nWarn > 0 && !on && (
                    <span className="font-semibold text-amber-600 dark:text-amber-400">
                      {nWarn}⚠
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <SheetPanel name={activeSheet} sheet={preview.sheets[activeSheet]} />

          {/* accept bar */}
          <div className="bg-background/95 sticky bottom-0 -mx-2 flex flex-wrap items-center justify-between gap-3 border-t px-2 py-3 backdrop-blur">
            <p className="text-muted-foreground text-sm">
              {projectResolved && weekResolved ? (
                <>Accepting saves{' '}
                  <b className="text-foreground">
                    {preview.matched_project?.short_name
                      ?? projects.find((p) => p.id === overrideProjectId)?.short_name}
                    {' '}· {effYear} W{String(effWeek).padStart(2, '0')}
                  </b>{' '}and keeps the original file forever.</>
              ) : (
                <>Resolve the {!projectResolved ? 'project' : 'week'} above to enable saving.</>
              )}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" disabled={accepting}
                      onClick={() => { setPreview(null); setFile(null) }}>
                <X className="mr-1.5 h-4 w-4" /> Discard
              </Button>
              <Button onClick={accept} disabled={!canAccept}>
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
    <Card>
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
          name === 'BEME & Works Completed Fd'
            ? <BemeTable sheet={sheet} />
            : <GenericTable sheet={sheet} />
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


const HIDDEN_COLS = new Set(['bill_code', 'bill_no', 'dup_seq', 'stock_maintained'])

function num(v: unknown): number { return Number(v) || 0 }

function GenericTable({ sheet }: { sheet: SheetPreview }) {
  const rows = sheet.rows!
  const cols = Object.keys(rows[0]).filter((k) => !HIDDEN_COLS.has(k))
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {cols.map((k) => (
              <TableHead key={k} className="whitespace-nowrap text-xs">
                {k.replace(/_/g, ' ')}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              {cols.map((k) => {
                const v = r[k]
                const isNum = typeof v === 'number'
                return (
                  <TableCell key={k}
                    className={`max-w-[260px] truncate whitespace-nowrap text-xs tabular-nums ${isNum ? 'text-right' : ''}`}>
                    {isNum ? fmtN(v) : String(v ?? '—')}
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-muted-foreground border-t px-3 py-2 text-xs">
        All {rows.length} rows shown — saved on Accept.
      </p>
    </div>
  )
}

function BemeTable({ sheet }: { sheet: SheetPreview }) {
  const rows = sheet.rows!
  const bills = sheet.bills ?? []
  // the workbook's own 14 columns, its own names; cumulative ones computed
  const H = ['Item', 'Description', 'Unit', 'Contract Qty', 'Previous Qty',
             'This Week Qty', 'Total Qty Completed', 'Qty Outstanding',
             'Rate ₦', 'Contract Amount', 'Previous Amount',
             'This Week Amount', 'Total Amount', '% of Work Completed']
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table className="min-w-[1280px]">
        <TableHeader>
          <TableRow>
            {H.map((h, i) => (
              <TableHead key={h}
                className={`whitespace-nowrap text-xs ${i >= 3 && i !== 1 && i !== 2 ? 'text-right' : ''} ${h === 'Description' ? 'min-w-[240px]' : ''}`}>
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {bills.map((b) => {
            const items = rows.filter((r) => r.bill_code === b.bill_code)
            const sumC = items.reduce((a, r) => a + num(r.contract_amount), 0)
            const sumP = items.reduce((a, r) => a + num(r.amount_previous_reported), 0)
            const sumW = items.reduce((a, r) => a + num(r.amount_this_week), 0)
            const sumT = sumP + sumW
            const pct = sumC > 0 ? (sumT / sumC) * 100 : null
            return [
              <TableRow key={b.bill_code} className="bg-muted/60 hover:bg-muted/60">
                <TableCell className="text-xs font-bold whitespace-nowrap">{b.bill_code}</TableCell>
                <TableCell className="text-xs font-bold" colSpan={8}>
                  {b.name} <span className="text-muted-foreground font-normal">· {items.length} items</span>
                </TableCell>
                <TableCell className="text-right text-xs font-bold tabular-nums">{fmtN(sumC)}</TableCell>
                <TableCell className="text-right text-xs font-bold tabular-nums">{fmtN(sumP)}</TableCell>
                <TableCell className="text-right text-xs font-bold tabular-nums">{fmtN(sumW)}</TableCell>
                <TableCell className="text-right text-xs font-bold tabular-nums">{fmtN(sumT)}</TableCell>
                <TableCell className="text-right text-xs font-bold tabular-nums">
                  {pct !== null ? `${pct.toFixed(1)}%` : '—'}
                </TableCell>
              </TableRow>,
              ...items.map((r, i) => {
                const pQ = r.qty_previous_reported == null ? null : num(r.qty_previous_reported)
                const wQ = r.qty_this_week == null ? null : num(r.qty_this_week)
                const totQ = pQ === null && wQ === null ? null : num(pQ) + num(wQ)
                const cQ = r.contract_qty == null ? null : num(r.contract_qty)
                const outQ = cQ !== null && totQ !== null ? cQ - totQ : null
                const pA = num(r.amount_previous_reported)
                const wA = num(r.amount_this_week)
                const totA = pA + wA
                const cA = num(r.contract_amount)
                const ipct = cA > 0 ? (totA / cA) * 100 : null
                const cell = (v: unknown, extra = '') => (
                  <TableCell className={`text-right text-xs whitespace-nowrap tabular-nums ${extra}`}>
                    {v === null || v === undefined ? '—' : fmtN(v)}
                  </TableCell>
                )
                return (
                  <TableRow key={`${b.bill_code}-${i}`}>
                    <TableCell className="text-xs whitespace-nowrap">{String(r.item_code)}</TableCell>
                    <TableCell className="max-w-[320px] truncate text-xs" title={String(r.description)}>
                      {String(r.description)}
                    </TableCell>
                    <TableCell className="text-xs">{String(r.unit ?? '—')}</TableCell>
                    {cell(cQ)}
                    {cell(pQ)}
                    {cell(wQ)}
                    {cell(totQ)}
                    {cell(outQ, outQ !== null && outQ < 0 ? 'text-red-600 dark:text-red-400' : '')}
                    {cell(r.rate == null ? null : num(r.rate))}
                    {cell(cA || null)}
                    {cell(pA || (r.amount_previous_reported == null ? null : 0))}
                    {cell(wA || (r.amount_this_week == null ? null : 0))}
                    {cell(totA || null)}
                    <TableCell className={`text-right text-xs tabular-nums ${ipct !== null && ipct > 100.1 ? 'font-semibold text-red-600 dark:text-red-400' : ''}`}>
                      {ipct !== null ? `${ipct.toFixed(1)}%` : '—'}
                    </TableCell>
                  </TableRow>
                )
              }),
            ]
          })}
        </TableBody>
      </Table>
      <p className="text-muted-foreground border-t px-3 py-2 text-xs">
        All {rows.length} items across {bills.length} bills — the workbook&apos;s own
        columns; Total, Outstanding and % are recomputed live (never copied),
        over-runs shown red and uncapped.
      </p>
    </div>
  )
}
