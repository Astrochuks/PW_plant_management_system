/**
 * Site Engineer API functions
 */

import apiClient from './client'

// ============================================================================
// Types
// ============================================================================

export interface SiteStats {
  id: string
  location_name: string
  state_name: string | null
  total_plants: number
  working: number
  standby: number
  breakdown: number
  missing: number
  faulty: number
  scrap: number
  off_hire: number
  unverified: number
  last_submission: string | null
}

export type PlantCondition =
  | 'working' | 'standby' | 'breakdown' | 'missing'
  | 'faulty' | 'scrap' | 'off_hire' | 'unverified' | 'others'

export interface DraftRow {
  id: string
  draft_id: string
  fleet_number: string
  plant_id: string | null
  condition: PlantCondition | null
  physical_verification: boolean | null
  hours_worked: number | null
  standby_hours: number | null
  breakdown_hours: number | null
  off_hire: boolean
  transfer_to_location_id: string | null
  remarks: string | null
  is_new_plant: boolean
  updated_at: string
}

export interface Draft {
  id: string
  location_id: string
  week_ending_date: string
  status: 'draft' | 'submitted'
  rows: DraftRow[]
  updated_at: string
}

export interface DraftRowUpsert {
  fleet_number: string
  condition?: PlantCondition | null
  physical_verification?: boolean | null
  hours_worked?: number | null
  standby_hours?: number | null
  breakdown_hours?: number | null
  off_hire?: boolean
  transfer_to_location_id?: string | null
  remarks?: string | null
  is_new_plant?: boolean
  plant_description?: string
}

export interface SitePlant {
  id: string
  fleet_number: string
  description: string | null
  fleet_type: string | null
  make: string | null
  model: string | null
  condition: string | null
  physical_verification: boolean | null
  last_verified_date: string | null
}

export interface SiteSubmission {
  id: string
  year: number
  week_number: number
  week_ending_date: string
  status: string
  plants_processed: number | null
  plants_created: number | null
  plants_updated: number | null
  source_type: string | null
  created_at: string
}

export interface IncomingTransfer {
  id: string
  status: string
  transfer_date: string | null
  created_at: string
  notes: string | null
  fleet_number: string
  description: string | null
  fleet_type: string | null
  from_location_name: string
}

export interface PlantCheckResult {
  available: boolean
  current_location?: string
  message?: string
}

export interface PaginationMeta {
  page: number
  limit: number
  total: number
  total_pages: number
}

// ============================================================================
// API Functions
// ============================================================================

export async function getSiteStats(): Promise<SiteStats> {
  const res = await apiClient.get('/site/me')
  const d = res.data.data
  return {
    id: d.id,
    location_name: d.location_name,
    state_name: d.state_name ?? null,
    total_plants: Number(d.total_plants ?? 0),
    working: Number(d.working ?? 0),
    standby: Number(d.standby ?? 0),
    breakdown: Number(d.breakdown ?? 0),
    missing: Number(d.missing ?? 0),
    faulty: Number(d.faulty ?? 0),
    scrap: Number(d.scrap ?? 0),
    off_hire: Number(d.off_hire ?? 0),
    unverified: Number(d.unverified ?? 0),
    last_submission: d.last_submission ?? null,
  }
}

export async function getSitePlants(params: {
  page?: number
  limit?: number
  search?: string
  condition?: string
}): Promise<{ data: SitePlant[]; meta: PaginationMeta }> {
  const query: Record<string, string> = {}
  if (params.page) query.page = String(params.page)
  if (params.limit) query.limit = String(params.limit)
  if (params.search) query.search = params.search
  if (params.condition) query.condition = params.condition
  const res = await apiClient.get('/site/plants', { params: query })
  return { data: res.data.data, meta: res.data.meta }
}

export async function getDraft(weekEndingDate: string): Promise<Draft> {
  const res = await apiClient.get('/site/draft', {
    params: { week_ending_date: weekEndingDate },
  })
  const d = res.data.data
  return {
    ...d,
    rows: d.rows ?? [],
  }
}

export async function upsertDraftRow(
  weekEndingDate: string,
  row: DraftRowUpsert,
  draftId?: string,
): Promise<{ draft_id: string }> {
  const params: Record<string, string> = { week_ending_date: weekEndingDate }
  if (draftId) params.draft_id = draftId
  const res = await apiClient.put('/site/draft/rows', row, {
    params,
    timeout: 30000,
  })
  return res.data
}

export async function batchUpsertDraftRows(
  weekEndingDate: string,
  rows: DraftRowUpsert[],
  draftId?: string,
): Promise<{ draft_id: string; saved: number }> {
  const params: Record<string, string> = { week_ending_date: weekEndingDate }
  if (draftId) params.draft_id = draftId
  const res = await apiClient.put('/site/draft/rows/batch', { rows }, {
    params,
    timeout: 30000,
  })
  return res.data
}

export async function removeDraftRow(weekEndingDate: string, fleetNumber: string): Promise<void> {
  await apiClient.delete(`/site/draft/rows/${encodeURIComponent(fleetNumber)}`, {
    params: { week_ending_date: weekEndingDate },
    timeout: 60000,
  })
}

export async function submitDraft(weekEndingDate: string): Promise<{
  submission_id: string
  plants_processed: number
  plants_created: number
  transfers_pending: number
}> {
  const res = await apiClient.post('/site/draft/submit', null, {
    params: { week_ending_date: weekEndingDate },
    timeout: 120000,
  })
  return res.data.data
}

export async function getSiteSubmissions(params: {
  page?: number
  limit?: number
}): Promise<{ data: SiteSubmission[]; meta: PaginationMeta }> {
  const query: Record<string, string> = {}
  if (params.page) query.page = String(params.page)
  if (params.limit) query.limit = String(params.limit)
  const res = await apiClient.get('/site/submissions', { params: query })
  return { data: res.data.data, meta: res.data.meta }
}

export async function exportSubmission(submissionId: string): Promise<Blob> {
  const res = await apiClient.get(`/site/submissions/${submissionId}/export`, {
    responseType: 'blob',
  })
  return res.data
}

export async function getIncomingTransfers(): Promise<IncomingTransfer[]> {
  const res = await apiClient.get('/site/transfers/incoming')
  return res.data.data
}

export async function confirmTransfer(transferId: string): Promise<void> {
  await apiClient.post(`/site/transfers/${transferId}/confirm`)
}

export async function rejectTransfer(transferId: string): Promise<void> {
  await apiClient.post(`/site/transfers/${transferId}/reject`)
}

export async function checkNewPlant(fleetNumber: string): Promise<PlantCheckResult> {
  const res = await apiClient.get(`/site/new-plant-check/${encodeURIComponent(fleetNumber)}`)
  return res.data.data
}

export interface SubmissionRecord {
  fleet_number: string
  description: string | null
  fleet_type: string | null
  condition: string | null
  physical_verification: boolean | null
  hours_worked: number | null
  standby_hours: number | null
  breakdown_hours: number | null
  off_hire: boolean | null
  remarks: string | null
  transfer_to: string | null
}

export async function getSubmissionRecords(submissionId: string): Promise<SubmissionRecord[]> {
  const res = await apiClient.get(`/site/submissions/${submissionId}/records`)
  return res.data.data
}

export async function getSiteLocations(): Promise<Array<{ id: string; name: string }>> {
  const res = await apiClient.get('/site/locations')
  return res.data.data
}

export interface PullRequest {
  id: string
  status: string
  created_at: string
  fleet_number: string
  description: string | null
  fleet_type: string | null
  requesting_location_name: string
}

export async function requestPlantTransfer(fleetNumber: string): Promise<{ message: string }> {
  const res = await apiClient.post('/site/transfers/pull-request', { fleet_number: fleetNumber })
  return res.data
}

export async function getPullRequests(): Promise<PullRequest[]> {
  const res = await apiClient.get('/site/transfers/pull-requests')
  return res.data.data
}
