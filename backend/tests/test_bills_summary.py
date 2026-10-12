"""Bill summary — bills → works total → adders → contract figure (pure)."""

import pytest

from app.services.bills_summary import compute_summary, validate_adders


BILLS = [{"bill_code": "1", "name": "PRELIMS", "amount": 1000.00},
         {"bill_code": "2", "name": "EARTHWORKS", "amount": 250.50}]


def test_works_total_is_the_sum_of_bills_exactly():
    s = compute_summary(BILLS, [])
    assert s["works_total"] == 1250.50 and s["contract_total"] == 1250.50 and s["lines"] == []


def test_adders_apply_in_order_on_a_running_subtotal():
    adders = [
        {"name": "Contingency", "kind": "percent_of_works", "value": 10},   # 125.05 of works
        {"name": "Provisional sum", "kind": "amount", "value": 100},         # fixed
        {"name": "VAT", "kind": "percent_of_running", "value": 7.5},         # on 1475.55
    ]
    s = compute_summary(BILLS, adders)
    assert [l["amount"] for l in s["lines"]] == [125.05, 100.00, 110.67]
    assert [l["running"] for l in s["lines"]] == [1375.55, 1475.55, 1586.22]
    assert s["contract_total"] == 1586.22


def test_percent_of_works_ignores_earlier_adders():
    adders = [{"name": "A", "kind": "amount", "value": 1000},
              {"name": "B", "kind": "percent_of_works", "value": 10}]
    s = compute_summary(BILLS, adders)
    assert s["lines"][1]["amount"] == 125.05            # 10% of 1250.50, not of 2250.50


def test_binary_float_noise_never_reaches_the_summary():
    s = compute_summary([{"bill_code": "1", "name": "a", "amount": 0.1}, {"bill_code": "2", "name": "b", "amount": 0.2}], [])
    assert s["works_total"] == 0.30


def test_validate_adders_cleans_and_refuses_bad_input():
    ok = validate_adders([{"name": " VAT ", "kind": "percent_of_running", "value": "7.5"}])
    assert ok == [{"name": "VAT", "kind": "percent_of_running", "value": 7.5}]
    assert validate_adders(None) == []
    for bad in ([{"name": "", "kind": "amount", "value": 1}],
                [{"name": "x", "kind": "percent", "value": 1}],
                [{"name": "x", "kind": "amount", "value": -1}],
                [{"name": "x", "kind": "percent_of_works", "value": "abc"}],
                [{"name": "x", "kind": "percent_of_works", "value": 5000}],
                "not a list"):
        with pytest.raises(ValueError):
            validate_adders(bad)
