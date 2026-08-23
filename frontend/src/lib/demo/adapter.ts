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

  // Writes are inert — the demo is read-only by construction.
  const method = (config.method || 'get').toLowerCase()
  if (method !== 'get') {
    await new Promise((r) => setTimeout(r, LATENCY_MS))
    return ok(config, { success: true, data: null, message: 'Demo mode — not saved' })
  }

  await new Promise((r) => setTimeout(r, LATENCY_MS))
  return ok(config, route(path, params))
}
