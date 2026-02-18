'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  MapPin,
  Truck,
  Clock,
  Pencil,
  Trash2,
  CheckCircle,
  XCircle,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  FileText,
  BarChart3,
  AlertTriangle,
  ArrowLeftRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { useAuth } from '@/providers/auth-provider'
import {
  useLocationDetail,
  useLocationPlants,
  useLocationSubmissions,
  useLocationUsage,
  useLocationWeeklyRecords,
  useLocationTransfers,
  useDeleteLocation,
} from '@/hooks/use-locations'
import { getErrorMessage } from '@/lib/api/client'
import type { PlantCondition } from '@/lib/api/plants'
import type { LocationSubmission } from '@/lib/api/locations'

const CONDITION_STYLES: Record<string, { label: string; className: string }> = {
  working: { label: 'Working', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' },
  standby: { label: 'Standby', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' },
  under_repair: { label: 'Under Repair', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  breakdown: { label: 'Breakdown', className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
  faulty: { label: 'Faulty', className: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' },
  scrap: { label: 'Scrap', className: 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
  missing: { label: 'Missing', className: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300' },
  off_hire: { label: 'Off Hire', className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  gpm_assessment: { label: 'GPM Assessment', className: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' },
  unverified: { label: 'Unverified', className: 'bg-muted text-muted-foreground' },
}

const CURRENT_YEAR = new Date().getFullYear()

export default function LocationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const { data: location, isLoading, error } = useLocationDetail(id)
  const deleteMutation = useDeleteLocation()

  // Plants tab state
  const [plantsPage, setPlantsPage] = useState(1)
  const { data: plantsData, isLoading: plantsLoading } = useLocationPlants(id, {
    page: plantsPage,
    limit: 20,
  })

  // Submissions tab state
  const [expandedSub, setExpandedSub] = useState<{ year: number; week: number } | null>(null)
  const { data: submissions = [], isLoading: submissionsLoading } = useLocationSubmissions(id, { limit: 50 })

  // Usage tab state
  const [usagePeriod, setUsagePeriod] = useState<string>(String(CURRENT_YEAR))
  const usageParams = usagePeriod === 'all' ? { period: 'all' as const } : { year: Number(usagePeriod) }
  const { data: usage, isLoading: usageLoading } = useLocationUsage(id, usageParams)

  // Transfers tab state
  const { data: transfersData, isLoading: transfersLoading } = useLocationTransfers(id, { limit: 100 })

  async function handleDelete() {
    try {
      await deleteMutation.mutateAsync({ id, force: false })
      toast.success('Site deleted successfully')
      router.push('/locations')
    } catch (err) {
      toast.error(getErrorMessage(err))
    }
  }

  if (isLoading) return <LocationDetailSkeleton />

  if (error || !location) {
    return (
      <div className="text-center py-16">
        <MapPin className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium">Site not found</h3>
        <p className="text-sm text-muted-foreground mt-1">
          The site you&apos;re looking for doesn&apos;t exist or has been deleted.
        </p>
        <Button variant="outline" className="mt-4" asChild>
          <Link href="/locations">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Sites
          </Link>
        </Button>
      </div>
    )
  }

  const plants = plantsData?.data ?? []
  const plantsMeta = plantsData?.meta
  const transfers = transfersData?.data ?? []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/locations">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-primary/10">
              <MapPin className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{location.location_name}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                {location.state_name && (
                  <Badge variant="outline">{location.state_name}</Badge>
                )}
                <span className="text-sm text-muted-foreground">
                  {location.total_plants} plant{location.total_plants !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
          </div>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href={`/locations/${id}/edit`}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </Link>
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {location.location_name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {location.total_plants > 0 ? (
                      <>
                        This location has <strong>{location.total_plants} plant{location.total_plants !== 1 ? 's' : ''}</strong> assigned.
                        You must reassign or remove all plants before deleting this site.
                      </>
                    ) : (
                      'This action cannot be undone. The site will be permanently deleted.'
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Total Plants" value={location.total_plants} icon={Truck} color="text-primary" />
        <StatCard label="Working" value={location.working_plants} icon={CheckCircle} color="text-emerald-600 dark:text-emerald-400" />
        <StatCard label="Breakdown" value={location.breakdown_plants} icon={AlertTriangle} color="text-red-600 dark:text-red-400" alert={location.breakdown_plants > 0} />
        <StatCard label="Standby" value={location.standby_plants} icon={Clock} color="text-amber-600 dark:text-amber-400" />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="plants" className="space-y-4">
        <TabsList>
          <TabsTrigger value="plants" className="gap-1.5">
            <Truck className="h-4 w-4" />
            Plants
          </TabsTrigger>
          <TabsTrigger value="submissions" className="gap-1.5">
            <FileText className="h-4 w-4" />
            Submissions
          </TabsTrigger>
          <TabsTrigger value="usage" className="gap-1.5">
            <BarChart3 className="h-4 w-4" />
            Usage
          </TabsTrigger>
          <TabsTrigger value="transfers" className="gap-1.5">
            <ArrowLeftRight className="h-4 w-4" />
            Transfers
          </TabsTrigger>
        </TabsList>

        {/* ================================================================ */}
        {/* Plants Tab                                                       */}
        {/* ================================================================ */}
        <TabsContent value="plants" className="space-y-4">
          {plantsLoading ? (
            <TableSkeleton rows={10} cols={6} />
          ) : plants.length === 0 ? (
            <EmptyState
              icon={Truck}
              title="No plants at this site"
              description="Plants assigned to this site will appear here."
            />
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[110px]">Fleet Number</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="w-[130px]">Type</TableHead>
                      <TableHead className="w-[120px]">Condition</TableHead>
                      <TableHead className="w-[80px] text-center">Verified</TableHead>
                      <TableHead className="w-[130px] text-right">Maint. Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plants.map((plant) => (
                      <TableRow
                        key={plant.id}
                        className="cursor-pointer"
                        onClick={() => router.push(`/plants/${plant.id}`)}
                      >
                        <TableCell className="font-mono font-medium">{plant.fleet_number}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{plant.description || '-'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{plant.fleet_type || '-'}</TableCell>
                        <TableCell><ConditionBadge condition={plant.condition} /></TableCell>
                        <TableCell className="text-center">
                          {plant.physical_verification ? (
                            <CheckCircle className="h-4 w-4 text-emerald-600 mx-auto" />
                          ) : (
                            <XCircle className="h-4 w-4 text-muted-foreground mx-auto" />
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {plant.total_maintenance_cost != null ? formatCurrency(plant.total_maintenance_cost) : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {plantsMeta && plantsMeta.total_pages > 1 && (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Page {plantsMeta.page} of {plantsMeta.total_pages} ({plantsMeta.total} plants)
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPlantsPage((p) => Math.max(1, p - 1))} disabled={plantsPage === 1}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setPlantsPage((p) => p + 1)} disabled={plantsPage >= plantsMeta.total_pages}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ================================================================ */}
        {/* Submissions Tab (expandable rows)                                */}
        {/* ================================================================ */}
        <TabsContent value="submissions" className="space-y-4">
          {submissionsLoading ? (
            <TableSkeleton rows={5} cols={6} />
          ) : submissions.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No submissions yet"
              description="Weekly report submissions for this site will appear here."
            />
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]" />
                    <TableHead>Week</TableHead>
                    <TableHead>Year</TableHead>
                    <TableHead>Week Ending</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Plants Processed</TableHead>
                    <TableHead>Submitted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {submissions.map((sub) => {
                    const isExpanded = expandedSub?.year === sub.year && expandedSub?.week === sub.week_number
                    return (
                      <SubmissionRow
                        key={sub.id}
                        sub={sub}
                        isExpanded={isExpanded}
                        locationId={id}
                        onToggle={() => {
                          setExpandedSub(isExpanded ? null : { year: sub.year, week: sub.week_number })
                        }}
                      />
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ================================================================ */}
        {/* Usage Tab (with time filter)                                     */}
        {/* ================================================================ */}
        <TabsContent value="usage" className="space-y-4">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold">Usage Summary</h3>
            <Select value={usagePeriod} onValueChange={setUsagePeriod}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={String(CURRENT_YEAR)}>This Year</SelectItem>
                <SelectItem value={String(CURRENT_YEAR - 1)}>Last Year</SelectItem>
                <SelectItem value="all">All Time</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {usageLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-lg" />
              ))}
            </div>
          ) : !usage ? (
            <EmptyState
              icon={BarChart3}
              title="No usage data"
              description="Usage statistics will appear here once weekly records are submitted."
            />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <UsageCard label="Hours Worked" value={formatNumber(usage.hours_worked)} color="text-emerald-600 dark:text-emerald-400" />
                <UsageCard label="Standby Hours" value={formatNumber(usage.standby_hours)} color="text-blue-600 dark:text-blue-400" />
                <UsageCard label="Breakdown Hours" value={formatNumber(usage.breakdown_hours)} color="text-red-600 dark:text-red-400" />
                <UsageCard
                  label="Utilization Rate"
                  value={`${usage.utilization_rate}%`}
                  color={usage.utilization_rate >= 70 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <UsageCard label="Unique Plants" value={String(usage.unique_plants)} />
                <UsageCard label="Weeks Tracked" value={String(usage.weeks_tracked)} />
                <UsageCard label="Total Records" value={String(usage.total_records)} />
              </div>
            </div>
          )}
        </TabsContent>

        {/* ================================================================ */}
        {/* Transfers Tab                                                    */}
        {/* ================================================================ */}
        <TabsContent value="transfers" className="space-y-4">
          {transfersLoading ? (
            <TableSkeleton rows={5} cols={6} />
          ) : transfers.length === 0 ? (
            <EmptyState
              icon={ArrowLeftRight}
              title="No transfers"
              description="Plant transfers in and out of this site will appear here."
            />
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[110px]">Fleet Number</TableHead>
                    <TableHead className="w-[70px]">Direction</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead className="w-[60px]">Week</TableHead>
                    <TableHead className="w-[100px]">Date</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                    <TableHead>Remarks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transfers.map((t) => {
                    const isInbound = t.to_location_id === id
                    return (
                      <TableRow key={t.id}>
                        <TableCell className="font-mono font-medium">
                          {t.plant?.fleet_number || '-'}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={
                              isInbound
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
                            }
                          >
                            {isInbound ? 'IN' : 'OUT'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {t.from_location?.name || t.from_location_raw || '-'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {t.to_location?.name || t.to_location_raw || '-'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground text-center">
                          {t.source_week ? `Wk ${t.source_week}` : '-'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {(() => {
                            const dateStr = t.transfer_date || t.week_ending_date
                            if (!dateStr) return '-'
                            return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })
                          })()}
                        </TableCell>
                        <TableCell>
                          <TransferStatusBadge status={t.status} />
                        </TableCell>
                        <TableCell className="max-w-[200px]">
                          {t.source_remarks ? (
                            <span className="text-xs text-muted-foreground truncate block" title={t.source_remarks}>
                              {t.source_remarks}
                            </span>
                          ) : '-'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ============================================================================
// Expandable Submission Row
// ============================================================================

function SubmissionRow({
  sub,
  isExpanded,
  locationId,
  onToggle,
}: {
  sub: LocationSubmission
  isExpanded: boolean
  locationId: string
  onToggle: () => void
}) {
  const [recordsPage, setRecordsPage] = useState(1)
  const PAGE_SIZE = 50

  const { data: weeklyData, isLoading } = useLocationWeeklyRecords(
    isExpanded ? locationId : null,
    { year: sub.year, week: sub.week_number, page: recordsPage, limit: PAGE_SIZE }
  )

  const records = weeklyData?.data ?? []
  const meta = weeklyData?.meta

  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={onToggle}>
        <TableCell className="w-[40px]">
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell className="font-medium">Week {sub.week_number}</TableCell>
        <TableCell>{sub.year}</TableCell>
        <TableCell>
          {sub.week_ending_date
            ? new Date(sub.week_ending_date).toLocaleDateString('en-NG', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })
            : '-'}
        </TableCell>
        <TableCell>
          <SubmissionStatusBadge status={sub.status} />
        </TableCell>
        <TableCell className="text-right">{sub.plants_processed ?? '-'}</TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {new Date(sub.submitted_at).toLocaleDateString('en-NG', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </TableCell>
      </TableRow>

      {isExpanded && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={7} className="p-0">
            <div className="px-6 py-4">
              {isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : records.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No plant records for this week</p>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-md border bg-background">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[110px]">Fleet Number</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="w-[80px] text-right">Worked</TableHead>
                          <TableHead className="w-[80px] text-right">Standby</TableHead>
                          <TableHead className="w-[80px] text-right">Breakdown</TableHead>
                          <TableHead className="w-[70px] text-center">Off Hire</TableHead>
                          <TableHead>Remarks</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {records.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-mono text-sm font-medium">{r.fleet_number}</TableCell>
                            <TableCell className="text-sm max-w-[180px] truncate">{r.description || '-'}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{Number(r.hours_worked || 0).toFixed(1)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{Number(r.standby_hours || 0).toFixed(1)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {Number(r.breakdown_hours || 0) > 0 ? (
                                <span className="text-red-600 dark:text-red-400">{Number(r.breakdown_hours).toFixed(1)}</span>
                              ) : (
                                '0.0'
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              {r.off_hire ? (
                                <Badge variant="outline" className="text-[10px]">Yes</Badge>
                              ) : (
                                '-'
                              )}
                            </TableCell>
                            <TableCell className="max-w-[180px]">
                              {r.remarks ? (
                                <span className="text-xs text-muted-foreground truncate block" title={r.remarks}>{r.remarks}</span>
                              ) : '-'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {/* Pagination for expanded records */}
                  {meta && meta.total_pages > 1 && (
                    <div className="flex items-center justify-between px-1" onClick={(e) => e.stopPropagation()}>
                      <p className="text-xs text-muted-foreground">
                        Page {meta.page} of {meta.total_pages} ({meta.total} records)
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setRecordsPage((p) => Math.max(1, p - 1))}
                          disabled={recordsPage === 1}
                        >
                          <ChevronLeft className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setRecordsPage((p) => Math.min(meta.total_pages, p + 1))}
                          disabled={recordsPage >= meta.total_pages}
                        >
                          <ChevronRight className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

// ============================================================================
// Sub-components
// ============================================================================

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  alert,
}: {
  label: string
  value: number
  icon: React.ElementType
  color: string
  alert?: boolean
}) {
  return (
    <Card className={alert ? 'border-red-200 dark:border-red-900' : ''}>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-center justify-between">
          <Icon className={`h-5 w-5 ${color}`} />
          <span className={`text-2xl font-bold ${alert ? 'text-red-600 dark:text-red-400' : ''}`}>
            {value}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </CardContent>
    </Card>
  )
}

function UsageCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 px-4">
        <p className={`text-xl font-bold ${color || ''}`}>{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </CardContent>
    </Card>
  )
}

function ConditionBadge({ condition }: { condition: PlantCondition | null }) {
  const style = CONDITION_STYLES[condition || 'unverified'] || CONDITION_STYLES.unverified
  return (
    <Badge variant="secondary" className={`text-xs ${style.className}`}>
      {style.label}
    </Badge>
  )
}

function SubmissionStatusBadge({ status }: { status: string | null }) {
  const styles: Record<string, string> = {
    processed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
    completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
    pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  }
  return (
    <Badge variant="secondary" className={styles[status || 'pending'] || styles.pending}>
      {status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Pending'}
    </Badge>
  )
}

function TransferStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    confirmed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
    cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    unknown: 'bg-muted text-muted-foreground',
  }
  return (
    <Badge variant="secondary" className={`text-xs ${styles[status] || styles.unknown}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  )
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType
  title: string
  description: string
}) {
  return (
    <div className="text-center py-12">
      <Icon className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
      <h3 className="font-medium">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1">{description}</p>
    </div>
  )
}

function TableSkeleton({ rows, cols }: { rows: number; cols: number }) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {Array.from({ length: cols }).map((_, i) => (
              <TableHead key={i}><Skeleton className="h-4 w-16" /></TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }).map((_, i) => (
            <TableRow key={i}>
              {Array.from({ length: cols }).map((_, j) => (
                <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function LocationDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded" />
        <div>
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-24 mt-1" />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-10 w-72" />
      <TableSkeleton rows={8} cols={6} />
    </div>
  )
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-NG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(num)
}
