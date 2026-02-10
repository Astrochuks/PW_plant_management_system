'use client';

/**
 * Dashboard Page - Fleet Overview
 */

import { useState } from 'react';
import {
  Truck,
  CheckCircle,
  AlertTriangle,
  XCircle,
  TrendingUp,
  BarChart3,
  Table as TableIcon,
  RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDashboardSummary, useFleetSummary, usePlantEvents } from '@/hooks/use-dashboard';
import { FleetCategoryChart } from '@/components/charts/fleet-category-chart';
import { LocationsChart } from '@/components/charts/locations-chart';
import { formatDistanceToNow } from 'date-fns';

export default function DashboardPage() {
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
  
  const {
    data: summary,
    isLoading: summaryLoading,
    refetch: refetchSummary,
  } = useDashboardSummary();
  
  const {
    data: fleetSummary,
    isLoading: fleetLoading,
  } = useFleetSummary();
  
  const {
    data: eventsData,
    isLoading: eventsLoading,
  } = usePlantEvents({ limit: 10 });

  const handleRefresh = () => {
    refetchSummary();
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Fleet Overview</h1>
          <p className="text-muted-foreground">
            Monitor your equipment across all sites
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View Toggle */}
          <div className="flex items-center border rounded-lg p-1">
            <Button
              variant={viewMode === 'chart' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('chart')}
              className="gap-2"
            >
              <BarChart3 className="h-4 w-4" />
              <span className="hidden sm:inline">Charts</span>
            </Button>
            <Button
              variant={viewMode === 'table' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('table')}
              className="gap-2"
            >
              <TableIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Tables</span>
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Plants"
          value={summary?.plants.total_plants}
          subtitle="In the system"
          icon={Truck}
          loading={summaryLoading}
        />
        <StatCard
          title="Active"
          value={summary?.plants.active_plants}
          subtitle={summary ? `${((summary.plants.active_plants / summary.plants.total_plants) * 100).toFixed(1)}% of fleet` : undefined}
          icon={CheckCircle}
          iconColor="text-success"
          loading={summaryLoading}
        />
        <StatCard
          title="Breakdown"
          value={summary?.plants.plants_with_breakdowns}
          subtitle="Need attention"
          icon={AlertTriangle}
          iconColor="text-warning"
          loading={summaryLoading}
        />
        <StatCard
          title="Off-Hire"
          value={summary?.plants.off_hire_plants}
          subtitle="Not in service"
          icon={XCircle}
          iconColor="text-destructive"
          loading={summaryLoading}
        />
      </div>

      {/* Charts / Tables Section */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Fleet by Category */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg font-semibold">Fleet by Category</CardTitle>
          </CardHeader>
          <CardContent>
            {viewMode === 'chart' ? (
              fleetLoading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : (
                <FleetCategoryChart data={fleetSummary || []} />
              )
            ) : (
              <FleetCategoryTable data={fleetSummary || []} loading={fleetLoading} />
            )}
          </CardContent>
        </Card>

        {/* Plants by Location */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg font-semibold">Plants by Location</CardTitle>
          </CardHeader>
          <CardContent>
            {viewMode === 'chart' ? (
              summaryLoading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : (
                <LocationsChart data={summary?.top_locations || []} />
              )
            ) : (
              <LocationsTable data={summary?.top_locations || []} loading={summaryLoading} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Events */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-lg font-semibold">Recent Events</CardTitle>
          <Button variant="link" size="sm" className="text-primary">
            View All →
          </Button>
        </CardHeader>
        <CardContent>
          <RecentEventsTable 
            events={eventsData?.data || []} 
            loading={eventsLoading} 
          />
        </CardContent>
      </Card>
    </div>
  );
}

// Stat Card Component
interface StatCardProps {
  title: string;
  value: number | undefined;
  subtitle?: string;
  icon: React.ElementType;
  iconColor?: string;
  loading?: boolean;
}

function StatCard({ title, value, subtitle, icon: Icon, iconColor = 'text-primary', loading }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            {loading ? (
              <Skeleton className="h-8 w-20 mt-1" />
            ) : (
              <p className="text-3xl font-bold text-foreground">{value ?? 0}</p>
            )}
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            )}
          </div>
          <div className={`p-3 rounded-full bg-muted ${iconColor}`}>
            <Icon className="h-6 w-6" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Fleet Category Table
function FleetCategoryTable({ data, loading }: { data: Array<{ fleet_type_id: string; fleet_type_name: string; total_count: number; verified_count: number; active_count: number }>; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Category</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead className="text-right">Active</TableHead>
          <TableHead className="text-right">Verified</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((item) => (
          <TableRow key={item.fleet_type_id}>
            <TableCell className="font-medium">{item.fleet_type_name || 'Uncategorized'}</TableCell>
            <TableCell className="text-right">{item.total_count}</TableCell>
            <TableCell className="text-right text-success">{item.active_count}</TableCell>
            <TableCell className="text-right text-info">{item.verified_count}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// Locations Table
function LocationsTable({ data, loading }: { data: Array<{ location_id: string; location_name: string; total_plants: number; verified_plants: number; verification_rate: number }>; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Location</TableHead>
          <TableHead className="text-right">Plants</TableHead>
          <TableHead className="text-right">Verified</TableHead>
          <TableHead className="text-right">Rate</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((item) => (
          <TableRow key={item.location_id}>
            <TableCell className="font-medium">{item.location_name}</TableCell>
            <TableCell className="text-right">{item.total_plants}</TableCell>
            <TableCell className="text-right text-success">{item.verified_plants}</TableCell>
            <TableCell className="text-right text-muted-foreground">{item.verification_rate}%</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// Recent Events Table
function RecentEventsTable({ events, loading }: { events: Array<{ id: string; event_type: string; fleet_number: string; created_at: string; acknowledged: boolean }>; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No recent events
      </div>
    );
  }

  const getEventBadge = (type: string) => {
    switch (type) {
      case 'movement':
        return <Badge variant="default" className="bg-info text-white">Movement</Badge>;
      case 'new':
        return <Badge variant="default" className="bg-success text-white">New Plant</Badge>;
      case 'missing':
        return <Badge variant="default" className="bg-destructive text-white">Missing</Badge>;
      case 'returned':
        return <Badge variant="default" className="bg-success text-white">Returned</Badge>;
      default:
        return <Badge variant="secondary">{type}</Badge>;
    }
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[100px]">Type</TableHead>
          <TableHead>Fleet Number</TableHead>
          <TableHead>Time</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((event) => (
          <TableRow key={event.id}>
            <TableCell>{getEventBadge(event.event_type)}</TableCell>
            <TableCell className="font-medium font-mono">{event.fleet_number}</TableCell>
            <TableCell className="text-muted-foreground">
              {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
            </TableCell>
            <TableCell>
              {event.acknowledged ? (
                <Badge variant="outline" className="text-muted-foreground">Acknowledged</Badge>
              ) : (
                <Badge variant="outline" className="text-warning border-warning">Pending</Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
