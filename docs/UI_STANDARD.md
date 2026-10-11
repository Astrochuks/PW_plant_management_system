# UI standard — how every page, card and table is built

Written 2026-10-11 after the user approved the Ongoing Projects page and
asked for the way of building it to be saved. This is the recipe. A new
page that does not follow it is wrong before it is reviewed.

The reference implementations are the **Plant Register**
(`frontend/src/app/(dashboard)/plants/page.tsx`) and **Ongoing Projects**
(`frontend/src/app/(dashboard)/projects/ongoing/page.tsx`). When in doubt,
open one of those and copy its shape.

---

## 1. The page shell (register-style pages)

Top to bottom, always in this order:

1. **Header row** — left: `p-2.5 rounded-xl bg-primary/10` icon box + `h1`
   (`text-2xl font-bold tracking-tight`) + one muted subtitle line with the
   live count ("12 sites in 4 states · contract ₦…"). Right: the admin
   action group — a single `rounded-lg border bg-card p-0.5` strip of ghost
   buttons separated by `h-4 w-px bg-border`. Non-admins see nothing on the
   right. No banners, no hero.
2. **Summary cards** — **exactly three** `MiniKpi` cards in a `MiniKpiGrid`
   (`components/shared/mini-kpi.tsx`): icon · bold value · label. **No
   words underneath beyond the label** unless the user asks for a specific
   sub line (decision 2026-10-11: "don't write any word underneath except
   what I tell you to"). **Every card follows the page's filters, lens and
   as-at date.** A card that shows a global figure while the table is
   filtered is a bug (the user has caught this twice).
3. **Filters row** — the period lens as a `bg-muted p-1` pill group, the
   as-at date input, then Selects. All state lives in the URL via
   `useUrlFilters` so a page can be shared and refreshed; search inputs are
   debounced 300 ms (`useDebounce`).
4. **Optional context strip** — e.g. the state chips on Ongoing Projects.
   Clickable, scrolls to the section; carries the same figures as the
   section header.
5. **Toolbar** — left: the result text ("Showing 12 ongoing projects as at
   11 Oct 2026", plus "· refreshing…" while `isFetching`); right: Export,
   the primary action for admins (`Add Project`, `Create …` with a `Plus`
   icon), then the table/cards toggle (`Table2` / `LayoutGrid`, `h-7 px-2`).
6. **The body** — a table (`rounded-lg border` + shadcn `Table`) or cards
   (`grid gap-4 sm:grid-cols-2 xl:grid-cols-3`). Rows and cards are
   clickable (`cursor-pointer`, `role="link"`, Enter key) and go to the
   entity's page. Grouped views (by state) use a `border-b-2
   border-foreground` section header carrying that group's totals.
7. **Pagination** — "Page x of y" left, Previous/Next right.

Loading = skeletons of the same shape; empty = a bordered, centred message
that says what is empty and, if a filter caused it, which one.

## 1b. Responsive — every page, every width

The app is used on laptops, tablets and phones. Non-negotiable:

- Nothing is hidden by breakpoint if it is a control the user needs (the
  header's project picker shrinks, it does not disappear).
- Pill groups and tab bars scroll horizontally on narrow screens
  (`overflow-x-auto`, hidden scrollbar, `shrink-0 whitespace-nowrap` items);
  they never wrap into two rows or overflow the page.
- Tables live in an `overflow-x-auto rounded-lg border` container; the page
  body never scrolls sideways.
- Card grids: `grid-cols-1 sm:grid-cols-2 xl:grid-cols-3` (entity cards),
  `grid-cols-1 sm:grid-cols-3` (the three summary cards).
- Header rows and toolbars are `flex-wrap` with `gap`; actions move under
  the title on narrow screens.
- Check at ~400 px, ~800 px and full width before calling a page done.

## 2. Cards

- Register pages: `MiniKpi` only (see above).
- Hub / analysis pages: the July system in
  `components/projects/hub-ui.tsx` — `Legend` embedded in the card border
  on **every** card, `Kpi`, `Delta`, `InfoChip`. Never hand-roll a card
  title.
- Entity cards (a site, a project): title + one muted identity figure;
  the headline number big (`text-2xl font-bold tabular-nums`); a small
  `dl` grid for supporting figures; a footer line separated by `border-t`.
  Status is a `Badge` from `STATUS_STYLES`, never free text. **Figures,
  not sentences**: a missing figure is `—`, not an explanation.
- A card for a thing with no data stays on the page, dashed and muted,
  with its status badge saying why ("Awaiting first report"), rather than
  disappearing.

## 3. Tables

- Shadcn `Table`; headers `text-[11px] uppercase tracking-wide`; money and
  counts right-aligned with `tabular-nums`; a muted second line under a
  name for the long form.
- Column visibility via the shared Columns popover where the table is
  wide (Plant Register pattern); sort via URL params.
- Group totals go in the section header, not as a fake row.

## 4. Numbers (CLAUDE.md rule 1, restated)

- `money()` = exactly two decimals, every time, no compact form unless an
  exact figure sits beside it. `num()` up to six decimals. Never round a
  figure the reader is meant to read.
- Percentages one decimal. Dates `fmtDate()` ("11 Oct 2026").
- A figure that does not exist is `—`, with a reason in the sub line or
  footer ("no report yet", "bills not loaded"). Never zero-fill.

## 5. Filters, lenses, honesty

- **One period lens drives everything on the page.** Checklist item on
  every review: "does this card/table follow the picker?"
- Figures are sums of the weeks on file for the period — never a workbook's
  own "to date" column (decision 2026-10-11).
- When rows are excluded, say how many and why. When a filter empties the
  page, say which filter.

## 6. Roles on the page

- `ProtectedRoute requiredRole` tiers: `admin`, `management` (plant),
  `projects` (admin + PM), `site`. The API scopes data; the page only
  hides controls (`isAdmin && …`) — never trusts itself for access.
- Admin-only controls: the header action strip and the primary action in
  the toolbar. Everything else is identical for the PM.

## 7. Verification before "done"

`npx tsc --noEmit` from `frontend/`, ESLint on touched files, then look at
the page in the running app on real data (screenshot or DOM text), then
commit with a manifest of files and what to click. If the page could not
be viewed, say so.
