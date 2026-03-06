'use client'

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { format, parseISO, addDays, subDays } from 'date-fns'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Send,
  Loader2,
  Check,
  AlertCircle,
  Search,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useDraft,
  useUpsertDraftRow,
  useUpsertDraftRowSingle,
  useRemoveDraftRow,
  useSubmitDraft,
  useSiteLocations,
  useCheckNewPlant,
  useRequestPlantTransfer,
  type DraftRow,
  type DraftRowUpsert,
} from '@/hooks/use-site-report'
import { useAuth } from '@/providers/auth-provider'
import { getErrorMessage } from '@/lib/api/client'
import { toast } from 'sonner'
import { useDebounce } from '@/hooks/use-debounce'

// ============================================================================
// Constants
// ============================================================================

const CONDITIONS = [
  { value: 'working', label: 'Working' },
  { value: 'standby', label: 'Standby' },
  { value: 'breakdown', label: 'Breakdown' },
  { value: 'missing', label: 'Missing' },
  { value: 'faulty', label: 'Faulty' },
  { value: 'scrap', label: 'Scrap' },
  { value: 'off_hire', label: 'Off Hire' },
  { value: 'unverified', label: 'Unverified' },
  { value: 'others', label: 'Others' },
]

const CONDITION_COLORS: Record<string, string> = {
  working: 'text-emerald-600',
  standby: 'text-amber-600',
  breakdown: 'text-red-600',
  missing: 'text-purple-600',
  faulty: 'text-orange-600',
  scrap: 'text-gray-500',
  off_hire: 'text-gray-600',
  unverified: 'text-blue-600',
  others: 'text-muted-foreground',
}

// ============================================================================
// Helpers
// ============================================================================

/** Return the Sunday of the week containing `fromDate` (or today).
 *  Mon–Sat → upcoming Sunday (end of this week)
 *  Sun     → today
 */
function getCurrentWeekSunday(fromDate?: Date): string {
  const d = fromDate ? new Date(fromDate) : new Date()
  const day = d.getDay() // 0=Sun,1=Mon,...,6=Sat
  const offset = (7 - day) % 7   // 0 if today is Sun, else days until next Sun
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function prevSunday(dateStr: string): string {
  const d = parseISO(dateStr + 'T00:00:00')
  return getCurrentWeekSunday(subDays(d, 7))
}

function nextSunday(dateStr: string): string {
  const d = parseISO(dateStr + 'T00:00:00')
  const candidate = getCurrentWeekSunday(addDays(d, 7))
  const cap = getCurrentWeekSunday()   // current week's Sunday — cannot go beyond
  return candidate <= cap ? candidate : cap
}

function formatWeekDate(dateStr: string): string {
  return format(parseISO(dateStr + 'T00:00:00'), 'dd MMM yyyy')
}

// ============================================================================
// Main page (wrapped for Suspense around useSearchParams)
// ============================================================================

function WeeklyReportContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { user } = useAuth()

  const defaultWeek = getCurrentWeekSunday()
  const [weekEnding, setWeekEnding] = useState(searchParams.get('week') ?? defaultWeek)

  // Keep URL in sync
  useEffect(() => {
    router.replace(`/site/report?week=${weekEnding}`, { scroll: false })
  }, [weekEnding, router])

  const { data: draft, isLoading: draftLoading } = useDraft(weekEnding)
  const { data: locations = [] } = useSiteLocations()

  // Batched mutation — queues changes and flushes every 600ms in a single request
  const upsertMutation = useUpsertDraftRow(weekEnding, draft?.id)
  const removeMutation = useRemoveDraftRow(weekEnding)
  const submitMutation = useSubmitDraft()

  const [search, setSearch] = useState('')
  const [addPlantOpen, setAddPlantOpen] = useState(false)

  const rows = draft?.rows ?? []
  const isSubmitted = draft?.status === 'submitted'
  const today = getCurrentWeekSunday()
  const isSaving = upsertMutation.isPending || removeMutation.isPending
  const saveError = upsertMutation.isError

  // Search filter
  const debouncedSearch = useDebounce(search, 200)
  const filteredRows = debouncedSearch
    ? rows.filter(
        (r) =>
          r.fleet_number.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
          (r.remarks ?? '').toLowerCase().includes(debouncedSearch.toLowerCase())
      )
    : rows

  const transferRows = rows.filter((r) => r.transfer_to_location_id)

  const handleSubmit = async () => {
    // Flush any queued saves before submitting
    await upsertMutation.flushNow()
    submitMutation.mutate(weekEnding, {
      onSuccess: (res) => {
        toast.success(
          `Report submitted — ${res.plants_processed} plants processed`
        )
      },
      onError: (err) => toast.error(getErrorMessage(err)),
    })
  }

  const siteName = user?.full_name ? `${user.full_name}'s Site` : 'My Site'

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Weekly Report</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{siteName}</p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setWeekEnding(prevSunday(weekEnding))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-sm font-medium px-2 min-w-[130px] text-center">
            <span className="text-xs text-muted-foreground block">Week Ending</span>
            {formatWeekDate(weekEnding)}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={weekEnding >= today}
            onClick={() => setWeekEnding(nextSunday(weekEnding))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Draft status + toolbar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search fleet number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 w-52 text-sm"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Save indicator */}
          <SaveIndicator isSaving={isSaving} isError={saveError} />
        </div>

        <div className="flex items-center gap-2">
          {isSubmitted ? (
            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">
              <Check className="h-3 w-3 mr-1" /> Submitted
            </Badge>
          ) : (
            <>
              {!isSubmitted && rows.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-muted-foreground"
                  disabled={draftLoading}
                  onClick={() => setAddPlantOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Plant
                </Button>
              )}

              <SubmitDialog
                rowCount={rows.length}
                transferCount={transferRows.length}
                transferRows={transferRows}
                locations={locations}
                isSubmitting={submitMutation.isPending}
                isSaving={isSaving}
                onSubmit={handleSubmit}
              />
            </>
          )}
        </div>
      </div>

      {/* Table */}
      {draftLoading ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState onAddPlant={() => setAddPlantOpen(true)} isSubmitted={isSubmitted} />
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 w-[110px]">Fleet No.</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 w-[140px]">Condition</th>
                  <th className="text-center text-xs font-medium text-muted-foreground px-3 py-2 w-[70px]">Phys. Ver.</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-3 py-2 w-[80px]">Hrs Worked</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-3 py-2 w-[80px]">Standby</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-3 py-2 w-[80px]">Breakdown</th>
                  <th className="text-center text-xs font-medium text-muted-foreground px-3 py-2 w-[70px]">Off Hire</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 w-[160px]">Transfer To</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2">Remarks</th>
                  {!isSubmitted && <th className="w-[40px]" />}
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredRows.map((row) => (
                  <ReportRow
                    key={row.fleet_number}
                    row={row}
                    locations={locations}
                    disabled={isSubmitted}
                    onUpsert={upsertMutation.mutate}
                    onRemove={!isSubmitted ? removeMutation.mutate : undefined}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Footer info */}
      {rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {filteredRows.length} of {rows.length} plant{rows.length !== 1 ? 's' : ''} shown
          {transferRows.length > 0 && (
            <span className="ml-2 text-amber-600">
              · {transferRows.length} transfer{transferRows.length !== 1 ? 's' : ''} pending
            </span>
          )}
        </p>
      )}

      {/* Add Plant Dialog */}
      <AddPlantDialog
        open={addPlantOpen}
        onOpenChange={setAddPlantOpen}
        weekEnding={weekEnding}
        existingFleetNumbers={new Set(rows.map((r) => r.fleet_number))}
      />
    </div>
  )
}

// ============================================================================
// ReportRow — individual editable row
// ============================================================================

function ReportRow({
  row,
  locations,
  disabled,
  onUpsert,
  onRemove,
}: {
  row: DraftRow
  locations: Array<{ id: string; name: string }>
  disabled: boolean
  onUpsert: (patch: DraftRowUpsert) => void
  onRemove?: (fleetNumber: string) => void
}) {
  // ── Local state for ALL fields — gives instant visual feedback ──────────
  // These are initialised from the server row and only re-synced when the
  // fleet_number changes (i.e. a completely new row / week switch).
  const [condition, setCondition] = useState(row.condition ?? '')
  const [physVerified, setPhysVerified] = useState(row.physical_verification ?? false)
  const [offHire, setOffHire] = useState(row.off_hire ?? false)
  const [transferTo, setTransferTo] = useState(row.transfer_to_location_id ?? '')
  const [hoursWorked, setHoursWorked] = useState(row.hours_worked?.toString() ?? '')
  const [standbyHours, setStandbyHours] = useState(row.standby_hours?.toString() ?? '')
  const [breakdownHours, setBreakdownHours] = useState(row.breakdown_hours?.toString() ?? '')
  const [remarks, setRemarks] = useState(row.remarks ?? '')

  // Re-sync from server when switching to a different fleet row or week
  useEffect(() => {
    setCondition(row.condition ?? '')
    setPhysVerified(row.physical_verification ?? false)
    setOffHire(row.off_hire ?? false)
    setTransferTo(row.transfer_to_location_id ?? '')
    setHoursWorked(row.hours_worked?.toString() ?? '')
    setStandbyHours(row.standby_hours?.toString() ?? '')
    setBreakdownHours(row.breakdown_hours?.toString() ?? '')
    setRemarks(row.remarks ?? '')
  }, [row.fleet_number]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced numeric/text fields — 400ms is fast enough to save before Submit
  const debouncedHoursWorked = useDebounce(hoursWorked, 400)
  const debouncedStandbyHours = useDebounce(standbyHours, 400)
  const debouncedBreakdownHours = useDebounce(breakdownHours, 400)
  const debouncedRemarks = useDebounce(remarks, 400)

  // ── Ref tracks the latest field values so `save` always sends a FULL row ──
  // Partial saves were overwriting other columns with null in the DB because
  // DO UPDATE SET writes every column, even those not in the patch.
  const fieldsRef = useRef({
    condition, physVerified, offHire, transferTo,
    hoursWorked, standbyHours, breakdownHours, remarks,
  })
  fieldsRef.current = { condition, physVerified, offHire, transferTo, hoursWorked, standbyHours, breakdownHours, remarks }

  const isFirstRender = useRef(true)

  // Stable save — always sends all current field values; accepts overrides for
  // the field(s) that just changed (avoids stale closure on the changing field).
  const save = useCallback(
    (overrides: Partial<DraftRowUpsert> = {}) => {
      if (disabled) return
      const f = fieldsRef.current
      onUpsert({
        fleet_number: row.fleet_number,
        condition: (overrides.condition ?? f.condition) || null,
        physical_verification: overrides.physical_verification ?? f.physVerified,
        hours_worked: overrides.hours_worked !== undefined
          ? overrides.hours_worked
          : (f.hoursWorked !== '' ? Number(f.hoursWorked) : null),
        standby_hours: overrides.standby_hours !== undefined
          ? overrides.standby_hours
          : (f.standbyHours !== '' ? Number(f.standbyHours) : null),
        breakdown_hours: overrides.breakdown_hours !== undefined
          ? overrides.breakdown_hours
          : (f.breakdownHours !== '' ? Number(f.breakdownHours) : null),
        off_hire: overrides.off_hire ?? f.offHire,
        transfer_to_location_id: (overrides.transfer_to_location_id ?? f.transferTo) || null,
        remarks: (overrides.remarks ?? f.remarks) || null,
      } as DraftRowUpsert)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [disabled, row.fleet_number, onUpsert]
  )

  // Fire save when debounced numeric/text values settle — pass as overrides so
  // we use the settled (debounced) values, not the potentially mid-type ref value.
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    save({
      hours_worked: debouncedHoursWorked !== '' ? Number(debouncedHoursWorked) : null,
      standby_hours: debouncedStandbyHours !== '' ? Number(debouncedStandbyHours) : null,
      breakdown_hours: debouncedBreakdownHours !== '' ? Number(debouncedBreakdownHours) : null,
      remarks: debouncedRemarks || null,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedHoursWorked, debouncedStandbyHours, debouncedBreakdownHours, debouncedRemarks])

  const conditionColor = condition ? (CONDITION_COLORS[condition] ?? '') : 'text-muted-foreground'

  return (
    <tr className="hover:bg-muted/20 transition-colors">
      {/* Fleet number */}
      <td className="px-3 py-1.5">
        <span className="font-mono font-medium text-sm">{row.fleet_number}</span>
        {row.is_new_plant && (
          <Badge variant="outline" className="ml-1 text-[10px] h-4 px-1 bg-blue-50 text-blue-700 border-blue-200">
            New
          </Badge>
        )}
      </td>

      {/* Condition */}
      <td className="px-2 py-1">
        <Select
          value={condition}
          onValueChange={(v) => {
            setCondition(v)
            save({ condition: v as DraftRowUpsert['condition'] })  // save sends full row
          }}
          disabled={disabled}
        >
          <SelectTrigger className={`h-7 text-xs border-0 bg-transparent shadow-none focus:ring-0 px-0 ${conditionColor}`}>
            <SelectValue placeholder="— select —" />
          </SelectTrigger>
          <SelectContent>
            {CONDITIONS.map((c) => (
              <SelectItem key={c.value} value={c.value} className="text-xs">
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>

      {/* Physical verification */}
      <td className="px-3 py-1 text-center">
        <input
          type="checkbox"
          checked={physVerified}
          onChange={(e) => {
            setPhysVerified(e.target.checked)
            save({ physical_verification: e.target.checked })  // save sends full row
          }}
          disabled={disabled}
          className="h-4 w-4 rounded border-gray-300 accent-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </td>

      {/* Hours worked */}
      <td className="px-2 py-1">
        <Input
          type="number"
          min="0"
          step="0.5"
          value={hoursWorked}
          onChange={(e) => setHoursWorked(e.target.value)}
          disabled={disabled}
          className="h-7 text-xs text-right w-full border-0 bg-transparent shadow-none focus-visible:ring-0 px-1"
          placeholder="0"
        />
      </td>

      {/* Standby hours */}
      <td className="px-2 py-1">
        <Input
          type="number"
          min="0"
          step="0.5"
          value={standbyHours}
          onChange={(e) => setStandbyHours(e.target.value)}
          disabled={disabled}
          className="h-7 text-xs text-right w-full border-0 bg-transparent shadow-none focus-visible:ring-0 px-1"
          placeholder="0"
        />
      </td>

      {/* Breakdown hours */}
      <td className="px-2 py-1">
        <Input
          type="number"
          min="0"
          step="0.5"
          value={breakdownHours}
          onChange={(e) => setBreakdownHours(e.target.value)}
          disabled={disabled}
          className="h-7 text-xs text-right w-full border-0 bg-transparent shadow-none focus-visible:ring-0 px-1"
          placeholder="0"
        />
      </td>

      {/* Off Hire */}
      <td className="px-3 py-1 text-center">
        <input
          type="checkbox"
          checked={offHire}
          onChange={(e) => {
            setOffHire(e.target.checked)
            save({ off_hire: e.target.checked })  // save sends full row
          }}
          disabled={disabled}
          className="h-4 w-4 rounded border-gray-300 accent-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </td>

      {/* Transfer To */}
      <td className="px-2 py-1">
        <Select
          value={transferTo || '__none__'}
          onValueChange={(v) => {
            const val = v === '__none__' ? '' : v
            setTransferTo(val)
            save({ transfer_to_location_id: val || null })  // save sends full row
          }}
          disabled={disabled}
        >
          <SelectTrigger className="h-7 text-xs border-0 bg-transparent shadow-none focus:ring-0 px-0 text-left">
            <SelectValue placeholder="— none —" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__" className="text-xs text-muted-foreground">— none —</SelectItem>
            {locations.map((l) => (
              <SelectItem key={l.id} value={l.id} className="text-xs">
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>

      {/* Remarks */}
      <td className="px-2 py-1">
        <Input
          type="text"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          disabled={disabled}
          className="h-7 text-xs w-full border-0 bg-transparent shadow-none focus-visible:ring-0 px-1"
          placeholder="Optional remarks..."
        />
      </td>

      {/* Remove */}
      {onRemove && (
        <td className="px-1 py-1 text-right">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove Plant</AlertDialogTitle>
                <AlertDialogDescription>
                  Remove <strong>{row.fleet_number}</strong> from this week&apos;s report? The plant
                  will remain in the database — it just won&apos;t be included in this submission.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => onRemove(row.fleet_number)}
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </td>
      )}
    </tr>
  )
}

// ============================================================================
// Add Plant Dialog
// ============================================================================

function AddPlantDialog({
  open,
  onOpenChange,
  weekEnding,
  existingFleetNumbers,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  weekEnding: string
  existingFleetNumbers: Set<string>
}) {
  const [fleetNumber, setFleetNumber] = useState('')
  const [description, setDescription] = useState('')
  const [checkResult, setCheckResult] = useState<{ available: boolean; message?: string; current_location?: string } | null>(null)
  const [transferRequested, setTransferRequested] = useState(false)
  const checkMutation = useCheckNewPlant()
  const upsertMutation = useUpsertDraftRowSingle(weekEnding)
  const requestTransferMutation = useRequestPlantTransfer()

  const debouncedFleet = useDebounce(fleetNumber.trim().toUpperCase(), 600)

  useEffect(() => {
    setCheckResult(null)
    setTransferRequested(false)
    if (!debouncedFleet || debouncedFleet.length < 2) return
    if (existingFleetNumbers.has(debouncedFleet)) {
      setCheckResult({ available: false, message: `${debouncedFleet} is already in this report` })
      return
    }
    checkMutation.mutate(debouncedFleet, {
      onSuccess: (r) => setCheckResult(r),
      onError: () => setCheckResult(null),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedFleet])

  const handleAdd = () => {
    if (!fleetNumber.trim()) return
    const fn = fleetNumber.trim().toUpperCase()
    upsertMutation.mutate(
      {
        fleet_number: fn,
        is_new_plant: checkResult?.available === true && !checkResult.message?.includes('registered at your site'),
        plant_description: description.trim() || undefined,
      },
      {
        onSuccess: () => {
          onOpenChange(false)
          setFleetNumber('')
          setDescription('')
          setCheckResult(null)
          setTransferRequested(false)
        },
        onError: (err) => toast.error(getErrorMessage(err)),
      }
    )
  }

  const handleRequestTransfer = () => {
    const fn = fleetNumber.trim().toUpperCase()
    requestTransferMutation.mutate(fn, {
      onSuccess: (res) => {
        toast.success(res.message ?? 'Transfer request sent')
        setTransferRequested(true)
        onOpenChange(false)
        setFleetNumber('')
        setCheckResult(null)
        setTransferRequested(false)
      },
      onError: (err) => toast.error(getErrorMessage(err)),
    })
  }

  const canAdd =
    fleetNumber.trim().length >= 2 &&
    !upsertMutation.isPending &&
    checkResult !== null &&
    checkResult.available === true

  // Plant is at a DIFFERENT site (not a new plant and not available)
  const isAtAnotherSite =
    checkResult !== null &&
    !checkResult.available &&
    checkResult.current_location !== undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Plant</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <label className="text-sm font-medium">Fleet Number</label>
            <Input
              placeholder="e.g. EG001"
              value={fleetNumber}
              onChange={(e) => setFleetNumber(e.target.value.toUpperCase())}
              className="font-mono uppercase"
              autoFocus
            />
          </div>

          {checkMutation.isPending && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking…
            </div>
          )}

          {checkResult && !checkMutation.isPending && (
            <div
              className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs ${
                checkResult.available
                  ? 'bg-emerald-50 text-emerald-800'
                  : isAtAnotherSite
                    ? 'bg-amber-50 text-amber-800'
                    : 'bg-red-50 text-red-800'
              }`}
            >
              {checkResult.available ? (
                <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              )}
              <div className="space-y-1.5">
                <span>{checkResult.message ?? (checkResult.available ? 'Plant is available to add' : 'Plant is not available')}</span>
                {isAtAnotherSite && !transferRequested && (
                  <div>
                    <button
                      onClick={handleRequestTransfer}
                      disabled={requestTransferMutation.isPending}
                      className="text-xs font-medium underline underline-offset-2 hover:no-underline disabled:opacity-50"
                    >
                      {requestTransferMutation.isPending ? (
                        <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Sending request…</span>
                      ) : (
                        'Request transfer from that site →'
                      )}
                    </button>
                  </div>
                )}
                {transferRequested && (
                  <span className="text-emerald-700 font-medium">Transfer request sent ✓</span>
                )}
              </div>
            </div>
          )}

          {checkResult?.available && (
            <div className="space-y-1">
              <label className="text-sm font-medium">Description <span className="text-muted-foreground font-normal">(for new plant)</span></label>
              <Input
                placeholder="e.g. 200KVA Generator"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canAdd || upsertMutation.isPending} onClick={handleAdd}>
            {upsertMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Add to Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// Submit Dialog
// ============================================================================

function SubmitDialog({
  rowCount,
  transferCount,
  transferRows,
  locations,
  isSubmitting,
  isSaving,
  onSubmit,
}: {
  rowCount: number
  transferCount: number
  transferRows: DraftRow[]
  locations: Array<{ id: string; name: string }>
  isSubmitting: boolean
  isSaving: boolean
  onSubmit: () => void
}) {
  const locationMap = Object.fromEntries(locations.map((l) => [l.id, l.name]))

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" className="h-8" disabled={rowCount === 0 || isSubmitting || isSaving}>
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <Send className="h-4 w-4 mr-1" />
          )}
          Submit Report
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Submit Weekly Report</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                This will submit the report for <strong>{rowCount}</strong> plant
                {rowCount !== 1 ? 's' : ''} and process it immediately into the database.
                This action cannot be undone.
              </p>
              {transferCount > 0 && (
                <div className="rounded-md border bg-amber-50 px-3 py-2">
                  <p className="text-sm font-medium text-amber-800 mb-1">
                    {transferCount} plant{transferCount !== 1 ? 's' : ''} marked for transfer:
                  </p>
                  <ul className="text-xs text-amber-700 space-y-0.5 list-disc list-inside">
                    {transferRows.map((r) => (
                      <li key={r.fleet_number}>
                        <span className="font-mono">{r.fleet_number}</span>
                        {' → '}
                        {r.transfer_to_location_id
                          ? (locationMap[r.transfer_to_location_id] ?? 'Unknown site')
                          : '—'}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-amber-600 mt-1.5">
                    Transfer requests will be sent to the destination sites for confirmation.
                  </p>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onSubmit}>
            Submit Report
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ============================================================================
// Save Indicator
// ============================================================================

function SaveIndicator({ isSaving, isError }: { isSaving: boolean; isError: boolean }) {
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const prevSaving = useRef(false)

  useEffect(() => {
    // Only mark as saved when transitioning from saving→done WITHOUT an error
    if (prevSaving.current && !isSaving && !isError) {
      setLastSaved(new Date())
    }
    prevSaving.current = isSaving
  }, [isSaving, isError])

  if (isSaving) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Saving…
      </span>
    )
  }
  if (isError) {
    return (
      <span className="flex items-center gap-1 text-xs text-red-500">
        <AlertCircle className="h-3 w-3" />
        Save failed
      </span>
    )
  }
  if (lastSaved) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Check className="h-3 w-3 text-emerald-500" />
        Saved
      </span>
    )
  }
  return null
}

// ============================================================================
// Empty state
// ============================================================================

function EmptyState({ onAddPlant, isSubmitted }: { onAddPlant: () => void; isSubmitted: boolean }) {
  return (
    <div className="border rounded-lg p-12 text-center">
      <div className="mx-auto mb-4 text-muted-foreground opacity-40">
        <svg viewBox="0 0 24 24" fill="none" className="h-12 w-12 mx-auto" stroke="currentColor" strokeWidth={1.5}>
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <p className="text-base font-medium text-muted-foreground">No plants in this report</p>
      <p className="text-sm text-muted-foreground mt-1">
        {isSubmitted
          ? 'This report has been submitted with no plants.'
          : 'Plants at your site are pre-loaded. If none appear, use Add Plant to add them manually.'}
      </p>
      {!isSubmitted && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onAddPlant}>
          <Plus className="h-4 w-4 mr-1" />
          Add Plant
        </Button>
      )}
    </div>
  )
}

// ============================================================================
// Table skeleton
// ============================================================================

function TableSkeleton() {
  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 border-b">
            {['Fleet No.', 'Condition', 'Phys. Ver.', 'Hrs Worked', 'Standby', 'Breakdown', 'Off Hire', 'Transfer To', 'Remarks'].map((h) => (
              <th key={h} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {Array.from({ length: 6 }).map((_, i) => (
            <tr key={i} className="hover:bg-muted/20">
              {Array.from({ length: 9 }).map((_, j) => (
                <td key={j} className="px-3 py-2">
                  <Skeleton className="h-5 w-full" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ============================================================================
// Export with Suspense boundary for useSearchParams
// ============================================================================

export default function WeeklyReportPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-8 w-32" />
          <TableSkeleton />
        </div>
      }
    >
      <WeeklyReportContent />
    </Suspense>
  )
}
