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
    # several dates; FIRST is taken, flagged for review
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

    @pytest.mark.parametrize("raw,expected_first", MULTI_DATES)
    def test_multi_dates_take_first_and_flag(self, raw, expected_first):
        r = parse_register_date(raw)
        assert r.value == expected_first, f"{raw!r} → {r.value}"
        assert r.reason == "multi_date"
        assert r.needs_review
        assert r.raw == raw  # raw always preserved

    @pytest.mark.parametrize("raw,expected", NARRATIVE_WITH_DATE)
    def test_narrative_with_extractable_date(self, raw, expected):
        r = parse_register_date(raw)
        assert r.value == expected, f"{raw!r} → {r.value}"
        assert r.reason == "narrative_with_date"
        assert r.needs_review

    @pytest.mark.parametrize("raw", NARRATIVE_STATUS)
    def test_narrative_status_words(self, raw):
        r = parse_register_date(raw)
        assert r.value is None
        assert r.reason == "narrative_status"
        assert not r.needs_review  # meaningful no-data, not a failure

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
    def test_plain_number(self):
        r = parse_register_contract_sum(18461415)
        assert r.original == 18461415.0
        assert r.currency == "NGN"
        assert r.warnings == ()

    def test_original_variation_total_clean(self):
        r = parse_register_contract_sum(
            "Original: 589,525,642.16 Variation: 491,806,705.95. TOTAL: 1,081,332,348.11"
        )
        assert r.original == 589525642.16
        assert r.variation == 491806705.95
        assert r.total == 1081332348.11
        assert "total_mismatch" not in r.warnings

    def test_original_variation_total_with_spaces_in_label(self):
        r = parse_register_contract_sum(
            "Original : 1,358,671,387.5, Variation: 686,525,795.25, TOTAL: 2,045,197,182.75"
        )
        assert r.original == 1358671387.5
        assert r.variation == 686525795.25
        assert r.total == 2045197182.75

    def test_original_sum_prose_variant(self):
        r = parse_register_contract_sum(
            "Original Sum: 1,426,352,594.63. Variation for flyover bridge: "
            "1,350,768,527.85. TOTAL: 2,777,121,122.48"
        )
        assert r.original == 1426352594.63
        assert r.variation == 1350768527.85
        assert r.total == 2777121122.48

    def test_corrupted_decimal_flags_ambiguous(self):
        # ". 24." typo splits into a stray number — must flag, not guess silently
        r = parse_register_contract_sum(
            "Original: 1,710,710,549.08, Variation: 1,525,615,382. 24. "
            "Total : 3,236,325,931.32"
        )
        assert r.original == 1710710549.08
        assert r.variation == 1525615382.0
        assert r.total == 3236325931.32
        assert "ambiguous_numbers" in r.warnings
        assert r.needs_review

    def test_two_sums_with_inconsistent_total_flags_mismatch(self):
        r = parse_register_contract_sum(
            "9,966,388,466.17 & 1,948,975,519.08 TOTAL: 15,959,296,782.5"
        )
        assert r.total == 15959296782.5
        assert "total_mismatch" in r.warnings
        assert r.needs_review

    @pytest.mark.parametrize(
        "raw,expected_final",
        [
            ("Revised from 8,803,267,991.27 to 6,365,729,373.11", 6365729373.11),
            ("Revised from: 3,628,928,300.64 to 4,191,934,298.43", 4191934298.43),
            ("Revised to 1,318,756,677.22 from 980,701,312.5", 1318756677.22),
            ("2,447,757,947.64 then to 2,758,522,912.88", 2758522912.88),
            ("2,915,467,529.76 then to 3,371,854,538.35", 3371854538.35),
        ],
    )
    def test_revised_uses_final_value(self, raw, expected_final):
        r = parse_register_contract_sum(raw)
        assert r.original == expected_final, f"{raw!r} → {r.original}"
        assert "revised_used_final" in r.warnings

    def test_mixed_currency_uses_ngn(self):
        r = parse_register_contract_sum("100,042,061.74 NGN & 126,098.12 USD")
        assert r.original == 100042061.74
        assert r.currency == "NGN"
        assert "multi_currency" in r.warnings

    def test_euro_flagged_foreign(self):
        r = parse_register_contract_sum("Euro 108,313.00")
        assert r.original == 108313.0
        assert r.currency == "EUR"
        assert "foreign_currency" in r.warnings

    def test_text_with_no_numbers_needs_review(self):
        r = parse_register_contract_sum("File not in Ikeja")
        assert r.original is None
        assert "no_numbers_found" in r.warnings
        assert r.needs_review
        assert r.raw == "File not in Ikeja"  # raw preserved for the queue

    @pytest.mark.parametrize("raw", [None, float("nan"), "", "Nil"])
    def test_empty_and_noise(self, raw):
        r = parse_register_contract_sum(raw)
        assert r.original is None
        assert r.total is None
        assert not r.needs_review

    def test_never_raises_on_hostile_input(self):
        for hostile in (object(), ["list"], {"d": 1}, b"bytes", -5, 0):
            r = parse_register_contract_sum(hostile)
            assert isinstance(r, ContractSum)
