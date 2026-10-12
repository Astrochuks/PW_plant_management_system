"""Bill revision diff — what the approver reads (pure)."""

from app.services.bills_diff import diff_bills


def _bill(code, items):
    return {"bill_code": code, "items": [
        {"item_code": c, "description": d, "unit": u, "contract_qty": q, "rate": r, "contract_amount": a}
        for (c, d, u, q, r, a) in items]}


CURRENT = [
    _bill("5", [("5.01", "Office", "P.S", 1, 2500000, 2500000), ("5.02", "Labour", "P.S", 1, 2000000, 2000000)]),
    _bill("5.1", [("5.1.01", "Excavate", "m3", 10, 100, 1000), ("5.1.01", "Excavate", "m3", 5, 100, 500)]),
]


def test_rate_change_is_a_changed_item_with_old_new_and_delta():
    proposed = [
        _bill("5", [("5.01", "Office", "P.S", 1, 2600000, 2600000), ("5.02", "Labour", "P.S", 1, 2000000, 2000000)]),
        _bill("5.1", [("5.1.01", "Excavate", "m3", 10, 100, 1000), ("5.1.01", "Excavate", "m3", 5, 100, 500)]),
    ]
    d = diff_bills(CURRENT, proposed)
    assert len(d["items_changed"]) == 1
    c = d["items_changed"][0]
    assert c["item_code"] == "5.01" and c["old"]["rate"] == 2500000.0 and c["new"]["rate"] == 2600000.0
    assert c["delta"] == 100000.0 and d["works_delta"] == 100000.0
    assert d["items_added"] == [] and d["items_removed"] == [] and d["unchanged"] == 3


def test_repeated_lines_are_matched_by_occurrence_not_merged():
    proposed = [CURRENT[0], _bill("5.1", [("5.1.01", "Excavate", "m3", 10, 100, 1000), ("5.1.01", "Excavate", "m3", 7, 100, 700)])]
    d = diff_bills(CURRENT, proposed)
    assert len(d["items_changed"]) == 1 and d["items_changed"][0]["old"]["contract_qty"] == 5.0


def test_added_and_removed_items_and_bills():
    proposed = [
        _bill("5", [("5.01", "Office", "P.S", 1, 2500000, 2500000)]),           # 5.02 removed
        _bill("6", [("6.01", "New bill item", "no", 1, 1, 1)]),                 # bill 6 added, 5.1 removed
    ]
    d = diff_bills(CURRENT, proposed)
    assert d["bills_added"] == ["6"] and d["bills_removed"] == ["5.1"]
    assert {i["item_code"] for i in d["items_removed"]} == {"5.02", "5.1.01"}
    assert [i["item_code"] for i in d["items_added"]] == ["6.01"]
    assert d["works_current"] == 4501500.0 and d["works_proposed"] == 2500001.0


def test_a_kobo_is_not_a_change_but_a_unit_is():
    same = [_bill("5", [("5.01", "Office", "P.S", 1, 2500000, 2500000.004)])]
    base = [_bill("5", [("5.01", "Office", "P.S", 1, 2500000, 2500000)])]
    assert diff_bills(base, same)["items_changed"] == []
    unit = [_bill("5", [("5.01", "Office", "L.S", 1, 2500000, 2500000)])]
    assert len(diff_bills(base, unit)["items_changed"]) == 1


def test_adders_change_is_flagged():
    assert diff_bills(CURRENT, CURRENT, [], [{"name": "VAT", "kind": "percent_of_running", "value": 7.5}])["adders_changed"] is True
    assert diff_bills(CURRENT, CURRENT, [], [])["adders_changed"] is False
