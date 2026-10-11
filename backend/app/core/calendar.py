"""The reporting calendar — one rule for every week-based figure.

Decided 2026-10-11 (docs/CALENDAR.md):

* A reporting week is identified by its ISO week number and ISO week-year.
* Projects' weeks run Saturday→Friday (the company calendar; sites' Lists
  sheet); plants' weeks run Monday→Sunday. Both carry the same ISO number
  for the Monday–Friday they share.
* **A week belongs to the month, quarter and year that contain its
  THURSDAY** — ISO's own anchor. For a Mon–Sun week that is also the
  majority day; for the Sat→Fri company week it is not (Tuesday would be),
  and we still use the Thursday so a week stays in the month and year its
  own week number says. This reproduces the head-office month table
  (Jan 2026 = weeks 1–5, Feb = 6–9, …, Dec = 49–53) exactly, for both
  modules, in any year — computed, never tabulated.
* The "Date" cell a site types on its Contract Summary is the day the
  report was prepared, never the week-ending date.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

FRIDAY = 4      # date.weekday(): Monday=0 … Sunday=6
THURSDAY = 3
SUNDAY = 6

PREPARED_LATE_AFTER_DAYS = 14


def friday_on_or_before(d: date) -> date:
    """Projects: the week-ending Friday for any day of a Sat→Fri week."""
    return d - timedelta(days=(d.weekday() - FRIDAY) % 7)


def anchor_thursday(week_ending: date) -> date:
    """The Thursday of the week that ends on `week_ending` (Friday for
    projects, Sunday for plants — both work)."""
    return week_ending - timedelta(days=(week_ending.weekday() - THURSDAY) % 7)


@dataclass(frozen=True)
class ReportPeriod:
    year: int        # calendar year of the anchor (== ISO week-year)
    quarter: int     # 1–4
    month: int       # 1–12
    iso_week: int    # 1–53

    @property
    def quarter_label(self) -> str:
        return f"Q{self.quarter} {self.year}"


def period_of(week_ending: date) -> ReportPeriod:
    """Which month / quarter / year a reporting week counts in."""
    t = anchor_thursday(week_ending)
    iso_year, iso_week, _ = t.isocalendar()
    assert iso_year == t.year  # the Thursday rule and ISO agree by construction
    return ReportPeriod(year=t.year, quarter=(t.month - 1) // 3 + 1, month=t.month, iso_week=iso_week)


def week_key(week_ending: date) -> tuple[int, int]:
    """(year, week_number) exactly as stored on the weekly tables."""
    p = period_of(week_ending)
    return p.year, p.iso_week


def check_prepared_on(prepared_on: date | None, week_ending: date) -> str | None:
    """Sanity check on the site's 'Date' cell against the declared week.
    Returns a warning sentence, or None when it looks right."""
    if prepared_on is None:
        return None
    if prepared_on < week_ending:
        return (f"report dated {prepared_on.isoformat()} is BEFORE the end of the declared week "
                f"({week_ending.isoformat()}) — confirm the week number")
    late = (prepared_on - week_ending).days
    if late > PREPARED_LATE_AFTER_DAYS:
        return (f"report dated {prepared_on.isoformat()} is {late} days after the declared week ended "
                f"({week_ending.isoformat()}) — confirm the week number")
    return None
