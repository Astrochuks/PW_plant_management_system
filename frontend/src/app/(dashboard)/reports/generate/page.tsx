'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, FileBarChart, Download, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useMutation } from '@tanstack/react-query';
import { generateReport, formatNGN, type GeneratedReport } from '@/lib/api/report-generator';
import { useLocations } from '@/hooks/use-plants';
import { useStates } from '@/hooks/use-locations';
import { useFleetSummary } from '@/hooks/use-dashboard';

type Period = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export default function ReportGeneratorPage() {
  const [period, setPeriod] = useState<Period>('weekly');
  const [refDate, setRefDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [locationId, setLocationId] = useState<string>('');
  const [stateId, setStateId] = useState<string>('');
  const [fleetType, setFleetType] = useState<string>('');

  const { data: locations } = useLocations();
  const { data: states } = useStates();
  const { data: fleetTypes } = useFleetSummary();

  const { data: report, isPending, mutate } = useMutation({
    mutationFn: generateReport,
  });

  const handleGenerate = useCallback(() => {
    mutate({
      period,
      date: refDate,
      location_id: locationId || undefined,
      state_id: stateId || undefined,
      fleet_type: fleetType || undefined,
    });
  }, [period, refDate, locationId, stateId, fleetType, mutate]);

  const handleExport = useCallback(async () => {
    if (!report) return;
    const XLSX = await import('xlsx');
    const { utils, writeFile } = XLSX;
    const wb = utils.book_new();

    const meta = report.meta;
    const title = 'P.W. NIGERIA LTD.';
    const subtitle = `Fleet Report — ${meta.label}`;
    const dateRange = `Period: ${meta.date_from} to ${meta.date_to}`;
    const filters = [meta.filters.state_name, meta.filters.location_name, meta.filters.fleet_type].filter(Boolean).join(' · ');
    const generated = `Generated: ${meta.generated_at}`;

    /** Helper: create a sheet with a title header block, then data table below */
    function makeSheet(
      sheetTitle: string,
      headers: string[],
      rows: (string | number)[][],
      colWidths: number[],
    ) {
      // Build AOA: title rows + blank + header + data
      const aoa: (string | number)[][] = [
        [title],
        [subtitle],
        [dateRange + (filters ? '  |  Filters: ' + filters : '')],
        [generated],
        [],  // blank row
        [sheetTitle],
        [],  // blank row
        headers,
        ...rows,
      ];

      const ws = utils.aoa_to_sheet(aoa);

      // Column widths
      ws['!cols'] = colWidths.map(w => ({ wch: w }));

      // Merge title rows across all columns
      const numCols = headers.length;
      ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: numCols - 1 } }, // Title
        { s: { r: 1, c: 0 }, e: { r: 1, c: numCols - 1 } }, // Subtitle
        { s: { r: 2, c: 0 }, e: { r: 2, c: numCols - 1 } }, // Date range
        { s: { r: 3, c: 0 }, e: { r: 3, c: numCols - 1 } }, // Generated
        { s: { r: 5, c: 0 }, e: { r: 5, c: numCols - 1 } }, // Section title
      ];

      return ws;
    }

    // ── Sheet 1: Fleet Condition Summary ─────────────────────────
    const fc = report.fleet_condition;
    const fcRows: (string | number)[][] = [
      ['Total Plants', fc.total_plants],
      ['Working', fc.working],
      ['Standby', fc.standby],
      ['Breakdown', fc.breakdown],
      ['Missing', fc.missing],
      ['Scrap', fc.scrap],
      ['Off Hire', fc.off_hire],
      ['Unknown (carried forward)', fc.unknown ?? 0],
      [],
      ['Utilization Rate', `${fc.utilization_rate}%`],
    ];
    const fcAoa: (string | number)[][] = [
      [title], [subtitle], [dateRange + (filters ? '  |  Filters: ' + filters : '')], [generated],
      [],
      ['FLEET CONDITION SUMMARY'],
      [],
      ['Condition', 'Count'],
      ...fcRows,
    ];
    const wsFC = utils.aoa_to_sheet(fcAoa);
    wsFC['!cols'] = [{ wch: 20 }, { wch: 15 }];
    wsFC['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 1 } },
      { s: { r: 3, c: 0 }, e: { r: 3, c: 1 } },
      { s: { r: 5, c: 0 }, e: { r: 5, c: 1 } },
    ];
    utils.book_append_sheet(wb, wsFC, 'Fleet Summary');

    // ── Sheet 2: Fleet By Type ───────────────────────────────────
    {
      const headers = ['Fleet Type', 'Total', 'Working', 'Standby', 'Breakdown', 'Other'];
      const rows = report.fleet_by_type.map(r => [r.fleet_type, r.total, r.working, r.standby, r.breakdown, r.other]);
      // Add totals row
      rows.push([
        'TOTAL',
        rows.reduce((s, r) => s + (r[1] as number), 0),
        rows.reduce((s, r) => s + (r[2] as number), 0),
        rows.reduce((s, r) => s + (r[3] as number), 0),
        rows.reduce((s, r) => s + (r[4] as number), 0),
        rows.reduce((s, r) => s + (r[5] as number), 0),
        rows.reduce((s, r) => s + (r[6] as number), 0),
      ]);
      utils.book_append_sheet(wb, makeSheet('FLEET BY TYPE', headers, rows, [20, 10, 10, 10, 12, 12, 10]), 'By Fleet Type');
    }

    // ── Sheet 3: States Summary ──────────────────────────────────
    {
      const headers = ['State', 'Code', 'Region', 'Sites', 'Total Plants', 'Working', 'Breakdown', 'Missing', 'Scrap', 'Unknown'];
      const rows = report.states_summary.map(r => [r.name, r.code, r.region || '', r.sites_count, r.total_plants, r.working, r.breakdown, r.missing, r.scrap, r.unknown ?? 0]);
      utils.book_append_sheet(wb, makeSheet('STATES SUMMARY', headers, rows, [18, 8, 14, 8, 12, 10, 12, 12, 10, 10]), 'States');
    }

    // ── Sheet 4: Sites Breakdown with Fleet Distribution ────────
    {
      const ftSet = new Set<string>();
      report.sites_breakdown.forEach(r => Object.keys(r.fleet_types).forEach(ft => ftSet.add(ft)));
      const ftNames = Array.from(ftSet).sort();
      const headers = ['#', 'Site', 'State', 'Total Plants', 'Working', 'Breakdown', 'Standby', 'Missing', 'Scrap', 'Unknown', ...ftNames];
      const dataRows = report.sites_breakdown.map((r, i) => [
        i + 1, r.location_name, r.state_name, r.total_plants, r.working, r.breakdown, r.standby, r.missing, r.scrap, r.unknown ?? 0,
        ...ftNames.map(ft => r.fleet_types[ft] || 0),
      ]);
      // Grand total row
      const totalRow: (string | number)[] = ['', 'GRAND TOTAL', ''];
      for (let c = 3; c < headers.length; c++) {
        totalRow.push(dataRows.reduce((s, r) => s + (r[c] as number), 0));
      }
      dataRows.push(totalRow);
      const colWidths = [5, 28, 16, 12, 10, 12, 12, 10, 10, 10, ...ftNames.map(() => 14)];
      utils.book_append_sheet(wb, makeSheet('SITES BREAKDOWN & FLEET DISTRIBUTION', headers, dataRows, colWidths), 'Sites');
    }

    // ── Sheet 5: Spare Parts & Maintenance ───────────────────────
    {
      const sp = report.spare_parts;
      const spAoa: (string | number)[][] = [
        [title], [subtitle], [dateRange + (filters ? '  |  Filters: ' + filters : '')], [generated],
        [],
        ['SPARE PARTS & MAINTENANCE COSTS'],
        [],
        ['Metric', 'Value'],
        ['Total Items Purchased', sp.summary.total_items],
        ['Total Purchase Orders', sp.summary.total_pos],
        ['Plants With Parts Replaced', sp.summary.plants_with_parts],
        ['Total Spend (NGN)', sp.summary.total_spend],
        ['Average Cost Per Item (NGN)', Math.round(sp.summary.avg_cost_per_item)],
        [],
        ['TOP SUPPLIERS BY SPEND'],
        [],
        ['#', 'Supplier', 'Items', 'POs', 'Total Spend (NGN)'],
        ...sp.top_suppliers.map((r, i) => [i + 1, r.supplier_name, r.items_count, r.po_count, r.total_spend]),
        [],
        ['SITE MAINTENANCE SPEND RANKING'],
        [],
        ['#', 'Site', 'State', 'Items', 'POs', 'Total Spend (NGN)'],
        ...sp.sites_ranking.map((r, i) => [i + 1, r.location_name, r.state_name || '', r.items_count, r.po_count, r.total_spend]),
      ];
      const wsSP = utils.aoa_to_sheet(spAoa);
      wsSP['!cols'] = [{ wch: 8 }, { wch: 30 }, { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 18 }];
      wsSP['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } },
        { s: { r: 3, c: 0 }, e: { r: 3, c: 5 } },
        { s: { r: 5, c: 0 }, e: { r: 5, c: 5 } },
      ];
      utils.book_append_sheet(wb, wsSP, 'Spare Parts');
    }

    // ── Sheet 6: High Cost Plants ────────────────────────────────
    if (report.spare_parts.high_cost_plants.length > 0) {
      const headers = ['#', 'Fleet Number', 'Description', 'Fleet Type', 'Condition', 'Location', 'Parts Count', 'Total Spend (NGN)'];
      const rows = report.spare_parts.high_cost_plants.map((r, i) => [
        i + 1, r.fleet_number, r.description || '', r.fleet_type || '', r.condition, r.location_name || '', r.parts_count, r.total_spend,
      ]);
      utils.book_append_sheet(wb, makeSheet(`PLANTS WITH MAINTENANCE COSTS (${rows.length})`, headers, rows, [5, 14, 30, 14, 14, 22, 12, 18]), 'Maintenance Costs');
    }

    // ── Sheet 7: Confirmed Transfers ────────────────────────────
    if (report.transfers.details.length > 0) {
      const headers = ['#', 'Fleet Number', 'Fleet Type', 'Description', 'From', 'To', 'Date'];
      const rows = report.transfers.details.map((r, i) => [
        i + 1, r.fleet_number, r.fleet_type || '', r.description || '', r.from_location, r.to_location, r.transfer_date,
      ]);
      utils.book_append_sheet(wb, makeSheet(
        `CONFIRMED TRANSFERS (${report.transfers.total})`,
        headers, rows,
        [5, 14, 14, 28, 22, 22, 12],
      ), 'Transfers');
    }

    const fileName = `PW_Fleet_Report_${meta.label.replace(/[\s,]/g, '_')}.xlsx`;
    writeFile(wb, fileName);
  }, [report]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/reports"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileBarChart className="h-6 w-6" /> Report Generator
          </h1>
          <p className="text-sm text-muted-foreground">
            Generate comprehensive fleet reports for any period
          </p>
        </div>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Period</label>
              <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Reference Date</label>
              <Input
                type="date"
                value={refDate}
                onChange={e => setRefDate(e.target.value)}
                className="w-[160px]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">State</label>
              <Select value={stateId || '_all'} onValueChange={v => setStateId(v === '_all' ? '' : v)}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="All States" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All States</SelectItem>
                  {states?.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Site</label>
              <Select value={locationId || '_all'} onValueChange={v => setLocationId(v === '_all' ? '' : v)}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All Sites" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Sites</SelectItem>
                  {locations?.map(l => (
                    <SelectItem key={l.id} value={l.id}>{l.location_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Fleet Type</label>
              <Select value={fleetType || '_all'} onValueChange={v => setFleetType(v === '_all' ? '' : v)}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Fleet Types</SelectItem>
                  {fleetTypes?.map(ft => (
                    <SelectItem key={ft.fleet_type} value={ft.fleet_type}>{ft.fleet_type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={handleGenerate} disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileBarChart className="h-4 w-4 mr-2" />}
              Generate Report
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Loading */}
      {isPending && (
        <div className="space-y-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-64" />
          <Skeleton className="h-48" />
        </div>
      )}

      {/* Report Preview */}
      {report && !isPending && (
        <div className="space-y-6">
          {/* Report Header */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h2 className="text-xl font-bold">P.W. NIGERIA LTD. — Fleet Report</h2>
                  <p className="text-lg font-semibold text-muted-foreground">{report.meta.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {report.meta.date_from} to {report.meta.date_to} · Generated {report.meta.generated_at}
                  </p>
                  <div className="flex gap-2 mt-2">
                    {report.meta.filters.state_name && <Badge variant="outline">{report.meta.filters.state_name}</Badge>}
                    {report.meta.filters.location_name && <Badge variant="outline">{report.meta.filters.location_name}</Badge>}
                    {report.meta.filters.fleet_type && <Badge variant="outline">{report.meta.filters.fleet_type}</Badge>}
                  </div>
                </div>
                <Button onClick={handleExport}>
                  <Download className="h-4 w-4 mr-2" /> Export Excel
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Fleet Condition KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <KpiCard label="Total Plants" value={report.fleet_condition.total_plants} />
            <KpiCard label="Working" value={report.fleet_condition.working} color="text-emerald-600" />
            <KpiCard label="Breakdown" value={report.fleet_condition.breakdown} color="text-red-600" />
            <KpiCard label="Unknown" value={report.fleet_condition.unknown} color="text-slate-500" />
            <KpiCard label="Utilization" value={`${report.fleet_condition.utilization_rate}%`} color="text-primary" />
          </div>

          {/* Fleet By Type */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Fleet by Type</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fleet Type</TableHead>
                      <TableHead className="text-center">Total</TableHead>
                      <TableHead className="text-center">Working</TableHead>
                      <TableHead className="text-center">Standby</TableHead>
                      <TableHead className="text-center">Breakdown</TableHead>
                      <TableHead className="text-center">Other</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.fleet_by_type.map(row => (
                      <TableRow key={row.fleet_type}>
                        <TableCell className="font-medium">{row.fleet_type}</TableCell>
                        <TableCell className="text-center font-semibold">{row.total}</TableCell>
                        <TableCell className="text-center text-emerald-600">{row.working || '-'}</TableCell>
                        <TableCell className="text-center">{row.standby || '-'}</TableCell>
                        <TableCell className="text-center text-red-600">{row.breakdown || '-'}</TableCell>
                        <TableCell className="text-center text-muted-foreground">{row.other || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* States Summary */}
          {report.states_summary.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">States Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>State</TableHead>
                        <TableHead className="text-center">Sites</TableHead>
                        <TableHead className="text-center">Total</TableHead>
                        <TableHead className="text-center">Working</TableHead>
                        <TableHead className="text-center">B/Down</TableHead>
                        <TableHead className="text-center">Repair</TableHead>
                        <TableHead className="text-center">Missing</TableHead>
                        <TableHead className="text-center">Scrap</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.states_summary.map(row => (
                        <TableRow key={row.code}>
                          <TableCell className="font-medium">
                            {row.name}
                            <span className="text-xs text-muted-foreground ml-1">({row.code})</span>
                          </TableCell>
                          <TableCell className="text-center">{row.sites_count}</TableCell>
                          <TableCell className="text-center font-semibold">{row.total_plants}</TableCell>
                          <TableCell className="text-center text-emerald-600">{row.working || '-'}</TableCell>
                          <TableCell className="text-center text-red-600">{row.breakdown || '-'}</TableCell>
                            <TableCell className="text-center text-orange-500">{row.missing || '-'}</TableCell>
                          <TableCell className="text-center text-muted-foreground">{row.scrap || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Sites Breakdown with Fleet Type Distribution */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Sites Breakdown & Fleet Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              {(() => {
                // Collect all fleet types across sites
                const ftSet = new Set<string>();
                report.sites_breakdown.forEach(r => Object.keys(r.fleet_types).forEach(ft => ftSet.add(ft)));
                const fleetTypeNames = Array.from(ftSet).sort();
                return (
                  <div className="border rounded-lg overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>#</TableHead>
                          <TableHead>Site</TableHead>
                          <TableHead>State</TableHead>
                          <TableHead className="text-center">Total</TableHead>
                          <TableHead className="text-center">Working</TableHead>
                          <TableHead className="text-center">B/Down</TableHead>
                          <TableHead className="text-center">Repair</TableHead>
                          <TableHead className="text-center">Standby</TableHead>
                          <TableHead className="text-center">Missing</TableHead>
                          <TableHead className="text-center">Scrap</TableHead>
                          {fleetTypeNames.map(ft => (
                            <TableHead key={ft} className="text-center text-xs whitespace-nowrap">{ft}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.sites_breakdown.map((row, i) => (
                          <TableRow key={`${row.location_name}-${row.state_code}`}>
                            <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                            <TableCell className="font-medium whitespace-nowrap">{row.location_name}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{row.state_name}</TableCell>
                            <TableCell className="text-center font-semibold">{row.total_plants}</TableCell>
                            <TableCell className="text-center text-emerald-600">{row.working || '-'}</TableCell>
                            <TableCell className="text-center text-red-600">{row.breakdown || '-'}</TableCell>
                                <TableCell className="text-center">{row.standby || '-'}</TableCell>
                            <TableCell className="text-center text-orange-500">{row.missing || '-'}</TableCell>
                            <TableCell className="text-center text-muted-foreground">{row.scrap || '-'}</TableCell>
                            {fleetTypeNames.map(ft => (
                              <TableCell key={ft} className="text-center text-xs tabular-nums">
                                {row.fleet_types[ft] || <span className="text-muted-foreground/40">-</span>}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          {/* Spare Parts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Spare Parts Summary */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Spare Parts & Maintenance ({report.meta.label})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">Total Spend</p>
                    <p className="text-lg font-bold">{formatNGN(report.spare_parts.summary.total_spend)}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">Total POs</p>
                    <p className="text-lg font-bold">{report.spare_parts.summary.total_pos}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">Items Purchased</p>
                    <p className="text-lg font-bold">{report.spare_parts.summary.total_items}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">Avg Cost/Item</p>
                    <p className="text-lg font-bold">{formatNGN(report.spare_parts.summary.avg_cost_per_item)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Transfers Summary */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Confirmed Transfers ({report.meta.label})</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{report.transfers.total}</p>
                <p className="text-xs text-muted-foreground">confirmed transfers in this period</p>
              </CardContent>
            </Card>
          </div>

          {/* Top Suppliers */}
          {report.spare_parts.top_suppliers.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Top Suppliers by Spend</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead className="text-center">Items</TableHead>
                        <TableHead className="text-center">POs</TableHead>
                        <TableHead className="text-right">Total Spend</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.spare_parts.top_suppliers.map((row, i) => (
                        <TableRow key={row.supplier_name}>
                          <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="font-medium">{row.supplier_name}</TableCell>
                          <TableCell className="text-center">{row.items_count}</TableCell>
                          <TableCell className="text-center">{row.po_count}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{formatNGN(row.total_spend)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* High Cost Plants */}
          {report.spare_parts.high_cost_plants.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Plants with Maintenance Costs ({report.spare_parts.high_cost_plants.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Fleet No.</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Condition</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead className="text-center">Parts</TableHead>
                        <TableHead className="text-right">Total Spend</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.spare_parts.high_cost_plants.map((row, i) => (
                        <TableRow key={row.fleet_number}>
                          <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="font-mono font-medium">{row.fleet_number}</TableCell>
                          <TableCell className="text-xs max-w-[200px] truncate">{row.description || '-'}</TableCell>
                          <TableCell className="text-xs">{row.fleet_type || '-'}</TableCell>
                          <TableCell>
                            <ConditionBadge condition={row.condition} />
                          </TableCell>
                          <TableCell className="text-xs">{row.location_name || '-'}</TableCell>
                          <TableCell className="text-center">{row.parts_count}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{formatNGN(row.total_spend)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Confirmed Transfer Details */}
          {report.transfers.details.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Confirmed Transfers ({report.transfers.total})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Fleet No.</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>From</TableHead>
                        <TableHead>To</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.transfers.details.map((row, i) => (
                        <TableRow key={`${row.fleet_number}-${row.transfer_date}-${i}`}>
                          <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="font-mono font-medium">{row.fleet_number}</TableCell>
                          <TableCell className="text-xs">{row.fleet_type || '-'}</TableCell>
                          <TableCell className="text-xs max-w-[200px] truncate">{row.description || '-'}</TableCell>
                          <TableCell className="text-xs">{row.from_location}</TableCell>
                          <TableCell className="text-xs">{row.to_location}</TableCell>
                          <TableCell className="text-xs tabular-nums">
                            {new Date(row.transfer_date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Site Spend Ranking */}
          {report.spare_parts.sites_ranking.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Site Maintenance Spend Ranking</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Site</TableHead>
                        <TableHead>State</TableHead>
                        <TableHead className="text-center">Items</TableHead>
                        <TableHead className="text-center">POs</TableHead>
                        <TableHead className="text-right">Total Spend</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.spare_parts.sites_ranking.map((row, i) => (
                        <TableRow key={row.location_name}>
                          <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="font-medium">{row.location_name}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{row.state_name || '-'}</TableCell>
                          <TableCell className="text-center">{row.items_count}</TableCell>
                          <TableCell className="text-center">{row.po_count}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{formatNGN(row.total_spend)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold tabular-nums ${color || ''}`}>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
      </CardContent>
    </Card>
  );
}

function ConditionBadge({ condition }: { condition: string }) {
  const colors: Record<string, string> = {
    working: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
    breakdown: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    missing: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
    scrap: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${colors[condition] || 'bg-muted text-muted-foreground'}`}>
      {condition.replace('_', ' ')}
    </span>
  );
}
