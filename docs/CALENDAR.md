# The reporting calendar

Decided 2026-10-11 with the user. Code: `backend/app/core/calendar.py`,
SQL `week_anchor(date)` (migration 041), `frontend/src/lib/calendar.ts`.
Golden tests: `backend/tests/test_calendar.py`.

## 1. What a week is

| | Projects | Plants |
|---|---|---|
| Week runs | **Saturday → Friday** (the company calendar in every workbook's Lists sheet) | **Monday → Sunday** (ISO) |
| `week_ending_date` | the **Friday** — enforced by a CHECK on `project_weekly_reports` | the Sunday |
| `week_number` | ISO week number of that Friday | ISO week number |
| `year` | ISO week-year | ISO week-year |

The two calendars share Monday–Friday, so **week N means the same working
week in both modules**; they differ only in which weekend days they
include. We do not unify them (plant history is 44,700 rows on Sunday
weeks and every plant report is built on it); we document the two-day
offset and key both by the same anchor (§2), so months and quarters agree.

## 2. Which month, quarter and year a week belongs to

**The period that contains the week's Thursday.** ISO uses the Thursday to
assign a week to a year; we use it for months and quarters too. For a
Monday–Sunday week the Thursday is also the majority day. For the company's
Saturday–Friday week it is not (that would be the Tuesday) — we still use
the Thursday, on purpose: it keeps every week in the month and year that
its own **week number** says, so "week 1 of 2026" is January 2026 even
though five of its seven days are in December. The two readings differ only
in weeks where the 1st of a month falls on a Wednesday or Thursday; the
Thursday reading is the one consistent with the sites' numbering and with
the head-office table.

It is computed, never tabulated: step back from the week-ending date to
the Thursday, read month / quarter / year off that date. The same three
lines of arithmetic in SQL, Python and TypeScript; no year-specific table
anywhere in the logic (the 2026 table lives only in the tests, as proof).

This reproduces the head-office month table exactly. For 2026:

| Month | ISO weeks | | Month | ISO weeks |
|---|---|---|---|---|
| January | 1–5 | | July | 27–31 |
| February | 6–9 | | August | 32–35 |
| March | 10–13 | | September | 36–39 |
| April | 14–18 | | October | 40–44 |
| May | 19–22 | | November | 45–48 |
| June | 23–26 | | December | 49–53 |

The 5-4-4 pattern is a property of 2026, not a rule: in 2027 January holds
weeks 1–4. Always compute, never hard-code a table.

Why not "the month the week ends in"? It disagrees with the table on six
2026 weeks (5, 9, 18, 31, 44, 53). Example: week 18/2026 ends Fri 1 May,
but its Thursday is 30 April — the table and the rule both say **April**.

### Year ends
- Company week Sat 27 Dec 2025 → Fri 2 Jan 2026: Thursday 1 Jan → **week 1
  of 2026, January 2026**.
- Company week Sat 26 Dec 2026 → Fri 1 Jan 2027: Thursday 31 Dec → **week
  53 of 2026, December 2026** (2026 is a 53-week ISO year). The Lists sheet
  labels this week both "53" and "1"; the Thursday rule is the tie-break.

## 3. The site's "Date" cell is NOT the week-ending date

It is the day the report was prepared. Measured on real workbooks: Akwa
writes the Friday itself; Kaduna the Saturday after; Maru-Lugga and Kuba
10 days later (a Monday — which would be a different ISO week). It is
stored as `project_weekly_reports.prepared_on` and used for two things
only: how late sites report, and a sanity flag on upload —
`week_number_check` fires when the date is before the declared week's
Friday or more than 14 days after it ("confirm the week number").

The week itself is identified by the **week number the site declares**;
its Friday comes from the calendar (`friday_on_or_before`).

## 4. Where the rule is applied

| Place | How |
|---|---|
| Import of a workbook | `week_ending` = Friday of the declared week; `prepared_on` from the Date cell; flag if inconsistent |
| Report pack windows (monthly/quarterly/yearly/to-date) | `week_anchor(week_ending_date) BETWEEN start AND end` |
| Hub series by month | `date_trunc('month', week_anchor(week_ending_date))` |
| Ongoing page lens | `anchorThursday()` in `lib/calendar.ts` |
| Hub chart buckets | `monthLabel / quarterLabel / yearLabel` in `lib/calendar.ts` |
| Spare parts (dated purchases, not weeks) | calendar month/quarter of `replaced_date` — unchanged, correct |
| Plant monthly/quarterly reports | fleet snapshot as at the period end — unchanged; any future week-sum for plants uses `week_anchor` |

## 5. Data corrections made under this rule

- 2026-10-11, migration 041: Kaduna W09/2025 1 Mar → **28 Feb 2025** and
  Akwa W43/2025 25 Oct → **24 Oct 2025** in all 13 per-week project
  tables. Week numbers and figures unchanged; Kaduna's week 9 now counts
  in February 2025 (its Thursday is 27 Feb), as the rule requires.
- Two `plant_weekly_records` rows (week 14/2026) carry a Monday date
  (typo); flagged, not yet corrected.
