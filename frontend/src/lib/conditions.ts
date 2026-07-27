/**
 * The plant condition taxonomy — exactly six values, no catch-all.
 *
 * Enforced in the database:
 *   plants_master_condition_check
 *     CHECK (condition IS NULL OR condition = ANY (ARRAY[
 *       'working','standby','breakdown','missing','scrap','off_hire']))
 *
 * Anywhere conditions are listed — a dashboard, a table, a chart, a
 * report — all six appear with their own value. Do not reintroduce an
 * "Other" bucket: lumping missing + scrap + off_hire together hides a
 * missing plant behind a plant that is merely off hire, and those are
 * very different problems.
 *
 * `condition` is the live column. `plants_master.status` is stale/legacy
 * and must never be counted or filtered on.
 */

export const CONDITIONS = [
  { value: 'working', label: 'Working', color: '#10b981' },
  { value: 'standby', label: 'Standby', color: '#fbbf24' },
  { value: 'breakdown', label: 'Breakdown', color: '#dc2626' },
  { value: 'missing', label: 'Missing', color: '#ef4444' },
  { value: 'scrap', label: 'Scrap', color: '#9ca3af' },
  { value: 'off_hire', label: 'Off Hire', color: '#64748b' },
] as const

export type Condition = (typeof CONDITIONS)[number]['value']

export const CONDITION_VALUES = CONDITIONS.map((c) => c.value) as readonly Condition[]

export const CONDITION_LABELS: Record<Condition, string> = Object.fromEntries(
  CONDITIONS.map((c) => [c.value, c.label]),
) as Record<Condition, string>

export const conditionLabel = (v: string | null | undefined): string =>
  (v && CONDITION_LABELS[v as Condition]) || 'Unknown'
