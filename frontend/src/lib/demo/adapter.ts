/**
 * Demo mode: serve every API call from the synthetic dataset.
 *
 * Installed as an axios ADAPTER rather than an interceptor, so the
 * request never reaches the network. That means one hook covers the
 * whole app — no page, hook or API module changes, and no chance of a
 * demo build accidentally calling the real backend, because in demo
 * mode there is no backend to call.
 *
 * Anything unmatched returns an empty success rather than an error, so
 * a page nobody thought about degrades to "no data" instead of a stack
 * trace in front of a recruiter.
 */

import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios'

import {
  DEMO_NOW, executiveProjects, fleetTypes, isoWeekOf, locations, parts,
  plants, purchaseOrders, states, uuid,
} from './data'

export const DEMO_USER = {
  id: uuid(9001),
  email: 'demo@pw-plant.example',
  full_name: 'Demo User',
  role: 'admin',
  is_active: true,
  location_id: null,
}

const CONDITIONS = ['working', 'standby', 'breakdown', 'missing', 'scrap', 'off_hire'] as const

/** Latency, so the UI's loading states are visible rather than skipped. */
const LATENCY_MS = 120

function ok<T>(config: AxiosRequestConfig, data: T, status = 200): AxiosResponse<T> {
  return {
    data, status, statusText: 'OK',
    headers: {}, config: config as never, request: {},
  }
}

const wrap = (data: unknown, meta?: unknown) =>
  meta === undefined ? { success: true, data } : { success: true, data, meta }

// ── per-route builders ───────────────────────────────────────────────

function dashboard() {
  const by = (c: string) => plants.filter((p) => p.condition === c).length
  const top = [...locations].sort((a, b) => b.total_plants - a.total_plants).slice(0, 10)
  return wrap({
    plants: {
      total_plants: plants.length,
      working_plants: by('working'),
      standby_plants: by('standby'),
      breakdown_plants: by('breakdown'),
      missing_plants: by('missing'),
      scrap_plants: by('scrap'),
      off_hire_plants: by('off_hire'),
      unknown_condition_plants: 0,
      verified_plants: plants.filter((p) => p.physical_verification).length,
      unverified_plants: plants.filter((p) => !p.physical_verification).length,
    },
    top_locations: top,
    recent_submissions: locations.slice(0, 5).map((l, i) => ({
      id: uuid(8000 + i),
      year: 2026,
      week_number: isoWeekOf(DEMO_NOW) - i,
      week_ending_date: new Date(DEMO_NOW.getTime() - i * 7 * 86400000)
        .toISOString().slice(0, 10),
      location_id: l.id,
      submitted_at: new Date(DEMO_NOW.getTime() - i * 7 * 86400000).toISOString(),
      submitted_by_name: 'Site Engineer',
      submitted_by_email: 'site@pw-plant.example',
      upload_token_id: null,
      source_type: 'weekly_report',
      source_file_path: '', source_file_name: `week-${isoWeekOf(DEMO_NOW) - i}.xlsx`,
      source_file_size: 48213,
      status: 'completed',
      processing_started_at: new Date(DEMO_NOW.getTime() - i * 7 * 86400000).toISOString(),
      processing_completed_at: new Date(DEMO_NOW.getTime() - i * 7 * 86400000).toISOString(),
      plants_processed: l.total_plants, plants_created: 0, plants_updated: l.total_plants,
      errors: [], warnings: '',
      created_at: new Date(DEMO_NOW.getTime() - i * 7 * 86400000).toISOString(),
      updated_at: new Date(DEMO_NOW.getTime() - i * 7 * 86400000).toISOString(),
      processing_stats: {},
      location_name: l.location_name,
    })),
    unread_notifications: 2,
    total_sites: locations.length,
    total_states: states.length,
  })
}

function fleetSummary() {
  const types = [...new Set(plants.map((p) => p.fleet_type))]
  return wrap(
    types.map((t) => {
      const inType = plants.filter((p) => p.fleet_type === t)
      const c = (x: string) => inType.filter((p) => p.condition === x).length
      return {
        fleet_type: t, total: inType.length,
        working: c('working'), standby: c('standby'), breakdown: c('breakdown'),
        missing: c('missing'), scrap: c('scrap'), off_hire: c('off_hire'),
        unknown: 0,
      }
    }).sort((a, b) => b.total - a.total),
  )
}

function fleetDistribution() {
  return wrap(states.map((s) => {
    const sites = locations.filter((l) => l.state_id === s.id)
    return {
      state_name: s.name, state_code: s.code, region: s.region,
      total_plants: sites.reduce((n, l) => n + l.total_plants, 0),
      sites: sites.map((l) => {
        const here = plants.filter((p) => p.current_location_id === l.id)
        const byType: Record<string, number> = {}
        here.forEach((p) => { byType[p.fleet_type] = (byType[p.fleet_type] || 0) + 1 })
        return { site_name: l.location_name, total_plants: here.length, fleet_types: byType }
      }),
    }
  }))
}

function maintenanceCosts(params: URLSearchParams) {
  const groupBy = params.get('group_by') || 'month'
  const year = Number(params.get('year')) || 2026
  const inYear = parts.filter((p) => p.year === year)

  const buckets = new Map<string, { total: number; count: number }>()
  for (const p of inYear) {
    const key = groupBy === 'month'
      ? `${year}-${String(p.month).padStart(2, '0')}`
      : groupBy === 'quarter' ? `${year}-Q${p.quarter}`
      : groupBy === 'week' ? `${year}-W${String(p.week_number).padStart(2, '0')}`
      : String(year)
    const b = buckets.get(key) ?? { total: 0, count: 0 }
    b.total += p.total_cost_ngn
    b.count += 1
    buckets.set(key, b)
  }
  const rows = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([group_key, b]) => ({
      group_key,
      total_cost: Math.round(b.total * 100) / 100,
      part_count: b.count,
      avg_cost: Math.round((b.total / b.count) * 100) / 100,
    }))
  return wrap(rows, {
    group_by: groupBy, year, total_groups: rows.length,
    grand_total: Math.round(rows.reduce((s, r) => s + r.total_cost, 0) * 100) / 100,
  })
}

function statesSummary() {
  return wrap(states.map((s) => {
    const sites = locations.filter((l) => l.state_id === s.id)
    const here = plants.filter((p) => sites.some((l) => l.id === p.current_location_id))
    const c = (x: string) => here.filter((p) => p.condition === x).length
    return {
      id: s.id, name: s.name, code: s.code, region: s.region,
      sites_count: sites.length, total_plants: here.length,
      working_plants: c('working'), standby_plants: c('standby'),
      breakdown_plants: c('breakdown'), missing_plants: c('missing'),
      scrap_plants: c('scrap'), off_hire_plants: c('off_hire'),
      unknown_condition_plants: 0,
    }
  }).sort((a, b) => b.total_plants - a.total_plants))
}

function plantList(params: URLSearchParams) {
  const page = Number(params.get('page')) || 1
  const limit = Number(params.get('limit')) || 20
  const search = (params.get('search') || '').toLowerCase()

  let rows = [...plants]
  const condition = params.get('condition')
  if (condition) rows = rows.filter((p) => p.condition === condition)
  const fleetType = params.get('fleet_type')
  if (fleetType) rows = rows.filter((p) => p.fleet_type === fleetType)
  const locationId = params.get('location_id')
  if (locationId) rows = rows.filter((p) => p.current_location_id === locationId)
  const state = params.get('state')
  if (state) rows = rows.filter((p) => p.state === state)
  if (search) {
    rows = rows.filter((p) =>
      p.fleet_number.toLowerCase().includes(search) ||
      p.description.toLowerCase().includes(search) ||
      (p.make || '').toLowerCase().includes(search))
  }
  rows.sort((a, b) => a.fleet_number.localeCompare(b.fleet_number, undefined, { numeric: true }))

  const total = rows.length
  const start = (page - 1) * limit
  return wrap(rows.slice(start, start + limit), {
    page, limit, total,
    total_pages: Math.max(1, Math.ceil(total / limit)),
    has_more: start + limit < total,
    columns: '',
    filters: {
      condition: condition ?? null, fleet_type: fleetType ?? null,
      location_id: locationId ?? null, state: state ?? null,
      verified_only: false, unknown_location: false, pending_transfer: false,
    },
  })
}

function filteredStats() {
  const byLocation: Record<string, number> = {}
  locations.forEach((l) => { byLocation[l.location_name] = l.total_plants })
  const byCondition: Record<string, number> = {}
  CONDITIONS.forEach((c) => { byCondition[c] = plants.filter((p) => p.condition === c).length })
  const byFleetType: Record<string, number> = {}
  plants.forEach((p) => { byFleetType[p.fleet_type] = (byFleetType[p.fleet_type] || 0) + 1 })
  return wrap({
    total: plants.length,
    by_location: byLocation,
    by_condition: byCondition,
    by_fleet_type: byFleetType,
    by_state: Object.fromEntries(states.map((s) => [
      s.name,
      plants.filter((p) => p.state_id === s.id).length,
    ])),
  })
}

function poList(params: URLSearchParams) {
  const page = Number(params.get('page')) || 1
  const limit = Number(params.get('limit')) || 20
  const rows = [...purchaseOrders].sort((a, b) => b.po_date.localeCompare(a.po_date))
  const start = (page - 1) * limit
  return wrap(
    rows.slice(start, start + limit).map((po) => ({
      purchase_order_number: po.purchase_order_number,
      po_date: po.po_date,
      supplier_name: po.supplier_name,
      supplier: po.supplier_name,
      location_name: po.location_name,
      location_id: locations.find((l) => l.location_name === po.location_name)?.id ?? null,
      requisition_number: po.requisition_number,
      cost_type: po.cost_type,
      currency: po.currency,
      items_count: po.items_count,
      plants_count: po.plants_count,
      total_amount: po.total,
      total_cost_ngn: po.parts.reduce((s, p) => s + p.total_cost_ngn, 0),
      document_url: null,
    })),
    {
      page, limit, total: rows.length,
      total_pages: Math.max(1, Math.ceil(rows.length / limit)),
      grand_total: rows.reduce(
        (s, po) => s + po.parts.reduce((t, p) => t + p.total_cost_ngn, 0), 0),
    },
  )
}

function poDetail(poNumber: string) {
  const po = purchaseOrders.find(
    (p) => p.purchase_order_number.toUpperCase() === poNumber.toUpperCase())
  if (!po) return wrap([], { submissions: [] })
  return wrap(po.parts, {
    purchase_order_number: po.purchase_order_number,
    po_date: po.po_date,
    cost_type: po.cost_type,
    supplier_name: po.supplier_name,
    location_name: po.location_name,
    requisition_number: po.requisition_number,
    currency: po.currency,
    items_count: po.items_count,
    plants_count: po.plants_count,
    subtotal: po.goods,
    vat_amount: po.vat,
    discount_amount: 0,
    other_costs: 0,
    total_cost: po.total,
    submissions: [{
      submission_number: 1,
      items_count: po.items_count,
      total_cost: po.total,
      document_url: null,
      document_name: null,
      document_uploaded_at: null,
    }],
    overhead: null,
  })
}

function executive() {
  const t = executiveProjects
  const sum = (f: (p: (typeof t)[number]) => number) =>
    Math.round(t.reduce((s, p) => s + (f(p) || 0), 0) * 100) / 100
  const works = sum((p) => p.works)
  const net = sum((p) => p.net)
  return wrap({
    generated_at: DEMO_NOW.toISOString(),
    totals: {
      projects_reporting: t.length,
      projects_total: t.length,
      contract_sum: sum((p) => p.contract_sum),
      scope_incl_vat: sum((p) => p.scope_incl_vat),
      works_incl_vat: sum((p) => p.works_incl_vat),
      cost: sum((p) => p.cost),
      net,
      margin: Math.round((net / works) * 10000) / 10000,
      pct_complete: Math.round((works / sum((p) => p.scope)) * 10000) / 10000,
      certified: sum((p) => p.certified),
      paid_gross: sum((p) => p.paid_gross),
      certified_not_paid: sum((p) => p.certified_not_paid),
      retention_held: sum((p) => p.retention_held),
      oldest_unpaid_days: Math.max(...t.map((p) => p.days_since_payment || 0)),
      overdue_projects: t.filter((p) => p.schedule.status === 'BEHIND').length,
    },
    projects: t,
    series: t.flatMap((p) =>
      Array.from({ length: 8 }, (_, i) => {
        const wkEnd = new Date(DEMO_NOW.getTime() - (7 - i) * 7 * 86400000)
        const frac = (i + 1) / 8
        return {
          project_id: p.id,
          year: wkEnd.getUTCFullYear(),
          week_number: isoWeekOf(wkEnd),
          week_ending_date: wkEnd.toISOString().slice(0, 10),
          works: Math.round(p.works * frac * 100) / 100,
          works_incl_vat: Math.round(p.works_incl_vat * frac * 100) / 100,
          cost: Math.round(p.cost * frac * 100) / 100,
          net: Math.round(p.net * frac * 100) / 100,
        }
      })),
    cost_series: t.flatMap((p) =>
      ['LABOUR', 'PLANT', 'MATERIALS', 'DIESEL', 'SUBCONTRACT'].flatMap((category, ci) =>
        Array.from({ length: 4 }, (_, i) => {
          const wkEnd = new Date(DEMO_NOW.getTime() - (3 - i) * 7 * 86400000)
          return {
            project_id: p.id,
            year: wkEnd.getUTCFullYear(),
            week_number: isoWeekOf(wkEnd),
            week_ending_date: wkEnd.toISOString().slice(0, 10),
            category,
            amount: Math.round(p.cost * (0.08 + ci * 0.03) * 0.25 * 100) / 100,
          }
        })),
    ),
  })
}

// ── the report generator ─────────────────────────────────────────────

const PERIOD_LABEL: Record<string, (d: Date) => [string, Date, Date]> = {
  weekly: (d) => {
    const start = new Date(d)
    start.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
    const end = new Date(start.getTime() + 6 * 86400000)
    return [`Week ${isoWeekOf(d)}, ${d.getUTCFullYear()}`, start, end]
  },
  monthly: (d) => {
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
    return [
      start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      start, end,
    ]
  },
  quarterly: (d) => {
    const q = Math.floor(d.getUTCMonth() / 3)
    const start = new Date(Date.UTC(d.getUTCFullYear(), q * 3, 1))
    const end = new Date(Date.UTC(d.getUTCFullYear(), q * 3 + 3, 0))
    return [`Q${q + 1} ${d.getUTCFullYear()}`, start, end]
  },
  yearly: (d) => [
    String(d.getUTCFullYear()),
    new Date(Date.UTC(d.getUTCFullYear(), 0, 1)),
    new Date(Date.UTC(d.getUTCFullYear(), 11, 31)),
  ],
}

function generateReport(params: URLSearchParams) {
  const period = params.get('period') || 'monthly'
  const date = new Date(params.get('date') || DEMO_NOW.toISOString().slice(0, 10))
  const [label, from, to] = (PERIOD_LABEL[period] ?? PERIOD_LABEL.monthly)(date)

  const locationId = params.get('location_id')
  const fleetType = params.get('fleet_type')
  const site = locations.find((l) => l.id === locationId)

  let scope = plants
  if (locationId) scope = scope.filter((p) => p.current_location_id === locationId)
  if (fleetType) scope = scope.filter((p) => p.fleet_type === fleetType)

  const c = (rows: typeof plants, k: string) => rows.filter((p) => p.condition === k).length
  const conditionsOf = (rows: typeof plants) => ({
    working: c(rows, 'working'), standby: c(rows, 'standby'),
    breakdown: c(rows, 'breakdown'), missing: c(rows, 'missing'),
    scrap: c(rows, 'scrap'), off_hire: c(rows, 'off_hire'), unknown: 0,
  })

  const fromISO = from.toISOString().slice(0, 10)
  const toISO = to.toISOString().slice(0, 10)
  const inPeriod = parts.filter(
    (p) => p.replaced_date >= fromISO && p.replaced_date <= toISO)
  const scopeFleet = new Set(scope.map((p) => p.fleet_number))
  const spend = inPeriod.filter(
    (p) => !locationId || p.location_id === locationId)

  const bySupplier = new Map<string, { items: number; pos: Set<string>; total: number }>()
  for (const p of spend) {
    const s = bySupplier.get(p.supplier) ?? { items: 0, pos: new Set<string>(), total: 0 }
    s.items += 1
    s.pos.add(`${p.purchase_order_number}|${p.po_date}`)
    s.total += p.total_cost_ngn
    bySupplier.set(p.supplier, s)
  }

  const perPlant = new Map<string, { n: number; total: number }>()
  for (const p of spend) {
    if (!p.plant_id) continue
    const e = perPlant.get(p.plant_id) ?? { n: 0, total: 0 }
    e.n += 1
    e.total += p.total_cost_ngn
    perPlant.set(p.plant_id, e)
  }

  const bySite = new Map<string, { total: number; items: number; pos: Set<string> }>()
  for (const p of spend) {
    const loc = locations.find((l) => l.id === p.location_id)
    const key = loc?.location_name ?? 'Unlocated'
    const e = bySite.get(key) ?? { total: 0, items: 0, pos: new Set<string>() }
    e.total += p.total_cost_ngn
    e.items += 1
    e.pos.add(`${p.purchase_order_number}|${p.po_date}`)
    bySite.set(key, e)
  }

  const money2 = (n: number) => Math.round(n * 100) / 100
  const totalSpend = money2(spend.reduce((s, p) => s + p.total_cost_ngn, 0))
  const types = [...new Set(scope.map((p) => p.fleet_type))]

  return wrap({
    meta: {
      period, label,
      date_from: fromISO, date_to: toISO,
      generated_at: DEMO_NOW.toISOString(),
      as_of: toISO,
      historical: to < DEMO_NOW,
      filters: {
        location_name: site?.location_name ?? null,
        state_name: params.get('state_id')
          ? states.find((s) => s.id === params.get('state_id'))?.name ?? null
          : null,
        fleet_type: fleetType,
      },
    },
    fleet_condition: {
      total_plants: scope.length,
      ...conditionsOf(scope),
      // a whole percentage — the page renders `${utilization_rate}%`
      utilization_rate: scope.length
        ? Math.round((c(scope, 'working') / scope.length) * 10000) / 100
        : 0,
    },
    fleet_by_type: types.map((t) => {
      const rows = scope.filter((p) => p.fleet_type === t)
      return { fleet_type: t, total: rows.length, ...conditionsOf(rows) }
    }).sort((a, b) => b.total - a.total),
    states_summary: states.map((s) => {
      const sites = locations.filter((l) => l.state_id === s.id)
      const rows = scope.filter((p) => sites.some((l) => l.id === p.current_location_id))
      return {
        name: s.name, code: s.code, region: s.region,
        sites_count: sites.length, total_plants: rows.length, ...conditionsOf(rows),
      }
    }).filter((r) => r.total_plants > 0).sort((a, b) => b.total_plants - a.total_plants),
    sites_breakdown: locations.map((l) => {
      const rows = scope.filter((p) => p.current_location_id === l.id)
      const byType: Record<string, number> = {}
      rows.forEach((p) => { byType[p.fleet_type] = (byType[p.fleet_type] || 0) + 1 })
      return {
        location_name: l.location_name,
        state_name: states.find((s) => s.id === l.state_id)?.name ?? '',
        state_code: states.find((s) => s.id === l.state_id)?.code ?? '',
        total_plants: rows.length, ...conditionsOf(rows), fleet_types: byType,
      }
    }).filter((r) => r.total_plants > 0).sort((a, b) => b.total_plants - a.total_plants),
    spare_parts: {
      summary: {
        total_items: spend.length,
        total_pos: new Set(spend.map((p) => `${p.purchase_order_number}|${p.po_date}`)).size,
        plants_with_parts: perPlant.size,
        total_spend: totalSpend,
        avg_cost_per_item: spend.length ? money2(totalSpend / spend.length) : 0,
      },
      top_suppliers: [...bySupplier.entries()]
        .map(([supplier_name, s]) => ({
          supplier_name, items_count: s.items, po_count: s.pos.size,
          total_spend: money2(s.total),
        }))
        .sort((a, b) => b.total_spend - a.total_spend).slice(0, 10),
      high_cost_plants: [...perPlant.entries()]
        .map(([id, e]) => {
          const p = plants.find((x) => x.id === id)!
          return {
            fleet_number: p.fleet_number, description: p.description,
            fleet_type: p.fleet_type, condition: p.condition,
            location_name: p.current_location,
            parts_count: e.n, total_spend: money2(e.total),
          }
        })
        .sort((a, b) => b.total_spend - a.total_spend).slice(0, 25),
      sites_ranking: [...bySite.entries()]
        .map(([location_name, e]) => ({
          location_name,
          state_name: locations.find((l) => l.location_name === location_name)
            ? states.find((s) => s.id === locations.find(
                (l) => l.location_name === location_name)!.state_id)?.name ?? null
            : null,
          total_spend: money2(e.total), items_count: e.items, po_count: e.pos.size,
        }))
        .sort((a, b) => b.total_spend - a.total_spend),
    },
    transfers: {
      total: Math.min(12, scope.length),
      details: scope.slice(0, 12).map((p, i) => ({
        fleet_number: p.fleet_number,
        fleet_type: p.fleet_type,
        description: p.description,
        from_location: locations[(i + 1) % locations.length].location_name,
        to_location: p.current_location,
        transfer_date: new Date(
          from.getTime() + (i + 1) * 86400000,
        ).toISOString().slice(0, 10),
      })),
    },
  })
}

/** Findings for the Executive brief PDF, in the kinds it knows how to render. */
function executiveBrief() {
  const [a, b, cc] = executiveProjects
  return wrap({
    generated_at: DEMO_NOW.toISOString(),
    findings: [
      {
        project_id: a.id, project: a.short_name,
        kind: 'fuel_unattributed', severity: 'high',
        impact_naira: 14_207_400,
        facts: {
          charged_litres: 41_820, logged_litres: 30_047, gap_litres: 11_773,
          gap_share: 0.2815, avg_rate: 1206.8, ago_spend: 50_468_376, weeks: 12,
          repeat: {
            weeks: 7, from_year: 2026, from_week: 21,
            to_year: 2026, to_week: 27, plants: 9, litres: 3_150,
          },
        },
      },
      {
        project_id: b.id, project: b.short_name,
        kind: 'diesel_price', severity: 'high',
        impact_naira: 8_940_000,
        facts: {
          rate_pct: 0.3333, from_rate: 1200, to_rate: 1600,
          from_year: 2026, from_week: 24, to_year: 2026, to_week: 25,
          spend_pct: 0.4712, litres_pct: 0.1034,
          extra_naira: 8_940_000, ago_spend: 63_120_500,
        },
      },
      {
        project_id: cc.id, project: cc.short_name,
        kind: 'stale_reporting', severity: 'medium',
        impact_naira: 0,
        // field names taken from composeFinding()'s stale branch — it
        // reads week_ending / year / week / weeks_received, not the
        // last_year / last_week you might expect from the other kinds
        facts: {
          days: 34,
          week_ending: '2026-07-12',
          year: 2026,
          week: 28,
          weeks_received: 41,
        },
      },
    ],
  })
}

/** A genuine .xlsx, built in the browser — the demo has no server to ask. */
async function plantsExcel(params: URLSearchParams): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'P.W. Nigeria — Plant Management System (demo)'
  const ws = wb.addWorksheet('Fleet Register')

  ws.columns = [
    { header: 'Fleet Number', key: 'fleet_number', width: 14 },
    { header: 'Description', key: 'description', width: 26 },
    { header: 'Fleet Type', key: 'fleet_type', width: 22 },
    { header: 'Make', key: 'make', width: 14 },
    { header: 'Model', key: 'model', width: 14 },
    { header: 'Condition', key: 'condition', width: 12 },
    { header: 'Site', key: 'current_location', width: 24 },
    { header: 'State', key: 'state', width: 14 },
    { header: 'Verified', key: 'verified', width: 10 },
    { header: 'Last Verified', key: 'last_verified_date', width: 14 },
    { header: 'Maintenance Cost (NGN)', key: 'total_maintenance_cost', width: 22 },
    { header: 'Parts Replaced', key: 'parts_replaced_count', width: 14 },
  ]
  ws.getRow(1).font = { bold: true }
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  const rows = (route('/plants', new URLSearchParams([
    ...[...params.entries()].filter(([k]) => k !== 'page' && k !== 'limit'),
    ['limit', '100000'], ['page', '1'],
  ])) as { data: typeof plants }).data

  rows.forEach((p) => ws.addRow({
    ...p,
    verified: p.physical_verification ? 'Yes' : 'No',
  }))
  ws.getColumn('total_maintenance_cost').numFmt = '#,##0.00'

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

// ── router ───────────────────────────────────────────────────────────

function route(path: string, params: URLSearchParams): unknown {
  // exact matches first
  switch (path) {
    case '/locations': return wrap(locations, { total: locations.length })
    case '/fleet-types': return wrap(fleetTypes)
    case '/auth/me': return wrap(DEMO_USER)
    case '/notifications/unread-count': return wrap({ unread_count: 2 })
    case '/transfers/stats/summary':
      return wrap({ pending: 0, confirmed: 14, cancelled: 1, recent_7_days: 2, new_since: 0 })
    case '/transfers/site-requests': return { success: true, data: [], count: 0 }
    case '/reports/dashboard': return dashboard()
    case '/reports/fleet-summary': return fleetSummary()
    case '/reports/fleet-distribution': return fleetDistribution()
    case '/reports/maintenance-costs': return maintenanceCosts(params)
    case '/reports/states-summary': return statesSummary()
    case '/reports/recently-purchased':
      return wrap(plants.filter((p) => p.purchase_year)
        .sort((a, b) => (b.purchase_year || 0) - (a.purchase_year || 0))
        .slice(0, Number(params.get('limit')) || 5)
        .map((p) => ({
          id: p.id, fleet_number: p.fleet_number, description: p.description,
          fleet_type: p.fleet_type, make: p.make, model: p.model,
          purchase_year: p.purchase_year, purchase_month: p.purchase_month,
          purchase_cost: p.purchase_cost, condition: p.condition,
          current_location_id: p.current_location_id,
          current_location: p.current_location,
        })))
    case '/plants': return plantList(params)
    case '/plants/filtered-stats': return filteredStats()
    case '/plants/purchase-years':
      return wrap([...new Set(plants.map((p) => p.purchase_year).filter(Boolean))]
        .sort((a, b) => (b as number) - (a as number)))
    case '/projects/executive': return executive()
    case '/projects/executive/brief': return executiveBrief()
    case '/reports/generate': return generateReport(params)
    case '/spare-parts/pos': return poList(params)
    case '/notifications':
      return wrap([
        {
          id: uuid(8100), target_user_id: null, type: 'weekly_report',
          title: 'Weekly report received',
          message: `${locations[0].location_name} submitted week ${isoWeekOf(DEMO_NOW)}`,
          entity_type: null, entity_id: null, action_url: null, action_label: null,
          read_at: null, dismissed_at: null,
          created_at: new Date(DEMO_NOW.getTime() - 3600000).toISOString(),
          target_role: 'admin', read: false, data: '{}',
        },
        {
          id: uuid(8101), target_user_id: null, type: 'transfer',
          title: 'Transfer confirmed',
          message: `A plant moved to ${locations[2].location_name}`,
          entity_type: null, entity_id: null, action_url: null, action_label: null,
          read_at: null, dismissed_at: null,
          created_at: new Date(DEMO_NOW.getTime() - 86400000).toISOString(),
          target_role: 'admin', read: false, data: '{}',
        },
      ], { page: 1, limit: 5, total: 2, total_pages: 1, unread_count: 2 })
  }

  // parameterised
  let m = path.match(/^\/spare-parts\/by-po\/(.+)$/)
  if (m) return poDetail(decodeURIComponent(m[1]))

  m = path.match(/^\/plants\/([0-9a-f-]{36})$/)
  if (m) {
    const p = plants.find((x) => x.id === m![1])
    return p ? wrap(p) : wrap(null)
  }

  m = path.match(/^\/plants\/([0-9a-f-]{36})\/maintenance-history$/)
  if (m) {
    const p = plants.find((x) => x.id === m![1])
    const own = parts.filter((x) => x.plant_id === m![1])
      .sort((a, b) => b.replaced_date.localeCompare(a.replaced_date))
    return wrap(own.map((x) => ({
      id: x.id, replaced_date: x.replaced_date, part_description: x.part_description,
      part_number: x.part_number, supplier: x.supplier, quantity: x.quantity,
      unit_cost: x.unit_cost, total_cost: x.total_cost,
      total_cost_ngn: x.total_cost_ngn, currency: x.currency,
      purchase_order_number: x.purchase_order_number, po_date: x.po_date,
      reason_for_change: x.reason_for_change, fleet_number: p?.fleet_number ?? null,
    })))
  }

  m = path.match(/^\/spare-parts\/plant\/([0-9a-f-]{36})\/costs$/)
  if (m) {
    const own = parts.filter((x) => x.plant_id === m![1])
    return wrap({
      direct_cost: Math.round(own.reduce((s, x) => s + x.total_cost_ngn, 0) * 100) / 100,
      shared_cost: 0,
      total_cost: Math.round(own.reduce((s, x) => s + x.total_cost_ngn, 0) * 100) / 100,
      parts_count: own.length,
    })
  }

  // Unmatched: an empty success, so an unconsidered page shows "no data"
  // rather than an error in front of a visitor.
  return wrap([])
}

export const demoAdapter: AxiosAdapter = async (config) => {
  const raw = config.url || ''
  const [rawPath, rawQuery] = raw.split('?')
  const path = rawPath.replace(/^.*\/api\/v1/, '').replace(/\/$/, '') || '/'
  const params = new URLSearchParams(rawQuery || '')
  for (const [k, v] of Object.entries(config.params ?? {})) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }

  const method = (config.method || 'get').toLowerCase()

  if (method !== 'get') {
    await new Promise((r) => setTimeout(r, LATENCY_MS))

    // Sign-in must actually work. Without this, "Sign out" is a dead
    // end — the form posts to an auth server that does not exist, and
    // the visitor is stranded on a login page forever. Any credentials
    // are accepted; there is nothing to authenticate against.
    //
    // Note the shape: `login()` reads `response.data` directly, NOT the
    // {success, data} envelope everything else uses.
    if (path === '/auth/login') {
      return ok(config, {
        access_token: 'demo-token',
        refresh_token: 'demo-refresh',
        token_type: 'bearer',
        expires_in: 365 * 24 * 3600,
        user: DEMO_USER,
      })
    }

    // Every other write is inert — the demo is read-only by construction.
    return ok(config, { success: true, data: null, message: 'Demo mode — not saved' })
  }

  await new Promise((r) => setTimeout(r, LATENCY_MS))

  // Blob endpoints: the caller asked for a file, so hand back real bytes
  // rather than JSON it would try to save as a spreadsheet.
  if (path === '/plants/export/excel') {
    return ok(config, await plantsExcel(params))
  }

  return ok(config, route(path, params))
}
