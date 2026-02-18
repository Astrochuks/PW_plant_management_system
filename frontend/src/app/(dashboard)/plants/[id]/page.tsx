'use client'

import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { useState } from 'react'
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
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  usePlant,
  usePlantMaintenanceHistory,
  usePlantLocationHistory,
  usePlantWeeklyRecords,
  usePlantEvents,
  useDeletePlant,
} from '@/hooks/use-plants'
import { useAuth } from '@/providers/auth-provider'
import { PlantMaintenanceTable } from '@/components/plants/plant-maintenance-table'
import { PlantLocationHistory } from '@/components/plants/plant-location-history'
import { PlantWeeklyUsageChart } from '@/components/plants/plant-weekly-usage-chart'
import { PlantEventsFeed } from '@/components/plants/plant-events-feed'
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
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
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

  // Only fetch plant detail on mount; tab data loads lazily when tab is selected
  const { data: plant, isLoading } = usePlant(plantId)
  const { data: maintenanceRecords = [], isLoading: maintenanceLoading } = usePlantMaintenanceHistory(activeTab === 'maintenance' ? plantId : null)
  const { data: locationRecords = [], isLoading: locationLoading } = usePlantLocationHistory(activeTab === 'locations' ? plantId : null)
  const { data: weeklyRecords = [], isLoading: weeklyLoading } = usePlantWeeklyRecords(activeTab === 'usage' ? plantId : null)
  const { data: events = [], isLoading: eventsLoading } = usePlantEvents(activeTab === 'events' ? plantId : null)
  const deleteMutation = useDeletePlant()

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

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
        <Button variant="ghost" size="sm" asChild>
          <Link href="/plants">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to Plants
          </Link>
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
          <TabsList variant="line" className="w-full justify-start border-b">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
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
                  <InfoItem icon={MapPin} label="Current Site" value={plant.current_location} />
                  <InfoItem icon={Truck} label="Make" value={plant.make} />
                  <InfoItem icon={Truck} label="Model" value={plant.model} />
                  <InfoItem icon={Hash} label="Chassis Number" value={plant.chassis_number} />
                  <InfoItem icon={Calendar} label="Year of Manufacture" value={plant.year_of_manufacture?.toString()} />
                  <InfoItem icon={Hash} label="Serial M" value={plant.serial_m} />
                  <InfoItem icon={Hash} label="Serial E" value={plant.serial_e} />
                  <InfoItem icon={Calendar} label="Purchase Year" value={plant.purchase_year?.toString()} />
                  <InfoItem
                    icon={DollarSign}
                    label="Purchase Cost"
                    value={plant.purchase_cost ? formatCurrency(plant.purchase_cost) : null}
                  />
                  <InfoItem icon={MapPin} label="State" value={plant.state} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Maintenance Tab ────────────────────────────────── */}
          <TabsContent value="maintenance" className="mt-4">
            <PlantMaintenanceTable
              records={maintenanceRecords}
              isLoading={maintenanceLoading}
            />
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
                <p className="text-xs text-muted-foreground">Total Maintenance Cost</p>
                <p className="text-xl font-bold">
                  {plant.total_maintenance_cost != null
                    ? formatCurrency(plant.total_maintenance_cost)
                    : '\u20A60'}
                </p>
              </div>
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
