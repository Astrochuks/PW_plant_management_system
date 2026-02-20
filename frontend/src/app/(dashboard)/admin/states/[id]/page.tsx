'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, MapPin, Pencil, Truck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
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
import { ProtectedRoute } from '@/components/protected-route'
import { useStateDetail, useStatePlants } from '@/hooks/use-states'

const STATUS_OPTIONS = [
  'working', 'standby', 'under_repair', 'breakdown',
  'faulty', 'scrap', 'missing', 'off_hire', 'gpm_assessment',
]

function StateDetailContent() {
  const params = useParams()
  const stateId = params.id as string

  const { data: state, isLoading } = useStateDetail(stateId)
  const [plantsPage, setPlantsPage] = useState(1)
  const [plantsStatus, setPlantsStatus] = useState<string>('')

  const { data: plantsData, isLoading: plantsLoading } = useStatePlants(stateId, {
    page: plantsPage,
    limit: 50,
    ...(plantsStatus && plantsStatus !== 'all' ? { status: plantsStatus } : {}),
  })

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[200px] w-full" />
        <Skeleton className="h-[300px] w-full" />
      </div>
    )
  }

  if (!state) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">State not found</p>
      </div>
    )
  }

  const plants = plantsData?.data || []
  const plantsMeta = plantsData?.meta

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/states"
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              {state.name}
              {state.code && (
                <Badge variant="outline" className="font-mono text-xs">
                  {state.code}
                </Badge>
              )}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {state.region || 'No region set'}
              {' · '}
              <Badge variant={state.is_active ? 'default' : 'secondary'} className="ml-1">
                {state.is_active ? 'Active' : 'Inactive'}
              </Badge>
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/admin/states/${stateId}/edit`}>
            <Pencil className="h-4 w-4 mr-2" />
            Edit
          </Link>
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase">Sites</p>
            <p className="text-2xl font-bold">{state.sites_count}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase">Total Plants</p>
            <p className="text-2xl font-bold">
              {state.sites.reduce((sum, s) => sum + Number(s.total_plants), 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase">Working</p>
            <p className="text-2xl font-bold text-emerald-600">
              {state.sites.reduce((sum, s) => sum + Number(s.working_plants), 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase">Breakdown</p>
            <p className="text-2xl font-bold text-red-600">
              {state.sites.reduce((sum, s) => sum + Number(s.breakdown_plants), 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="sites">
        <TabsList>
          <TabsTrigger value="sites" className="gap-1.5">
            <MapPin className="h-3.5 w-3.5" />
            Sites ({state.sites_count})
          </TabsTrigger>
          <TabsTrigger value="plants" className="gap-1.5">
            <Truck className="h-3.5 w-3.5" />
            Plants
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sites" className="mt-4">
          {state.sites.length > 0 ? (
            <Card>
              <CardContent className="pt-6">
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Site Name</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Working</TableHead>
                        <TableHead className="text-right">Standby</TableHead>
                        <TableHead className="text-right">Breakdown</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {state.sites.map((site) => (
                        <TableRow key={site.id}>
                          <TableCell className="font-medium">
                            <Link
                              href={`/locations/${site.id}`}
                              className="text-primary hover:underline"
                            >
                              {site.location_name}
                            </Link>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {Number(site.total_plants)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-emerald-600">
                            {Number(site.working_plants)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-amber-600">
                            {Number(site.standby_plants)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-red-600">
                            {Number(site.breakdown_plants)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8 text-center">
                <MapPin className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">No sites in this state</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="plants" className="mt-4 space-y-4">
          {/* Plants filter */}
          <div className="flex gap-3">
            <Select value={plantsStatus} onValueChange={(v) => { setPlantsStatus(v); setPlantsPage(1) }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {plantsLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : plants.length > 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {plantsMeta && Number(plantsMeta.total).toLocaleString()} plants
                  {plantsMeta && plantsMeta.total_pages > 1 && (
                    <span className="text-muted-foreground font-normal ml-2">
                      Page {plantsMeta.page} of {plantsMeta.total_pages}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fleet #</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Site</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {plants.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono font-medium">
                            <Link
                              href={`/plants/${p.id}`}
                              className="text-primary hover:underline"
                            >
                              {p.fleet_number}
                            </Link>
                          </TableCell>
                          <TableCell className="text-sm">{p.fleet_type || '-'}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{p.status || '-'}</Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {p.location_name || '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                {plantsMeta && plantsMeta.total_pages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">
                      Page {plantsMeta.page} of {plantsMeta.total_pages}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={plantsPage <= 1}
                        onClick={() => setPlantsPage((p) => p - 1)}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={plantsPage >= plantsMeta.total_pages}
                        onClick={() => setPlantsPage((p) => p + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8 text-center">
                <Truck className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">
                  No plants found{plantsStatus && plantsStatus !== 'all' ? ' with this status' : ''}
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default function StateDetailPage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <StateDetailContent />
    </ProtectedRoute>
  )
}
