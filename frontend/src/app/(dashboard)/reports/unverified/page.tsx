'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
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
import { useUnverifiedPlants } from '@/hooks/use-reports'
import { useLocationsWithStats } from '@/hooks/use-locations'

const WEEKS_OPTIONS = [2, 3, 4, 6, 8, 12]
const PAGE_SIZE = 50

export default function UnverifiedPlantsPage() {
  const [locationId, setLocationId] = useState<string>('')
  const [weeksMissing, setWeeksMissing] = useState<number>(2)
  const [page, setPage] = useState<number>(1)

  const { data: locations = [] } = useLocationsWithStats()
  const { data: response, isLoading } = useUnverifiedPlants({
    ...(locationId ? { location_id: locationId } : {}),
    weeks_missing: weeksMissing,
    page,
    limit: PAGE_SIZE,
  })

  const plants = response?.data ?? []
  const meta = response?.meta

  // Reset to page 1 when filters change
  const handleLocationChange = (v: string) => {
    setLocationId(v)
    setPage(1)
  }
  const handleWeeksChange = (v: string) => {
    setWeeksMissing(Number(v))
    setPage(1)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/reports"
          className="p-2 rounded-lg hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Unverified Plants</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Plants missing physical verification in recent weeks
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={locationId} onValueChange={handleLocationChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All locations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All locations</SelectItem>
            {locations.map((loc) => (
              <SelectItem key={loc.id} value={loc.id}>
                {loc.location_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={String(weeksMissing)}
          onValueChange={handleWeeksChange}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Weeks missing" />
          </SelectTrigger>
          <SelectContent>
            {WEEKS_OPTIONS.map((w) => (
              <SelectItem key={w} value={String(w)}>
                Missing {w}+ weeks
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary */}
      {meta && meta.total > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-red-100 dark:bg-red-900">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-300" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                  Unverified Plants
                </p>
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {meta.total.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  Not verified in {weeksMissing}+ weeks
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <Skeleton className="h-[300px] w-full" />
      ) : plants.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                Plants sorted by longest gap
              </CardTitle>
              {meta && meta.total_pages > 1 && (
                <span className="text-sm text-muted-foreground">
                  Page {meta.page} of {meta.total_pages}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fleet #</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Last Verified</TableHead>
                    <TableHead className="text-right">Weeks Since</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plants.map((row) => {
                    const weeksSince = Number(row.weeks_since_verification)
                    return (
                      <TableRow key={row.plant_id}>
                        <TableCell className="font-mono font-medium">
                          <Link
                            href={`/plants/${row.plant_id}`}
                            className="text-primary hover:underline"
                          >
                            {row.fleet_number}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                          {row.description || '-'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.current_location}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.last_verified_date
                            ? new Date(row.last_verified_date).toLocaleDateString(
                                'en-NG',
                                { day: 'numeric', month: 'short', year: 'numeric' }
                              )
                            : 'Never'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant={weeksSince >= 8 ? 'destructive' : weeksSince >= 4 ? 'default' : 'secondary'}
                          >
                            {weeksSince ? `${weeksSince}w` : 'Never'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {meta && meta.total_pages > 1 && (
              <div className="flex items-center justify-between pt-4">
                <p className="text-sm text-muted-foreground">
                  Showing {(meta.page - 1) * PAGE_SIZE + 1}–{Math.min(meta.page * PAGE_SIZE, meta.total)} of {meta.total.toLocaleString()} plants
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page >= (meta?.total_pages ?? 1)}
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
            <p className="font-medium">No unverified plants</p>
            <p className="text-sm text-muted-foreground mt-1">
              All plants have been verified within the selected timeframe.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
