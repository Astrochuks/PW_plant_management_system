"""Bill of quantities import — pure shaping rules (no database).

Pins: items keep sheet order and land in their bill; duplicates get a
dup_seq; our Σ per bill is compared to the sheet's own total at 1 kobo;
the sheet with the most priced rows is the bill; the request model needs
at least one bill.
"""

import pytest
from pydantic import ValidationError as PydanticValidationError

from app.services.bills_import import assign_dup_seq, pick_beme_sheet, shape_preview


def _parsed():
    return {
        "bills": [
            {"bill_code": "5", "bill_no": 5, "sort_order": 1, "name": "GENERAL", "sheet_total_contract": 4500000.00},
            {"bill_code": "5.1", "bill_no": None, "sort_order": 2, "name": "EXCAVATION", "sheet_total_contract": 999.99},
        ],
        "rows": [
            {"bill_code": "5", "bill_no": 5, "item_code": "5.01", "description": "Office accommodation", "unit": "P.S",
             "contract_qty": 1, "rate": 2500000.00, "contract_amount": 2500000.00},
            {"bill_code": "5", "bill_no": 5, "item_code": "5.02", "description": "Equipment and labour", "unit": "P.S",
             "contract_qty": 1, "rate": 2000000.00, "contract_amount": 2000000.00},
            {"bill_code": "5.1", "bill_no": None, "item_code": "5.1.01", "description": "Excavate", "unit": "m3",
             "contract_qty": 10.5, "rate": 100.00, "contract_amount": 1050.00},
            # a repeated line: same code + description inside the same bill
            {"bill_code": "5.1", "bill_no": None, "item_code": "5.1.01", "description": "Excavate", "unit": "m3",
             "contract_qty": 1, "rate": 100.00, "contract_amount": 100.00},
            # an item whose bill never printed a header row
            {"bill_code": "6", "bill_no": 6, "item_code": "6.01", "description": "Orphan", "unit": "no",
             "contract_qty": 1, "rate": 1.00, "contract_amount": 1.00},
        ],
        "warnings": ["BEME item 6.01 appears without a bill header"],
    }


def test_items_land_in_their_bill_in_sheet_order_with_dup_seq():
    p = shape_preview(_parsed())
    codes = [b["bill_code"] for b in p["bills"]]
    assert codes == ["5", "5.1", "6"]                       # headerless bill appended
    b5 = p["bills"][0]
    assert [i["item_code"] for i in b5["items"]] == ["5.01", "5.02"]
    assert [i["sort_order"] for i in b5["items"]] == [1, 2]
    b51 = p["bills"][1]
    assert [i["dup_seq"] for i in b51["items"]] == [0, 1]   # the repeat is numbered, not merged
    assert p["bills"][2]["name"] is None


def test_our_sum_against_the_sheet_total_at_one_kobo():
    p = shape_preview(_parsed())
    b5, b51, b6 = p["bills"]
    assert b5["items_total"] == 4500000.00 and b5["matches_sheet"] is True
    assert b51["items_total"] == 1150.00 and b51["matches_sheet"] is False
    assert b6["matches_sheet"] is None                      # the sheet gave no total
    assert p["mismatched_bills"] == ["5.1"]
    assert p["works_total"] == 4501151.00
    assert p["bill_count"] == 3 and p["item_count"] == 5
    assert p["warnings"] == ["BEME item 6.01 appears without a bill header"]


def test_money_is_summed_exactly_not_in_binary_floats():
    # 0.1 + 0.2 must be 0.30, never 0.30000000000000004
    parsed = {"bills": [{"bill_code": "1", "name": "A", "sort_order": 1, "sheet_total_contract": 0.3}],
              "rows": [{"bill_code": "1", "item_code": "1.1", "description": "x", "contract_amount": 0.1},
                       {"bill_code": "1", "item_code": "1.2", "description": "y", "contract_amount": 0.2}]}
    p = shape_preview(parsed)
    assert p["bills"][0]["items_total"] == 0.30 and p["bills"][0]["matches_sheet"] is True


def test_the_sheet_with_the_most_priced_rows_is_the_bill():
    assert pick_beme_sheet({"Summary": {"rows": []}, "BEME": {"rows": [1, 2, 3]}, "Notes": {"rows": [1]}}) == "BEME"
    assert pick_beme_sheet({"Summary": {"rows": []}}) is None


def test_assign_dup_seq_numbers_repeats_within_a_bill():
    items = [{"item_code": "1.1", "description": "a"}, {"item_code": "1.1", "description": "a"},
             {"item_code": "1.2", "description": "a"}]
    assert [i["dup_seq"] for i in assign_dup_seq(items)] == [0, 1, 0]


def test_revision_request_needs_at_least_one_bill_and_a_date():
    from app.api.v1.project_bills import RevisionIn
    with pytest.raises(PydanticValidationError):
        RevisionIn(effective_date="2026-10-12", bills=[])
    with pytest.raises(PydanticValidationError):
        RevisionIn(bills=[{"bill_code": "1", "items": []}])  # type: ignore[call-arg]
    ok = RevisionIn(effective_date="2026-10-12", bills=[{"bill_code": "1", "items": [{"description": "x"}]}])
    assert ok.source == "award_beme" and ok.bills[0].items[0].item_code == ""
