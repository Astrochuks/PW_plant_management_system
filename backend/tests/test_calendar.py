"""The reporting calendar (docs/CALENDAR.md, decision 2026-10-11).

The head-office table for 2026 is the golden fixture: Jan = weeks 1–5,
Feb = 6–9, Mar = 10–13, Apr = 14–18, May = 19–22, Jun = 23–26, Jul = 27–31,
Aug = 32–35, Sep = 36–39, Oct = 40–44, Nov = 45–48, Dec = 49–53.
"""

from datetime import date, timedelta

import pytest

from app.core.calendar import (
    anchor_thursday,
    check_prepared_on,
    friday_on_or_before,
    period_of,
    week_key,
)

TABLE_2026 = {1: range(1, 6), 2: range(6, 10), 3: range(10, 14), 4: range(14, 19), 5: range(19, 23),
              6: range(23, 27), 7: range(27, 32), 8: range(32, 36), 9: range(36, 40), 10: range(40, 45),
              11: range(45, 49), 12: range(49, 54)}


def _friday(year: int, week: int) -> date:
    return date.fromisocalendar(year, week, 5)


def _sunday(year: int, week: int) -> date:
    return date.fromisocalendar(year, week, 7)


@pytest.mark.parametrize("month,weeks", TABLE_2026.items())
def test_2026_table_holds_for_project_weeks_ending_friday(month, weeks):
    for w in weeks:
        p = period_of(_friday(2026, w))
        assert (p.year, p.month, p.iso_week) == (2026, month, w), f"W{w}"


@pytest.mark.parametrize("month,weeks", TABLE_2026.items())
def test_2026_table_holds_for_plant_weeks_ending_sunday(month, weeks):
    for w in weeks:
        p = period_of(_sunday(2026, w))
        assert (p.year, p.month, p.iso_week) == (2026, month, w), f"W{w}"


def test_quarters_follow_the_months():
    assert period_of(_friday(2026, 13)).quarter_label == "Q1 2026"
    assert period_of(_friday(2026, 14)).quarter_label == "Q2 2026"
    assert period_of(_friday(2026, 39)).quarter_label == "Q3 2026"
    assert period_of(_friday(2026, 40)).quarter_label == "Q4 2026"


def test_year_end_2026_has_53_weeks_and_the_last_is_december():
    """The company week Sat 26 Dec 2026 → Fri 1 Jan 2027 is week 53 of
    2026 and counts in December 2026 (its Thursday is 31 Dec)."""
    fri = date(2027, 1, 1)
    assert week_key(fri) == (2026, 53)
    assert period_of(fri).month == 12 and period_of(fri).year == 2026


def test_year_start_2026_week_one_is_january():
    """Sat 27 Dec 2025 → Fri 2 Jan 2026: Thursday 1 Jan → week 1 of 2026, January."""
    assert week_key(date(2026, 1, 2)) == (2026, 1)
    assert period_of(date(2026, 1, 2)).month == 1


def test_where_the_friday_rule_would_have_been_wrong():
    # W18/2026 ends Fri 1 May but its Thursday is 30 April: April, per the table
    assert period_of(_friday(2026, 18)).month == 4
    # W5/2026 ends Sun 1 Feb for plants: January, per the table
    assert period_of(_sunday(2026, 5)).month == 1


def test_friday_normalisation_of_the_2025_saturday_dates():
    assert friday_on_or_before(date(2025, 3, 1)) == date(2025, 2, 28)   # Kaduna W09/2025
    assert friday_on_or_before(date(2025, 10, 25)) == date(2025, 10, 24)  # Akwa W43/2025
    assert friday_on_or_before(date(2026, 9, 18)) == date(2026, 9, 18)   # already a Friday
    assert week_key(date(2025, 2, 28)) == (2025, 9)
    assert week_key(date(2025, 10, 24)) == (2025, 43)


def test_anchor_is_the_thursday_for_both_week_shapes():
    assert anchor_thursday(date(2026, 9, 18)) == date(2026, 9, 17)   # Fri → Thu
    assert anchor_thursday(date(2026, 9, 20)) == date(2026, 9, 17)   # Sun → Thu
    assert anchor_thursday(date(2026, 9, 17)) == date(2026, 9, 17)   # Thu itself


def test_prepared_on_check_matches_the_four_real_workbooks():
    assert check_prepared_on(date(2026, 3, 6), date(2026, 3, 6)) is None          # Akwa: same Friday
    assert check_prepared_on(date(2026, 9, 12), date(2026, 9, 11)) is None        # Kaduna: next morning
    assert check_prepared_on(date(2026, 9, 28), date(2026, 9, 18)) is None        # Maru: 10 days later
    late = check_prepared_on(date(2026, 10, 5), date(2026, 9, 18))                 # 17 days → flag
    assert late and "17 days after" in late
    early = check_prepared_on(date(2026, 9, 10), date(2026, 9, 11))                # dated before week end
    assert early and "BEFORE" in early
    assert check_prepared_on(None, date(2026, 9, 11)) is None
