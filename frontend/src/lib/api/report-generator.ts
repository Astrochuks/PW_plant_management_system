import apiClient from '@/lib/api/client';

// ── Types ───────────────────────────────────────────────────────────

export interface ReportMeta {
  period: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  label: string;
  date_from: string;
  date_to: string;
  generated_at: string;
  filters: {
    location_name: string | null;
    state_name: string | null;
    fleet_type: string | null;
  };
}

export interface FleetCondition {
  total_plants: number;
  working: number;
  standby: number;
  breakdown: number;
  under_repair: number;
  missing: number;
  scrap: number;
  off_hire: number;
  faulty: number;
  utilization_rate: number;
}

export interface FleetByType {
  fleet_type: string;
  total: number;
  working: number;
  standby: number;
  breakdown: number;
  under_repair: number;
  other: number;
}

export interface StateSummaryRow {
  name: string;
  code: string;
  region: string | null;
  sites_count: number;
  total_plants: number;
  working: number;
  breakdown: number;
  under_repair: number;
  missing: number;
  scrap: number;
}

export interface SiteBreakdownRow {
  location_name: string;
  state_name: string;
  state_code: string;
  total_plants: number;
  working: number;
  breakdown: number;
  under_repair: number;
  standby: number;
  missing: number;
  scrap: number;
  fleet_types: Record<string, number>;
}

export interface SparePartsSummary {
  total_items: number;
  total_pos: number;
  plants_with_parts: number;
  total_spend: number;
  avg_cost_per_item: number;
}

export interface TopSupplier {
  supplier_name: string;
  items_count: number;
  po_count: number;
  total_spend: number;
}

export interface HighCostPlant {
  fleet_number: string;
  description: string | null;
  fleet_type: string | null;
  condition: string;
  location_name: string | null;
  parts_count: number;
  total_spend: number;
}

export interface SiteSpend {
  location_name: string;
  state_name: string | null;
  total_spend: number;
  items_count: number;
  po_count: number;
}

export interface TransferDetail {
  fleet_number: string;
  fleet_type: string | null;
  description: string | null;
  from_location: string;
  to_location: string;
  transfer_date: string;
}

export interface GeneratedReport {
  meta: ReportMeta;
  fleet_condition: FleetCondition;
  fleet_by_type: FleetByType[];
  states_summary: StateSummaryRow[];
  sites_breakdown: SiteBreakdownRow[];
  spare_parts: {
    summary: SparePartsSummary;
    top_suppliers: TopSupplier[];
    high_cost_plants: HighCostPlant[];
    sites_ranking: SiteSpend[];
  };
  transfers: {
    total: number;
    details: TransferDetail[];
  };
}

export interface GenerateReportParams {
  period: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  date: string; // ISO date
  location_id?: string;
  state_id?: string;
  fleet_type?: string;
}

export async function generateReport(params: GenerateReportParams): Promise<GeneratedReport> {
  const qp: Record<string, string> = {
    period: params.period,
    date: params.date,
  };
  if (params.location_id) qp.location_id = params.location_id;
  if (params.state_id) qp.state_id = params.state_id;
  if (params.fleet_type) qp.fleet_type = params.fleet_type;

  const res = await apiClient.get<{ success: boolean; data: GeneratedReport }>(
    '/reports/generate',
    { params: qp },
  );
  return res.data.data;
}

// ── NGN formatter ───────────────────────────────────────────────────

export function formatNGN(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
