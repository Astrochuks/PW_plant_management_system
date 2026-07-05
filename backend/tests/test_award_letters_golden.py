"""T1.1 — Golden-file regression tests for the Award Letters parser.

Freezes the CURRENT parser's exact output on the 2017 workbook. Any parser
change that alters output makes these tests fail — which is the point:
improvements must be deliberate, reviewed diffs of the golden file, never
accidents.

Regenerate (only when a change is intended):
    UPDATE_GOLDEN=1 pytest tests/test_award_letters_golden.py
then review the golden diff in git before committing.
"""

import json
import math
import os
from datetime import date, datetime
from pathlib import Path

import pytest

from app.services.award_letters_parser import parse_award_letters_excel

FIXTURE = Path(__file__).parent / "fixtures" / "projects" / "award_letters_2017.xlsx"
GOLDEN = Path(__file__).parent / "golden" / "award_letters_v1_baseline.json"


def _normalize_value(v):
    """JSON-safe, deterministic representation of a parsed value."""
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, float) and math.isnan(v):
        return None
    return v


def _normalized_run() -> dict:
    """Run the parser on the fixture and strip non-deterministic fields."""
    result = parse_award_letters_excel(FIXTURE.read_bytes())

    projects = [
        {k: _normalize_value(v) for k, v in sorted(p.items()) if k != "import_batch_id"}
        for p in result["projects"]
    ]
    return {
        "projects": projects,
        "errors": result["errors"],
        "warnings": result["warnings"],
        "sheets_processed": result["sheets_processed"],
        "total_rows": result["total_rows"],
    }


def test_parser_is_deterministic():
    """Two runs on identical input must produce identical output —
    the precondition for golden testing to mean anything."""
    a = _normalized_run()
    b = _normalized_run()
    assert a == b


def test_matches_golden_baseline():
    """Parser output must match the frozen baseline byte-for-byte."""
    current = _normalized_run()

    if os.environ.get("UPDATE_GOLDEN") == "1":
        GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN.write_text(
            json.dumps(current, indent=1, sort_keys=True, ensure_ascii=False) + "\n"
        )
        pytest.skip(f"golden baseline regenerated at {GOLDEN} — review the diff")

    assert GOLDEN.exists(), (
        "golden baseline missing — generate once with UPDATE_GOLDEN=1 and commit it"
    )
    baseline = json.loads(GOLDEN.read_text())

    # Compare summary stats first for a readable failure before the deep diff
    assert current["sheets_processed"] == baseline["sheets_processed"]
    assert current["total_rows"] == baseline["total_rows"], (
        f"project count changed: {baseline['total_rows']} → {current['total_rows']}"
    )
    assert len(current["errors"]) == len(baseline["errors"])
    assert len(current["warnings"]) == len(baseline["warnings"])
    assert current == baseline


def test_baseline_sanity():
    """Guard against a hollow baseline: the 2017 workbook has 17 sheets and
    a couple hundred projects. If these numbers collapse, the fixture or
    parser broke fundamentally."""
    current = _normalized_run()
    assert current["sheets_processed"] == 17
    assert current["total_rows"] > 150
    # Every project must carry the mandatory identity fields
    for p in current["projects"]:
        assert p["project_name"]
        assert p["source_sheet"]
        assert p["is_legacy"] is True
