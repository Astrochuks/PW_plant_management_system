'use client';

/**
 * Reports Page
 * Analytics and reports dashboard
 */

import { useState, useMemo } from 'react';
import {
  FileText,
  Download,
  TrendingUp,
  CheckCircle,
  AlertTriangle,
  Calendar,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useMaintenanceCosts,
  useVerificationStatus,
  useUnverifiedPlants,
} from '@/hooks/use-reports';
import { useLocations } from '@/hooks/use-plants';
import { exportPlants, exportMaintenance } from '@/lib/api/reports';
import { toast } from 'sonner';

const currentYear = new Date().getFullYear();
const years = [currentYear, currentYear - 1, currentYear - 2];

export default function ReportsPage() {
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedLocation, setSelectedLocation] = useState<string>('');
  const [groupBy, setGroupBy] = useState<'month' | 'quarter' | 'fleet_type' | 'location'>('month');
  const [exporting, setExporting] = useState<string | null>(null);

  // Data fetching
  const { data: locations = [] } = useLocations();
  const { data: maintenanceCosts = [], isLoading: maintenanceLoading } = useMaintenanceCosts({
    year: selectedYear,
    location_id: selectedLocation || undefined,
    group_by: groupBy,
  });
  const { data: verificationStatus = [], isLoading: verificationLoading } = useVerificationStatus({
    year: selectedYear,
  });
  const { data: unverifiedPlants = [], isLoading: unverifiedLoading } = useUnverifiedPlants({
    location_id: selectedLocation || undefined,
    weeks_missing: 2,
    limit: 50,
  });

  // Calculate totals
  const maintenanceTotal = useMemo(() => {
    return maintenanceCosts.reduce((sum, item) => sum + (item.total_cost || 0), 0);
  }, [maintenanceCosts]);

  const verificationAvg = useMemo(() => {
    if (verificationStatus.length === 0) return 0;
    const total = verificationStatus.reduce((sum, item) => sum + (item.verification_rate || 0), 0);
    return Math.round((total / verificationStatus.length) * 100);
  }, [verificationStatus]);

  // Export handlers
  const handleExportPlants = async () => {
    setExporting('plants');
    try {
      const result = await exportPlants({
        format: 'csv',
        location_id: selectedLocation || undefined,
      });
      downloadCSV(result.data as string, `plants-export-${Date.now()}.csv`);
      toast.success(`Exported ${result.count} plants`);
    } catch {
      toast.error('Failed to export plants');
    } finally {
      setExporting(null);
    }
  };

  const handleExportMaintenance = async () => {
    setExporting('maintenance');
    try {
      const result = await exportMaintenance({
        format: 'csv',
        year: selectedYear,
      });
      downloadCSV(result.data as string, `maintenance-export-${Date.now()}.csv`);
      toast.success(`Exported ${result.count} maintenance records`);
    } catch {
      toast.error('Failed to export maintenance data');
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <FileText className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
            <p className="text-sm text-muted-foreground">
              Analytics and data exports
            </p>
          </div>
        </div>

        {/* Export Buttons */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportPlants}
            disabled={exporting === 'plants'}
          >
            <Download className="h-4 w-4 mr-2" />
            {exporting === 'plants' ? 'Exporting...' : 'Export Plants'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportMaintenance}
            disabled={exporting === 'maintenance'}
          >
            <Download className="h-4 w-4 mr-2" />
            {exporting === 'maintenance' ? 'Exporting...' : 'Export Maintenance'}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select
          value={String(selectedYear)}
          onValueChange={(value) => setSelectedYear(Number(value))}
        >
          <SelectTrigger className="w-[120px]">
            <Calendar className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((year) => (
              <SelectItem key={year} value={String(year)}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={selectedLocation || 'all'}
          onValueChange={(value) => setSelectedLocation(value === 'all' ? '' : value)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Locations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Locations</SelectItem>
            {locations.map((loc) => (
              <SelectItem key={loc.location_id} value={loc.location_id}>
                {loc.location_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="maintenance" className="space-y-4">
        <TabsList>
          <TabsTrigger value="maintenance">
            <TrendingUp className="h-4 w-4 mr-2" />
            Maintenance Costs
          </TabsTrigger>
          <TabsTrigger value="verification">
            <CheckCircle className="h-4 w-4 mr-2" />
            Verification Status
          </TabsTrigger>
          <TabsTrigger value="unverified">
            <AlertTriangle className="h-4 w-4 mr-2" />
            Unverified Plants
          </TabsTrigger>
        </TabsList>

        {/* Maintenance Costs Tab */}
        <TabsContent value="maintenance" className="space-y-4">
          <div className="flex gap-3 mb-4">
            <Select
              value={groupBy}
              onValueChange={(value) => setGroupBy(value as typeof groupBy)}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Group by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="month">By Month</SelectItem>
                <SelectItem value="quarter">By Quarter</SelectItem>
                <SelectItem value="fleet_type">By Fleet Type</SelectItem>
                <SelectItem value="location">By Location</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  Maintenance Cost Breakdown
                </CardTitle>
                <div className="text-right">
                  <p className="text-2xl font-bold">{formatCurrency(maintenanceTotal)}</p>
                  <p className="text-xs text-muted-foreground">Total spend in {selectedYear}</p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {maintenanceLoading ? (
                <div className="space-y-3">
                  {[...Array(6)].map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : maintenanceCosts.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  No maintenance data for this period
                </p>
              ) : (
                <div className="space-y-3">
                  {maintenanceCosts.map((item, i) => {
                    const percentage = maintenanceTotal > 0
                      ? (item.total_cost / maintenanceTotal) * 100
                      : 0;
                    return (
                      <div key={i} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span>{item.period}</span>
                          <div className="flex items-center gap-4">
                            <span className="text-muted-foreground">
                              {item.parts_count} parts
                            </span>
                            <span className="font-medium w-28 text-right">
                              {formatCurrency(item.total_cost)}
                            </span>
                          </div>
                        </div>
                        <Progress value={percentage} className="h-2" />
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Verification Status Tab */}
        <TabsContent value="verification" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  Verification Status by Location
                </CardTitle>
                <Badge variant={verificationAvg >= 80 ? 'default' : 'secondary'}>
                  {verificationAvg}% Average
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {verificationLoading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : verificationStatus.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  No verification data available
                </p>
              ) : (
                <div className="space-y-4">
                  {verificationStatus.map((item) => {
                    const rate = Math.round((item.verification_rate || 0) * 100);
                    return (
                      <div key={item.location_id} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{item.location_name}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">
                              {item.verified_plants} / {item.total_plants}
                            </span>
                            <Badge
                              variant={rate >= 80 ? 'default' : rate >= 50 ? 'secondary' : 'destructive'}
                              className="w-16 justify-center"
                            >
                              {rate}%
                            </Badge>
                          </div>
                        </div>
                        <Progress
                          value={rate}
                          className={`h-2 ${
                            rate >= 80
                              ? '[&>div]:bg-success'
                              : rate >= 50
                              ? '[&>div]:bg-yellow-500'
                              : '[&>div]:bg-destructive'
                          }`}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Unverified Plants Tab */}
        <TabsContent value="unverified" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                Plants Missing Verification (2+ weeks)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {unverifiedLoading ? (
                <div className="space-y-2">
                  {[...Array(10)].map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : unverifiedPlants.length === 0 ? (
                <div className="text-center py-8">
                  <CheckCircle className="h-12 w-12 mx-auto text-success mb-2" />
                  <p className="text-muted-foreground">All plants are verified</p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[100px]">Fleet #</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="w-[150px]">Location</TableHead>
                        <TableHead className="w-[120px]">Last Verified</TableHead>
                        <TableHead className="w-[100px] text-center">Weeks</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unverifiedPlants.map((plant) => (
                        <TableRow key={plant.plant_id}>
                          <TableCell className="font-mono font-medium">
                            {plant.fleet_number}
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate">
                            {plant.description || '-'}
                          </TableCell>
                          <TableCell>{plant.current_location}</TableCell>
                          <TableCell>
                            {plant.last_verified_date
                              ? formatDate(plant.last_verified_date)
                              : 'Never'}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant={
                                plant.weeks_since_verification >= 4
                                  ? 'destructive'
                                  : 'secondary'
                              }
                            >
                              {plant.weeks_since_verification}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-NG', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
