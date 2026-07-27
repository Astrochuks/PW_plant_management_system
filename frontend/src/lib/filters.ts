/**
 * The "everything" option in a filter dropdown.
 *
 * Radix `<SelectItem>` cannot take an empty string value, so an
 * "All locations" option needs a placeholder token. That token is a UI
 * concern and must never reach the API: the backend types these as
 * `UUID | None`, so a literal "all" is a 422 — or worse, on a text
 * filter like fleet_type, a silent match against nothing and an empty
 * chart the reader takes for "no cost this year".
 *
 * Bind a select with `value={x || ALL}` and
 * `onValueChange={v => setX(v === ALL ? '' : v)}` so component state
 * holds '' for "everything", then build request params with `only()`.
 */
export const ALL = '_all'

/**
 * A filter value as the API should receive it: `undefined` when the user
 * means "everything". Also strips the older literal 'all', so a page that
 * has not been converted yet still cannot send a bad request.
 */
export const only = (v: string | null | undefined): string | undefined =>
  !v || v === ALL || v === 'all' ? undefined : v
