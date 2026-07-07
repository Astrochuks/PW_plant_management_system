'use client'

import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { useState, useMemo } from 'react'
import {
  ArrowLeft,
  Edit2,
  Trash2,
  Truck,
  MapPin,
  Wrench,
  Calendar,
  Hash,
  CheckCircle,
  XCircle,
  DollarSign,
  FileText,
  ArrowRightLeft,
  Package,
  TrendingUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  usePlant,
  usePlantMaintenanceHistory,
  usePlantLocationHistory,
  usePlantWeeklyRecords,
  usePlantEvents,
  useDeletePlant,
} from '@/hooks/use-plants'
import { usePlantCosts, usePlantSharedCosts } from '@/hooks/use-spare-parts'
import type { PlantRecentPart, PlantSharedCost } from '@/lib/api/spare-parts'
import { useAuth } from '@/providers/auth-provider'
import { PlantMaintenanceTable, type MaintenanceRecord } from '@/components/plants/plant-maintenance-table'
import { PlantLocationHistory } from '@/components/plants/plant-location-history'
import { PlantWeeklyUsageChart } from '@/components/plants/plant-weekly-usage-chart'
import { PlantEventsFeed } from '@/components/plants/plant-events-feed'
import { SparePartDetailModal } from '@/components/spare-parts/spare-part-detail-modal'
import type { PlantCondition } from '@/lib/api/plants'

// ---------------------------------------------------------------------------
// Condition badge config (same as modal)
// ---------------------------------------------------------------------------
const CONDITION_STYLES: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }
> = {
  working: { label: 'Working', variant: 'default', className: 'bg-emerald-600 hover:bg-emerald-600 text-white' },
  standby: { label: 'Standby', variant: 'secondary', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' },
  under_repair: { label: 'Under Repair', variant: 'secondary', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  breakdown: { label: 'Breakdown', variant: 'destructive' },
  faulty: { label: 'Faulty', variant: 'secondary', className: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' },
  scrap: { label: 'Scrap', variant: 'secondary', className: 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
  missing: { label: 'Missing', variant: 'destructive', className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
  off_hire: { label: 'Off Hire', variant: 'outline' },
  gpm_assessment: { label: 'GPM Assessment', variant: 'secondary', className: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' },
  unverified: { label: 'Unverified', variant: 'outline', className: 'text-muted-foreground' },
}

function ConditionBadge({ condition }: { condition: PlantCondition | null }) {
  const style = CONDITION_STYLES[condition || 'unverified'] || CONDITION_STYLES.unverified
  return (
    <Badge variant={style.variant} className={style.className}>
      {style.label}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatCurrency(amount: number, currency = 'NGN'): string {
  const locale = currency === 'NGN' ? 'en-NG' : currency === 'GBP' ? 'en-GB' : currency === 'EUR' ? 'de-DE' : 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function PlantDetailPage() {
  const params = useParams()
  const plantId = params.id as string

  return <PlantDetailContent plantId={plantId} />
}

function PlantDetailContent({ plantId }: { plantId: string }) {
  const router = useRouter()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [activeTab, setActiveTab] = useState('overview')
  const [costYear, setCostYear] = useState<string>(String(new Date().getFullYear()))
  const [costPeriod, setCostPeriod] = useState<string>('')

  const currentYear = new Date().getFullYear()

  // Cost params based on filter selections
  const costParams = useMemo(() => {
    const p: { year?: number; month?: number; quarter?: number; week?: number } = {}
    if (costYear) p.year = Number(costYear)
    if (costPeriod && costPeriod.startsWith('q')) p.quarter = Number(costPeriod.slice(1))
    else if (costPeriod && costPeriod.startsWith('m')) p.month = Number(costPeriod.slice(1))
    else if (costPeriod && costPeriod.startsWith('w')) p.week = Number(costPeriod.slice(1))
    return p
  }, [costYear, costPeriod])

  // Only fetch plant detail on mount; tab data loads lazily when tab is selected
  const { data: plant, isLoading } = usePlant(plantId)
  const { data: maintenanceRecords = [], isLoading: maintenanceLoading } = usePlantMaintenanceHistory(activeTab === 'maintenance' ? plantId : null)
  const { data: locationRecords = [], isLoading: locationLoading } = usePlantLocationHistory(activeTab === 'locations' ? plantId : null)
  const { data: weeklyRecords = [], isLoading: weeklyLoading } = usePlantWeeklyRecords(activeTab === 'usage' ? plantId : null)
  const { data: events = [], isLoading: eventsLoading } = usePlantEvents(activeTab === 'events' ? plantId : null)
  const { data: costData, isLoading: costsLoading } = usePlantCosts(activeTab === 'costs' ? plantId : null, costParams)
  const { data: sharedCostsData, isLoading: sharedCostsLoading } = usePlantSharedCosts(plantId)
  const deleteMutation = useDeletePlant()

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null)

  // Loading state
  if (isLoading) return <DetailSkeleton />

  // Not found
  if (!plant) {
    return (
      <div className="space-y-6 text-center py-20">
        <h1 className="text-2xl font-bold">Plant not found</h1>
        <p className="text-muted-foreground">The plant you&apos;re looking for doesn&apos;t exist or has been removed.</p>
        <Button asChild>
          <Link href="/plants">Back to Plants</Link>
        </Button>
      </div>
    )
  }

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(plantId)
      router.push('/plants')
    } catch {
      // mutation error handled by React Query
    }
    setShowDeleteConfirm(false)
  }

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Plants
        </Button>

        {isAdmin && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/plants/${plantId}/edit`}>
                <Edit2 className="mr-2 h-4 w-4" />
                Edit
              </Link>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </div>
        )}
      </div>

      {/* ── Plant Identity ─────────────────────────────────────── */}
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-xl bg-primary/10">
          <Truck className="h-8 w-8 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold tracking-tight font-mono">{plant.fleet_number}</h1>
            <ConditionBadge condition={plant.condition} />
            {plant.physical_verification ? (
              <Badge variant="outline" className="text-emerald-600 border-emerald-600">
                <CheckCircle className="h-3 w-3 mr-1" />
                Verified
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                <XCircle className="h-3 w-3 mr-1" />
                Not Verified
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {[plant.fleet_type, plant.make, plant.model].filter(Boolean).join(' \u00B7 ') || 'No type assigned'}
          </p>
          {plant.description && (
            <p className="text-sm text-muted-foreground mt-0.5">{plant.description}</p>
          )}
        </div>
      </div>

      {/* ── Two-column body ────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Left: Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList variant="line" className="w-full justify-start border-b overflow-x-auto">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
            <TabsTrigger value="costs">Costs</TabsTrigger>
            <TabsTrigger value="locations">Sites</TabsTrigger>
            <TabsTrigger value="usage">Usage</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
          </TabsList>

          {/* ── Overview Tab ───────────────────────────────────── */}
          <TabsContent value="overview" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Asset Information</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                  <InfoItem icon={Truck} label="Fleet Type" value={plant.fleet_type} />
                  {plant.division === 'mining' && (
                    <InfoItem icon={Truck} label="Division" value="Mining" />
                  )}
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-muted flex-shrink-0">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">Current Site</p>
                      <p className="text-sm font-medium truncate flex items-center gap-1.5">
                        {plant.current_location || '-'}
                        {plant.is_bua && <span className="inline-flex items-center rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-400">BUA</span>}
                      </p>
                    </div>
                  </div>
                  <InfoItem icon={Truck} label="Make" value={plant.make} />
                  <InfoItem icon={Truck} label="Model" value={plant.model} />
                  <InfoItem icon={Truck} label="Capacity" value={plant.capacity} />
                  <InfoItem icon={Hash} label="Chassis Number" value={plant.chassis_number} />
                  <InfoItem icon={Hash} label="Engine Number" value={plant.engine_number} />
                  <InfoItem icon={Calendar} label="Manufacture Date" value={
                    plant.year_of_manufacture
                      ? plant.manufacture_month
                        ? plant.manufacture_day
                          ? `${plant.manufacture_day} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][plant.manufacture_month - 1]} ${plant.year_of_manufacture}`
                          : `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][plant.manufacture_month - 1]} ${plant.year_of_manufacture}`
                        : String(plant.year_of_manufacture)
                      : null
                  } />
                  <InfoItem icon={Hash} label="Serial M" value={plant.serial_m} />
                  <InfoItem icon={Hash} label="Serial E" value={plant.serial_e} />
                  <InfoItem icon={Calendar} label="Purchase Date" value={
                    plant.purchase_year
                      ? plant.purchase_month
                        ? plant.purchase_day
                          ? `${plant.purchase_day} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][plant.purchase_month - 1]} ${plant.purchase_year}`
                          : `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][plant.purchase_month - 1]} ${plant.purchase_year}`
                        : String(plant.purchase_year)
                      : null
                  } />
                  <InfoItem icon={MapPin} label="Purchase Site" value={plant.purchase_site} />
                  <InfoItem
                    icon={DollarSign}
                    label="Purchase Cost"
                    value={plant.purchase_cost ? formatCurrency(plant.purchase_cost, plant.purchase_currency || 'NGN') : null}
                  />
                  <InfoItem icon={MapPin} label="State" value={plant.state} />
                </div>

                {/* Components */}
                {plant.components && plant.components.length > 0 && (
                  <div className="mt-6 pt-4 border-t">
                    <h4 className="text-sm font-medium text-muted-foreground mb-3">Components</h4>
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/50 border-b">
                            <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2">Component</th>
                            <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2">Model</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {plant.components.map((comp: { name: string; model: string }, idx: number) => (
                            <tr key={idx} className="hover:bg-muted/20">
                              <td className="px-4 py-2 font-medium">{comp.name}</td>
                              <td className="px-4 py-2 text-muted-foreground font-mono text-xs">{comp.model || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Maintenance Tab ────────────────────────────────── */}
          <TabsContent value="maintenance" className="mt-4">
            <PlantMaintenanceTable
              records={maintenanceRecords}
              isLoading={maintenanceLoading}
              onRowClick={(record: MaintenanceRecord) => setSelectedPartId(record.id)}
            />
          </TabsContent>

          {/* ── Costs Tab ───────────────────────────────────────── */}
          <TabsContent value="costs" className="mt-4 space-y-4">
            {/* Period Filter */}
            <div className="flex items-center gap-3">
              <Select value={costYear} onValueChange={(v) => { setCostYear(v === 'all' ? '' : v); setCostPeriod(''); }}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue placeholder="All years" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Years</SelectItem>
                  {[currentYear, currentYear - 1, currentYear - 2].map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {costYear && (
                <Select value={costPeriod} onValueChange={(v) => setCostPeriod(v === 'all' ? '' : v)}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Full year" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Full Year</SelectItem>
                    <SelectItem value="q1">Q1 (Jan-Mar)</SelectItem>
                    <SelectItem value="q2">Q2 (Apr-Jun)</SelectItem>
                    <SelectItem value="q3">Q3 (Jul-Sep)</SelectItem>
                    <SelectItem value="q4">Q4 (Oct-Dec)</SelectItem>
                    <SelectItem value="m1">January</SelectItem>
                    <SelectItem value="m2">February</SelectItem>
                    <SelectItem value="m3">March</SelectItem>
                    <SelectItem value="m4">April</SelectItem>
                    <SelectItem value="m5">May</SelectItem>
                    <SelectItem value="m6">June</SelectItem>
                    <SelectItem value="m7">July</SelectItem>
                    <SelectItem value="m8">August</SelectItem>
                    <SelectItem value="m9">September</SelectItem>
                    <SelectItem value="m10">October</SelectItem>
                    <SelectItem value="m11">November</SelectItem>
                    <SelectItem value="m12">December</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>

            {costsLoading ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-[80px]" />)}
                </div>
                <Skeleton className="h-[300px]" />
              </div>
            ) : costData ? (
              <>
                {/* Cost Stats */}
                <div className="grid grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900">
                          <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Direct Cost</p>
                          <p className="text-xl font-bold">{formatCurrency(costData.costs.total_cost)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900">
                          <Package className="h-4 w-4 text-blue-600 dark:text-blue-300" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Parts Replaced</p>
                          <p className="text-xl font-bold">{costData.costs.parts_count}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-violet-100 dark:bg-violet-900">
                          <TrendingUp className="h-4 w-4 text-violet-600 dark:text-violet-300" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Purchase Orders</p>
                          <p className="text-xl font-bold">{costData.costs.po_count}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Recent Parts Table */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Recent Parts</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {costData.recent_parts.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
                        <p className="text-sm">No parts found for this period</p>
                      </div>
                    ) : (
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Part Description</TableHead>
                              <TableHead className="w-[60px] text-center">Qty</TableHead>
                              <TableHead className="w-[120px] text-right">Cost</TableHead>
                              <TableHead className="w-[130px]">PO Number</TableHead>
                              <TableHead className="w-[100px]">Date</TableHead>
                              <TableHead className="w-[130px]">Supplier</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {costData.recent_parts.map((part: PlantRecentPart) => (
                              <TableRow key={part.id}>
                                <TableCell className="max-w-[250px] truncate" title={part.part_description}>
                                  {part.part_description}
                                </TableCell>
                                <TableCell className="text-center">{part.quantity}</TableCell>
                                <TableCell className="text-right font-medium">
                                  {part.total_cost != null ? formatCurrency(part.total_cost) : '-'}
                                </TableCell>
                                <TableCell className="font-mono text-sm">
                                  {part.purchase_order_number ? (
                                    <Link
                                      href={`/spare-parts/po/${encodeURIComponent(part.purchase_order_number)}`}
                                      className="text-primary hover:underline"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {part.purchase_order_number}
                                    </Link>
                                  ) : '-'}
                                </TableCell>
                                <TableCell className="text-sm">
                                  {part.replaced_date ? formatDate(part.replaced_date) : '-'}
                                </TableCell>
                                <TableCell className="text-sm truncate max-w-[130px]">
                                  {part.supplier || '-'}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Shared Costs Section */}
                {sharedCostsLoading ? (
                  <Skeleton className="h-[120px]" />
                ) : sharedCostsData && sharedCostsData.shared_costs_count > 0 ? (
                  <Card>
                    <CardHeader className="pb-3">
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          <ArrowRightLeft className="h-4 w-4" />
                          Shared Costs ({sharedCostsData.shared_costs_count})
                        </CardTitle>
                        <p className="text-xs text-muted-foreground mt-1">Not included in direct cost total</p>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {sharedCostsData.shared_costs.map((sc: PlantSharedCost, idx: number) => (
                        <div key={idx} className="p-3 bg-muted/50 rounded-lg space-y-2">
                          <div className="flex items-center justify-between">
                            <div>
                              {sc.po_number ? (
                                <Link
                                  href={`/spare-parts/po/${encodeURIComponent(sc.po_number)}`}
                                  className="font-mono text-sm font-medium text-primary hover:underline"
                                >
                                  {sc.po_number}
                                </Link>
                              ) : (
                                <span className="font-mono text-sm font-medium">N/A</span>
                              )}
                              {sc.po_date && (
                                <span className="text-xs text-muted-foreground ml-2">
                                  {formatDate(sc.po_date)}
                                </span>
                              )}
                            </div>
                            <span className="font-semibold">
                              {formatCurrency(sc.total_amount)}
                            </span>
                          </div>
                          {sc.supplier && (
                            <p className="text-xs text-muted-foreground">Supplier: {sc.supplier}</p>
                          )}
                          {(sc.po_vat > 0 || sc.po_discount > 0 || sc.po_other > 0) && (
                            <div className="text-xs text-muted-foreground flex gap-3">
                              {sc.po_vat > 0 && <span>VAT: {formatCurrency(sc.po_vat)}</span>}
                              {sc.po_discount > 0 && <span>Discount: -{formatCurrency(sc.po_discount)}</span>}
                              {sc.po_other > 0 && <span>Other: {formatCurrency(sc.po_other)}</span>}
                            </div>
                          )}
                          {sc.shared_with && sc.shared_with.length > 0 && (
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="text-xs text-muted-foreground">Shared with:</span>
                              {sc.shared_with.map((fleet: string) => (
                                <span key={fleet} className="text-xs bg-background border rounded px-1.5 py-0.5 font-mono">
                                  {fleet}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ) : sharedCostsData ? (
                  <div className="text-center py-4 text-muted-foreground">
                    <p className="text-sm">No shared costs for this plant</p>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <DollarSign className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No cost data available</p>
              </div>
            )}
          </TabsContent>

          {/* ── Site History Tab ────────────────────────────────── */}
          <TabsContent value="locations" className="mt-4">
            <PlantLocationHistory
              records={locationRecords}
              isLoading={locationLoading}
            />
          </TabsContent>

          {/* ── Usage Tab ──────────────────────────────────────── */}
          <TabsContent value="usage" className="mt-4">
            <PlantWeeklyUsageChart
              records={weeklyRecords}
              isLoading={weeklyLoading}
            />
          </TabsContent>

          {/* ── Events Tab ─────────────────────────────────────── */}
          <TabsContent value="events" className="mt-4">
            <PlantEventsFeed
              events={events}
              isLoading={eventsLoading}
            />
          </TabsContent>
        </Tabs>

        {/* Right: Sidebar */}
        <div className="space-y-4">
          {/* Summary Stats */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Wrench className="h-4 w-4" />
                Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground">Direct Maintenance Cost</p>
                <p className="text-xl font-bold">
                  {plant.total_maintenance_cost != null
                    ? formatCurrency(plant.total_maintenance_cost)
                    : '\u20A60'}
                </p>
              </div>
              {sharedCostsData && sharedCostsData.shared_costs_count > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground">Shared Maintenance Cost</p>
                  <p className="text-lg font-semibold text-amber-600">
                    {formatCurrency(sharedCostsData.total_shared_cost)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {sharedCostsData.shared_costs_count} shared item{sharedCostsData.shared_costs_count !== 1 ? 's' : ''}
                  </p>
                </div>
              )}
              <Separator />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Parts Replaced</p>
                  <p className="text-lg font-semibold">{plant.parts_replaced_count ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Last Maintenance</p>
                  <p className="text-sm font-semibold">
                    {plant.last_maintenance_date ? formatDate(plant.last_maintenance_date) : 'Never'}
                  </p>
                </div>
              </div>
              <Separator />
              <div>
                <p className="text-xs text-muted-foreground">Purchase Cost</p>
                <p className="text-lg font-semibold">
                  {plant.purchase_cost ? formatCurrency(plant.purchase_cost) : '-'}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Pending Transfer */}
          {plant.pending_transfer_to_location && (
            <Card className="border-amber-300 dark:border-amber-700">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 mb-2">
                  <ArrowRightLeft className="h-4 w-4" />
                  <span className="text-sm font-semibold">Pending Transfer</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Transferring to <span className="font-medium text-foreground">{plant.pending_transfer_to_location}</span>
                </p>
              </CardContent>
            </Card>
          )}

          {/* Remarks */}
          {plant.remarks && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Remarks
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed">{plant.remarks}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ── Spare Part Detail Modal ───────────────────────────── */}
      {selectedPartId && (
        <SparePartDetailModal
          partId={selectedPartId}
          onClose={() => setSelectedPartId(null)}
        />
      )}

      {/* ── Delete Confirmation ────────────────────────────────── */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg p-6 max-w-sm shadow-xl">
            <h2 className="text-lg font-bold mb-2">Delete Plant</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Are you sure you want to delete <span className="font-semibold">{plant.fleet_number}</span>? This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete Plant'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Info item for overview grid
// ---------------------------------------------------------------------------
function InfoItem({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType
  label: string
  value: string | null | undefined
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="p-2 rounded-lg bg-muted flex-shrink-0">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium truncate">{value || '-'}</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------
function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-32" />
      <div className="flex items-start gap-4">
        <Skeleton className="h-14 w-14 rounded-xl" />
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-[400px] w-full mt-4" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-[250px] w-full" />
          <Skeleton className="h-[120px] w-full" />
        </div>
      </div>
    </div>
  )
}
