/**
 * Synthetic dataset for the public demo.
 *
 * EVERY FIGURE HERE IS INVENTED. No PW Nigeria plant, supplier, price,
 * purchase order or project value appears in this file, and the demo
 * build never talks to the real API — see `adapter.ts`. That is the
 * whole point: the portfolio link has to show the system working
 * without publishing the company's commercial data.
 *
 * The SHAPE is real, captured from the live endpoints, so the pages
 * render exactly as they do in production: the six conditions, the
 * direct/shared purchase-order split, VAT on the PO, multi-currency
 * lines, ISO weeks.
 *
 * Generation is seeded, so the demo looks identical on every visit and
 * on every deploy — a screenshot in a CV still matches the live link.
 */

// ── deterministic RNG (mulberry32) ──────────────────────────────────
function rng(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = rng(20260812)
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
/** Two-decimal money, so nothing carries float noise into the UI. */
const money2 = (lo: number, hi: number) =>
  Math.round((lo + rand() * (hi - lo)) * 100) / 100

const uuid = (n: number) =>
  `${n.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

const iso = (d: Date) => d.toISOString()
const day = (d: Date) => d.toISOString().slice(0, 10)
const DEMO_TODAY = new Date('2026-08-12T09:00:00Z')
const daysAgo = (n: number) =>
  new Date(DEMO_TODAY.getTime() - n * 86400000)

// ── the six conditions, weighted like a real fleet ───────────────────
export const CONDITIONS = [
  'working', 'standby', 'breakdown', 'missing', 'scrap', 'off_hire',
] as const
const CONDITION_WEIGHTS: Array<(typeof CONDITIONS)[number]> = [
  ...Array(26).fill('working'),
  ...Array(30).fill('standby'),
  ...Array(20).fill('breakdown'),
  ...Array(17).fill('missing'),
  ...Array(5).fill('scrap'),
  ...Array(2).fill('off_hire'),
]

// ── invented sites, invented states ──────────────────────────────────
const STATE_DEFS = [
  { name: 'Northgate', code: 'NGT', region: 'North Central' },
  { name: 'Riverside', code: 'RVS', region: 'South South' },
  { name: 'Highvale', code: 'HVL', region: 'North West' },
  { name: 'Eastmoor', code: 'EMR', region: 'South East' },
  { name: 'Westfield', code: 'WFD', region: 'South West' },
  { name: 'Stonebridge', code: 'SBR', region: 'North East' },
]

const SITE_DEFS: Array<[string, number]> = [
  ['NORTHGATE QUARRY', 0], ['NORTHGATE PLANT YARD', 0],
  ['RIVERSIDE TERMINAL', 1], ['RIVERSIDE CIVIL', 1],
  ['HIGHVALE ROAD 12', 2], ['HIGHVALE DEPOT', 2],
  ['EASTMOOR AIRPORT', 3],
  ['WESTFIELD BYPASS', 4], ['WESTFIELD QUARRY', 4],
  ['STONEBRIDGE DAM', 5], ['STONEBRIDGE CAMP', 5],
  ['CENTRAL WORKSHOP', 0],
]

const FLEET_TYPES: Array<[string, string]> = [
  ['EXCAVATOR', 'E'], ['TRUCKS', 'T'], ['DUMP TRUCKS', 'DT'],
  ['ELECTRIC GENERATOR', 'EG'], ['AIR COMPRESSOR', 'AC'],
  ['WATER PUMP', 'WP'], ['DOZERS', 'D'], ['PAY-LOADERS', 'PL'],
  ['GRADER', 'GR'], ['VIBRATING ROLLER', 'VR'], ['LOW-LOADER', 'LL'],
  ['CONCRETE MIXER', 'CM'],
]

const MAKES: Record<string, string[]> = {
  EXCAVATOR: ['Komatsu', 'Hitachi', 'Volvo'],
  TRUCKS: ['Mercedes', 'MAN', 'Scania'],
  'DUMP TRUCKS': ['Howo', 'Shacman'],
  'ELECTRIC GENERATOR': ['Perkins', 'Cummins'],
  'AIR COMPRESSOR': ['Atlas Copco', 'Ingersoll'],
  'WATER PUMP': ['Honda', 'Grundfos'],
  DOZERS: ['Caterpillar', 'Shantui'],
  'PAY-LOADERS': ['XCMG', 'Liugong'],
  GRADER: ['Caterpillar', 'XCMG'],
  'VIBRATING ROLLER': ['Bomag', 'Dynapac'],
  'LOW-LOADER': ['Faymonville'],
  'CONCRETE MIXER': ['Putzmeister'],
}

const SUPPLIERS = [
  'Harmattan Equipment Ltd', 'Delta Spares Nigeria', 'Ironclad Machinery',
  'Northwind Trading Co', 'Summit Parts & Service', 'Baobab Industrial',
  'Kestrel Hydraulics', 'Sable Diesel Systems',
]

const PART_NAMES = [
  'HYDRAULIC PUMP', 'BUCKET TIP', 'TRACK CHAIN', 'FUEL FILTER', 'OIL SEAL',
  'RETAINER', 'ALTERNATOR', 'STARTER MOTOR', 'BRAKE PAD SET', 'RADIATOR',
  'TURBOCHARGER', 'INJECTOR NOZZLE', 'IDLER ROLLER', 'DRIVE BELT',
  'AIR FILTER', 'CYLINDER HEAD GASKET', 'WATER PUMP ASSY', 'PIN',
]

// ── states & sites ───────────────────────────────────────────────────
export const states = STATE_DEFS.map((s, i) => ({
  id: uuid(100 + i), name: s.name, code: s.code, region: s.region,
}))

export const locations = SITE_DEFS.map(([name, stateIdx], i) => ({
  id: uuid(200 + i),
  location_name: name,
  state_id: states[stateIdx].id,
  project_id: null,
  state_name: states[stateIdx].name,
  state_code: states[stateIdx].code,
  region: states[stateIdx].region,
  created_at: iso(daysAgo(900)),
  is_bua: false,
  is_active: true,
  linked_project_name: null,
  linked_project_id: null,
  linked_project_client: null,
  linked_project_status: null,
  // filled in after plants are generated
  total_plants: 0, working_plants: 0, standby_plants: 0, breakdown_plants: 0,
  missing_plants: 0, scrap_plants: 0, off_hire_plants: 0,
  unknown_condition_plants: 0,
}))

export const fleetTypes = FLEET_TYPES.map(([name, prefix], i) => ({
  id: uuid(300 + i), name, prefix, created_at: iso(daysAgo(900)),
}))

// ── plants ───────────────────────────────────────────────────────────
export interface DemoPlant {
  id: string; fleet_number: string; description: string; fleet_type: string
  make: string; model: string; chassis_number: string | null
  year_of_manufacture: number; purchase_year: number | null
  purchase_month: number | null; purchase_cost: number | null
  serial_m: string; serial_e: string; condition: string
  physical_verification: boolean; current_location_id: string
  current_location: string; state_id: string; state: string; state_code: string
  last_verified_date: string; last_verified_year: number
  last_verified_week: number; remarks: string
  created_at: string; updated_at: string
  pending_transfer_to_id: null; pending_transfer_to_location: null
  total_maintenance_cost: number; parts_replaced_count: number
  last_maintenance_date: string | null; shared_po_count: number
  is_bua: boolean; pending_transfer_to_is_bua: boolean
  purchase_day: null; engine_number: string | null; purchase_site: null
  purchase_currency: string; components: unknown[]; capacity: string | null
  manufacture_month: null; manufacture_day: null; division: null
}

const PLANT_COUNT = 248
export const plants: DemoPlant[] = []

const counters: Record<string, number> = {}
for (let i = 0; i < PLANT_COUNT; i++) {
  const [type, prefix] = pick(FLEET_TYPES)
  counters[prefix] = (counters[prefix] || 0) + between(1, 4)
  const site = pick(locations)
  const state = states.find((s) => s.id === site.state_id)!
  const condition = pick(CONDITION_WEIGHTS)
  const verifiedDaysAgo = between(3, 60)
  const vDate = daysAgo(verifiedDaysAgo)
  const make = pick(MAKES[type] ?? ['Generic'])

  plants.push({
    id: uuid(1000 + i),
    fleet_number: `${prefix}${counters[prefix]}`,
    description: type,
    fleet_type: type,
    make,
    model: `${make.slice(0, 2).toUpperCase()}-${between(100, 900)}`,
    chassis_number: rand() > 0.5 ? `CH${between(100000, 999999)}` : null,
    year_of_manufacture: between(2009, 2023),
    purchase_year: rand() > 0.45 ? between(2015, 2025) : null,
    purchase_month: rand() > 0.45 ? between(1, 12) : null,
    purchase_cost: rand() > 0.6 ? money2(4_500_000, 210_000_000) : null,
    serial_m: `SM${between(10000, 99999)}`,
    serial_e: `SE${between(10000, 99999)}`,
    condition,
    physical_verification: rand() > 0.18,
    current_location_id: site.id,
    current_location: site.location_name,
    state_id: state.id,
    state: state.name,
    state_code: state.code,
    last_verified_date: day(vDate),
    last_verified_year: vDate.getUTCFullYear(),
    last_verified_week: isoWeekOf(vDate),
    remarks: condition === 'breakdown'
      ? pick(['Awaiting hydraulic pump', 'Engine overhaul in progress',
              'Gearbox fault reported', 'Awaiting spare from supplier'])
      : condition === 'missing'
      ? 'Not sighted during physical verification'
      : condition === 'off_hire'
      ? 'Off hire — returned to owner'
      : '',
    created_at: iso(daysAgo(between(200, 900))),
    updated_at: iso(vDate),
    pending_transfer_to_id: null,
    pending_transfer_to_location: null,
    total_maintenance_cost: 0,
    parts_replaced_count: 0,
    last_maintenance_date: null,
    shared_po_count: 0,
    is_bua: false,
    pending_transfer_to_is_bua: false,
    purchase_day: null,
    engine_number: rand() > 0.5 ? `EN${between(100000, 999999)}` : null,
    purchase_site: null,
    purchase_currency: 'NGN',
    components: [],
    capacity: rand() > 0.7 ? `${between(1, 40)} tonne` : null,
    manufacture_month: null,
    manufacture_day: null,
    division: null,
  })
}

function isoWeekOf(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

// ── purchase orders & line items ─────────────────────────────────────
export interface DemoPart {
  id: string; plant_id: string | null; replaced_date: string
  part_number: string; part_description: string; supplier: string
  supplier_name: string; supplier_id: string
  reason_for_change: string | null; unit_cost: number; quantity: number
  purchase_order_number: string; po_date: string
  remarks: null; created_by: string; created_at: string
  vat_percentage: number; discount_percentage: number; other_costs: number
  vat_amount: number | null; discount_amount: number | null
  total_cost: number; total_cost_ngn: number
  fleet_number: string | null; fleet_number_raw: string | null
  is_workshop: boolean; is_category: boolean; category_name: string | null
  cost_type: 'direct' | 'shared'
  shared_fleet_numbers: string[] | null
  location_id: string; requisition_number: string
  currency: string; fx_rate_to_ngn: number
  submission_number: number; is_po_overhead: boolean
  document_url: string | null; year: number; month: number
  week_number: number; quarter: number
}

export interface DemoPO {
  purchase_order_number: string
  po_date: string
  supplier_name: string
  location_name: string
  requisition_number: string
  cost_type: 'direct' | 'shared'
  currency: string
  goods: number
  vat: number
  total: number
  plants_count: number
  items_count: number
  parts: DemoPart[]
}

export const parts: DemoPart[] = []
export const purchaseOrders: DemoPO[] = []

const PO_COUNT = 46
let partSeq = 0

for (let i = 0; i < PO_COUNT; i++) {
  const date = daysAgo(between(5, 330))
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const yy = String(date.getUTCFullYear()).slice(2)
  const poNumber = `PW-PO${dd}${mm}${yy}-${String(between(1, 9)).padStart(3, '0')}`

  const supplier = pick(SUPPLIERS)
  const supplierId = uuid(400 + SUPPLIERS.indexOf(supplier))
  const site = pick(locations)

  // a quarter of POs cover several plants -> shared; the rest are direct
  const isShared = rand() < 0.26
  const covered = isShared
    ? Array.from({ length: between(2, 4) }, () => pick(plants))
    : [pick(plants)]
  const uniqueCovered = covered.filter(
    (p, idx) => covered.findIndex((q) => q.id === p.id) === idx,
  )

  // ~1 in 8 POs is in GBP, to exercise the multi-currency path
  const foreign = rand() < 0.12
  const currency = foreign ? 'GBP' : 'NGN'
  const fx = foreign ? 2100 : 1

  const lineCount = between(2, 5)
  const lines: DemoPart[] = []
  for (let j = 0; j < lineCount; j++) {
    const qty = pick([1, 1, 2, 4, 5, 10])
    const unit = foreign ? money2(35, 1800) : money2(4_500, 260_000)
    lines.push({
      id: uuid(5000 + partSeq++),
      plant_id: isShared ? null : uniqueCovered[0].id,
      replaced_date: day(date),
      part_number: String(between(1000000000, 1999999999)),
      part_description: pick(PART_NAMES),
      supplier,
      supplier_name: supplier,
      supplier_id: supplierId,
      reason_for_change: rand() > 0.6 ? pick(['Worn out', 'Failed in service', 'Routine service']) : null,
      unit_cost: unit,
      quantity: qty,
      purchase_order_number: poNumber,
      po_date: day(date),
      remarks: null,
      created_by: uuid(9001),
      created_at: iso(date),
      vat_percentage: 7.5,
      discount_percentage: 0,
      other_costs: 0,
      vat_amount: null,   // set below, once the goods value is known
      discount_amount: null,
      total_cost: 0,
      total_cost_ngn: 0,
      fleet_number: isShared ? null : uniqueCovered[0].fleet_number,
      fleet_number_raw: isShared ? null : uniqueCovered[0].fleet_number,
      is_workshop: false,
      is_category: false,
      category_name: null,
      cost_type: isShared ? 'shared' : 'direct',
      shared_fleet_numbers: isShared ? uniqueCovered.map((p) => p.fleet_number) : null,
      location_id: site.id,
      requisition_number: `${site.location_name.slice(0, 4).toUpperCase()} ${between(10000, 99999)}`,
      currency,
      fx_rate_to_ngn: fx,
      submission_number: 1,
      is_po_overhead: false,
      document_url: null,
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      week_number: isoWeekOf(date),
      quarter: Math.floor(date.getUTCMonth() / 3) + 1,
    })
  }

  // VAT is charged ONCE on the purchase order, then apportioned to the
  // lines in proportion to value — mirroring how the real data is stored.
  const goods = lines.reduce((s, l) => s + l.unit_cost * l.quantity, 0)
  const hasVat = rand() > 0.25
  const vat = hasVat ? Math.round(goods * 0.075 * 100) / 100 : 0
  lines.forEach((l) => {
    const lineGoods = l.unit_cost * l.quantity
    l.vat_amount = hasVat ? Math.round((vat * (lineGoods / goods)) * 100) / 100 : null
    l.vat_percentage = hasVat ? 7.5 : 0
    l.total_cost = Math.round((lineGoods + (l.vat_amount ?? 0)) * 100) / 100
    l.total_cost_ngn = Math.round(l.total_cost * fx * 100) / 100
  })

  parts.push(...lines)
  purchaseOrders.push({
    purchase_order_number: poNumber,
    po_date: day(date),
    supplier_name: supplier,
    location_name: site.location_name,
    requisition_number: lines[0].requisition_number,
    cost_type: isShared ? 'shared' : 'direct',
    currency,
    goods: Math.round(goods * 100) / 100,
    vat,
    total: Math.round((goods + vat) * 100) / 100,
    plants_count: uniqueCovered.length,
    items_count: lines.length,
    parts: lines,
  })
}

// ── roll costs back onto plants and sites ────────────────────────────
for (const p of plants) {
  const direct = parts.filter((x) => x.plant_id === p.id)
  const shared = parts.filter((x) => x.shared_fleet_numbers?.includes(p.fleet_number))
  p.parts_replaced_count = direct.length
  p.total_maintenance_cost = Math.round(
    direct.reduce((s, x) => s + x.total_cost_ngn, 0) * 100,
  ) / 100
  p.shared_po_count = new Set(
    shared.map((x) => `${x.purchase_order_number}|${x.po_date}`),
  ).size
  const dates = direct.map((x) => x.replaced_date).sort()
  p.last_maintenance_date = dates.length ? dates[dates.length - 1] : null
}

for (const loc of locations) {
  const here = plants.filter((p) => p.current_location_id === loc.id)
  loc.total_plants = here.length
  loc.working_plants = here.filter((p) => p.condition === 'working').length
  loc.standby_plants = here.filter((p) => p.condition === 'standby').length
  loc.breakdown_plants = here.filter((p) => p.condition === 'breakdown').length
  loc.missing_plants = here.filter((p) => p.condition === 'missing').length
  loc.scrap_plants = here.filter((p) => p.condition === 'scrap').length
  loc.off_hire_plants = here.filter((p) => p.condition === 'off_hire').length
  loc.unknown_condition_plants = 0
}

// ── projects, for the executive summary ──────────────────────────────
const PROJECT_DEFS = [
  { short: 'Northgate Bypass', name: 'Northgate Bypass Dualisation (Phase 2)',
    client: 'Federal Roads Agency', type: 'ROAD', state: 0, pct: 0.62 },
  { short: 'Riverside Jetty', name: 'Riverside Jetty Reconstruction',
    client: 'Riverside Port Authority', type: 'MARINE', state: 1, pct: 0.41 },
  { short: 'Highvale Quarry', name: 'Highvale Quarry Access Works',
    client: 'Highvale Minerals Plc', type: 'EARTHWORKS', state: 2, pct: 0.88 },
  { short: 'Eastmoor Apron', name: 'Eastmoor Airport Apron Extension',
    client: 'Eastmoor Airports Ltd', type: 'AIRFIELD', state: 3, pct: 0.27 },
]

export const executiveProjects = PROJECT_DEFS.map((d, i) => {
  const contract = money2(1_800_000_000, 9_400_000_000)
  const scope = Math.round(contract * 0.93 * 100) / 100
  const scopeVat = Math.round(scope * 1.075 * 100) / 100
  const works = Math.round(scope * d.pct * 100) / 100
  const worksVat = Math.round(works * 1.075 * 100) / 100
  const cost = Math.round(works * (0.68 + rand() * 0.2) * 100) / 100
  const net = Math.round((works - cost) * 100) / 100
  const certified = Math.round(works * (0.72 + rand() * 0.2) * 100) / 100
  const paid = Math.round(certified * (0.55 + rand() * 0.35) * 100) / 100
  const retention = Math.round(certified * 0.05 * 100) / 100
  const lastPay = between(20, 240)
  const wkEnd = daysAgo(between(4, 32))

  return {
    id: uuid(700 + i),
    short_name: d.short,
    project_name: d.name,
    client: d.client,
    // lowercase — the executive page filters on `status === 'active'`
    status: 'active',
    project_type: d.type,
    location_name: null,
    state_name: states[d.state].name,
    contract_sum: contract,
    scope,
    scope_incl_vat: scopeVat,
    works,
    works_incl_vat: worksVat,
    cost,
    net,
    margin: Math.round((net / works) * 10000) / 10000,
    pct_complete: d.pct,
    certified,
    paid_gross: paid,
    certified_not_paid: Math.round((certified - paid) * 100) / 100,
    retention_held: retention,
    retention_released: 0,
    payments_count: between(3, 14),
    last_payment_date: day(daysAgo(lastPay)),
    days_since_payment: lastPay,
    weeks_received: between(18, 64),
    latest_year: wkEnd.getUTCFullYear(),
    latest_week: isoWeekOf(wkEnd),
    latest_week_ending: day(wkEnd),
    days_since_report: Math.round((DEMO_TODAY.getTime() - wkEnd.getTime()) / 86400000),
    latest_net: Math.round(net * 0.03 * 100) / 100,
    latest_margin: Math.round((net / works) * 10000) / 10000,
    prev_margin: null,
    schedule: {
      status: d.pct > 0.8 ? 'ON_TRACK' : rand() > 0.5 ? 'BEHIND' : 'ON_TRACK',
      months_overdue: d.pct > 0.8 ? 0 : Math.round(rand() * 40) / 10,
      revised_completion_date: day(new Date(DEMO_TODAY.getTime() + between(60, 400) * 86400000)),
      original_completion_date: day(new Date(DEMO_TODAY.getTime() + between(10, 200) * 86400000)),
    },
  }
})

export const DEMO_NOW = DEMO_TODAY
export { isoWeekOf, uuid }
