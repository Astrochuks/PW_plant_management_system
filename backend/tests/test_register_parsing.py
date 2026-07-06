"""T1.4 + T1.5 — unit tests for the register pure parsing functions.

Every non-trivial input below is a REAL cell value from the 2017 Award
Letters workbook. Expected values are hand-derived.
"""

from datetime import date, datetime

import pytest

from app.services.register_parsing import (
    ContractSum,
    ParsedDate,
    parse_register_contract_sum,
    parse_register_date,
)

# ---------------------------------------------------------------------------
# T1.5 — dates
# ---------------------------------------------------------------------------

CLEAN_DATES = [
    ("10th August, 2006", date(2006, 8, 10)),
    ("10th March, 2014.", date(2014, 3, 10)),          # trailing period
    ("12 August, 2010", date(2010, 8, 12)),            # no ordinal
    ("12 January, 2009", date(2009, 1, 12)),
    ("13th December. 2012", date(2012, 12, 13)),       # period instead of comma
    ("11th October, 1999", date(1999, 10, 11)),
    ("JAN,8TH, 2018", date(2018, 1, 8)),               # month-first + ordinal
    ("Feburary, 2010", date(2010, 2, 1)),              # month typo, month-year
    ("March, 2009", date(2009, 3, 1)),                 # month-year only
    ("2018", date(2018, 1, 1)),                        # year only
]

MULTI_DATES = [
    # STRICT: several dates → NOTHING written; first offered as suggestion
    ("11th November, 2008 & 3rd April, 2012 & 4ht April, 2014", date(2008, 11, 11)),
    ("13th December, 2005 & 23rd December, 1999", date(2005, 12, 13)),
    ("14th October, 2011 & 4th April, 2014", date(2011, 10, 14)),
    ("15th December, 2010 & 23rd March, 2012", date(2010, 12, 15)),
    ("15th February, 2001, 16th November, 2006", date(2001, 2, 15)),  # comma chain
]

NARRATIVE_WITH_DATE = [
    ("Applied for 28th August, 2011", date(2011, 8, 28)),
    ("Application submitted: 15th November, 2014", date(2014, 11, 15)),
    ("Applied 13th November, 2014 (14,761,734.91)", date(2014, 11, 13)),
]

NARRATIVE_STATUS = ["Ongoing", "Not yet Due", "Abuja to Advice", "100% Claimed"]

NOISE = ["Nil", "N/A", "-", "None", "no", "yes", "TBC"]


class TestParseRegisterDate:
    @pytest.mark.parametrize("raw,expected", CLEAN_DATES)
    def test_clean_dates(self, raw, expected):
        r = parse_register_date(raw)
        assert r.value == expected, f"{raw!r} → {r.value}"
        assert r.reason is None
        assert not r.needs_review

    @pytest.mark.parametrize("raw,expected_suggestion", MULTI_DATES)
    def test_multi_dates_write_nothing_and_suggest_first(self, raw, expected_suggestion):
        r = parse_register_date(raw)
        assert r.value is None, f"{raw!r} wrote {r.value} — strict rule violated"
        assert r.reason == "multi_date"
        assert r.suggestion == expected_suggestion
        assert r.needs_review
        assert r.raw == raw  # raw always preserved

    @pytest.mark.parametrize("raw,expected", NARRATIVE_WITH_DATE)
    def test_narrative_extraction_only_when_allowed(self, raw, expected):
        # Retention-application mode: extract AND write
        allowed = parse_register_date(raw, allow_narrative=True)
        assert allowed.value == expected, f"{raw!r} → {allowed.value}"
        assert not allowed.needs_review

        # Everywhere else: write nothing, suggest, queue
        strict = parse_register_date(raw)
        assert strict.value is None
        assert strict.suggestion == expected
        assert strict.needs_review

    @pytest.mark.parametrize("raw", NARRATIVE_STATUS)
    def test_narrative_status_words(self, raw):
        r = parse_register_date(raw)
        assert r.value is None
        assert r.reason == "narrative_status"
        assert r.needs_review  # strict rules: anything non-standard queues

    def test_slash_dates_are_ambiguous_and_queue(self):
        r = parse_register_date("10/05/2001")
        assert r.value is None
        assert r.needs_review

    def test_narrative_without_date_needs_review(self):
        r = parse_register_date("File not in Ikeja")
        assert r.value is None
        assert r.reason == "narrative_no_date"
        assert r.needs_review

    @pytest.mark.parametrize("raw", NOISE)
    def test_noise_values(self, raw):
        r = parse_register_date(raw)
        assert r.value is None
        assert r.reason == "noise"
        assert not r.needs_review

    @pytest.mark.parametrize("raw", [None, "", "   "])
    def test_empty(self, raw):
        r = parse_register_date(raw)
        assert r.value is None
        assert r.reason == "empty"

    def test_real_datetime_objects_pass_through(self):
        assert parse_register_date(datetime(2011, 11, 29)) == ParsedDate(
            date(2011, 11, 29), "2011-11-29 00:00:00", None
        )
        assert parse_register_date(date(2020, 1, 5)).value == date(2020, 1, 5)

    def test_never_raises_on_hostile_input(self):
        for hostile in (object(), 3.14159, ["a", "list"], {"a": "dict"}, b"bytes"):
            r = parse_register_date(hostile)
            assert isinstance(r, ParsedDate)  # no exception = contract held


# ---------------------------------------------------------------------------
# T1.4 — contract sums
# ---------------------------------------------------------------------------

class TestParseRegisterContractSum:
    """STRICT rules (2026-07-06): plain numbers only; everything else
    queues with the legacy decomposition demoted to suggestions."""

    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("2,000,982.7", 2000982.7),
            ("23564246860.8", 23564246860.8),
            ("125,699,732.43", 125699732.43),
            ("18461415", 18461415.0),
        ],
    )
    def test_plain_numbers_parse(self, raw, expected):
        r = parse_register_contract_sum(raw)
        assert r.original == expected
        assert r.currency == "NGN"
        assert not r.needs_review

    def test_numeric_cell_parses(self):
        r = parse_register_contract_sum(18461415)
        assert r.original == 18461415.0
        assert not r.needs_review

    @pytest.mark.parametrize(
        "raw",
        [
            "Original: 589,525,642.16 Variation: 491,806,705.95. TOTAL: 1,081,332,348.11",
            "Revised from 8,803,267,991.27 to 6,365,729,373.11",
            "100,042,061.74 NGN & 126,098.12 USD",
            "Euro 108,313.00",
            "9,966,388,466.17 & 1,948,975,519.08 TOTAL: 15,959,296,782.5",
            "File not in Ikeja",
        ],
    )
    def test_anything_non_plain_queues_and_writes_nothing(self, raw):
        r = parse_register_contract_sum(raw)
        assert r.original is None and r.variation is None and r.total is None
        assert r.needs_review
        assert r.raw == raw

    def test_decomposition_survives_as_suggestion(self):
        r = parse_register_contract_sum(
            "Original: 589,525,642.16 Variation: 491,806,705.95. TOTAL: 1,081,332,348.11"
        )
        assert r.suggested_original == 589525642.16
        assert r.suggested_variation == 491806705.95

    def test_revised_suggestion_uses_final_value(self):
        r = parse_register_contract_sum("Revised from 8,803,267,991.27 to 6,365,729,373.11")
        assert r.suggested_original == 6365729373.11

    @pytest.mark.parametrize("raw", [None, float("nan"), "", "Nil"])
    def test_empty_and_noise(self, raw):
        r = parse_register_contract_sum(raw)
        assert r.original is None
        assert not r.needs_review

    def test_never_raises_on_hostile_input(self):
        for hostile in (object(), ["list"], {"d": 1}, b"bytes", -5, 0):
            r = parse_register_contract_sum(hostile)
            assert isinstance(r, ContractSum)
