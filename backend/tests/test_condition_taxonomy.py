"""Six-value condition taxonomy (user decision 2026-07-07).

working | standby | breakdown | missing | scrap | off_hire — nothing else.
under_repair / faulty / gpm_assessment → breakdown; 'unverified' retired:
unknown = None → previous condition carried forward.
"""

import pytest

from app.services.preview_service import detect_condition_from_keywords
from app.services.remarks_parser import VALID_CONDITIONS, ParsedRemarks, derive_condition

SIX = {"working", "standby", "breakdown", "missing", "scrap", "off_hire"}


class TestValidConditions:
    def test_taxonomy_is_exactly_six(self):
        assert set(VALID_CONDITIONS) == SIX


class TestDetectorCollapse:
    @pytest.mark.parametrize(
        "remarks",
        [
            "SENT FOR REBORE",            # was under_repair
            "UNDER REPAIR",               # was under_repair
            "AWAITING PARTS",             # was under_repair
            "REQUIRE GPM ASSESSMENT",     # was gpm_assessment
            "ENGINE PROBLEM",             # was faulty
            "NEED TYRES",                 # was faulty
            "FAULTY",                     # was faulty
            "GEARBOX PROBLEM",            # was faulty
        ],
    )
    def test_repair_fault_assessment_all_map_to_breakdown(self, remarks):
        r = detect_condition_from_keywords(
            remarks=remarks, hours_worked=0, standby_hours=0,
            breakdown_hours=0, off_hire=False, physical_verification=True,
        )
        assert r.condition == "breakdown", f"{remarks!r} → {r.condition}"

    def test_detector_never_emits_retired_values(self):
        """Sweep of tricky inputs — output must always be one of the six
        (or a carried-forward previous, which is also one of the six)."""
        tricky = [
            "TO BE CHECKED", "FROM BAUCHI", "FOR CHECKING", "",
            None, "RANDOM TEXT", "WORK IN PROGRESS", "GPM", "PROBLEM",
            "STANDBY, NEED TYRES", "NOT SEEN", "OFF HIRE", "SCRAPPED",
        ]
        for remarks in tricky:
            for prev in (None, "working", "breakdown"):
                r = detect_condition_from_keywords(
                    remarks=remarks, hours_worked=0, standby_hours=0,
                    breakdown_hours=0, off_hire=False,
                    physical_verification=False, previous_condition=prev,
                )
                assert r.condition in SIX, f"{remarks!r}/{prev} → {r.condition}"


class TestCarryForward:
    def test_unknown_carries_previous_condition(self):
        r = detect_condition_from_keywords(
            remarks="TO BE CHECKED", hours_worked=0, standby_hours=0,
            breakdown_hours=0, off_hire=False, physical_verification=True,
            previous_condition="breakdown",
        )
        assert r.condition == "breakdown"
        assert "carried forward" in r.reason.lower() or "Pending" in r.reason

    def test_not_verified_carries_previous(self):
        r = detect_condition_from_keywords(
            remarks="some unclear text xyz", hours_worked=0, standby_hours=0,
            breakdown_hours=0, off_hire=False, physical_verification=False,
            previous_condition="missing",
        )
        assert r.condition == "missing"

    def test_no_history_defaults_to_standby(self):
        r = detect_condition_from_keywords(
            remarks=None, hours_worked=0, standby_hours=0,
            breakdown_hours=0, off_hire=False, physical_verification=False,
            previous_condition=None,
        )
        assert r.condition == "standby"

    def test_clear_signal_beats_carry_forward(self):
        r = detect_condition_from_keywords(
            remarks="BROKEN DOWN", hours_worked=0, standby_hours=0,
            breakdown_hours=0, off_hire=False, physical_verification=False,
            previous_condition="working",
        )
        assert r.condition == "breakdown"


class TestDeriveCondition:
    def _parsed(self, condition, confidence=0.5):
        return ParsedRemarks(
            condition=condition, transfer_detected=False,
            transfer_direction=None, transfer_location=None,
            transfer_date=None, condition_notes=None, confidence=confidence,
        )

    def test_hours_worked_yields_working_not_operational(self):
        # regression: used to return 'operational', never a valid value
        c = derive_condition(
            parsed=self._parsed(None), hours_worked=10,
            standby_hours=0, breakdown_hours=0, off_hire=False,
        )
        assert c == "working"

    def test_unknown_returns_none_for_carry_forward(self):
        c = derive_condition(
            parsed=self._parsed(None), hours_worked=0,
            standby_hours=0, breakdown_hours=0, off_hire=False,
        )
        assert c is None

    def test_high_confidence_none_falls_through(self):
        c = derive_condition(
            parsed=self._parsed(None, confidence=0.9), hours_worked=0,
            standby_hours=5, breakdown_hours=0, off_hire=False,
        )
        assert c == "standby"

    def test_never_returns_retired_values(self):
        for cond in (None, "working", "breakdown", "standby"):
            for hours in (0, 5):
                c = derive_condition(
                    parsed=self._parsed(cond), hours_worked=hours,
                    standby_hours=0, breakdown_hours=0, off_hire=False,
                )
                assert c is None or c in SIX


class TestDatabaseConstraint:
    async def test_retired_values_rejected_by_db(self, db_conn):
        import asyncpg

        for bad in ("under_repair", "faulty", "gpm_assessment", "unverified"):
            # savepoint per attempt — a violation aborts only the savepoint
            with pytest.raises(asyncpg.CheckViolationError):
                async with db_conn.transaction():
                    await db_conn.execute(
                        "UPDATE plants_master SET condition = $1 "
                        "WHERE id = (SELECT id FROM plants_master LIMIT 1)",
                        bad,
                    )

    async def test_no_retired_values_remain_anywhere(self, db_conn):
        for table in ("plants_master", "plant_weekly_records"):
            n = await db_conn.fetchval(
                f"SELECT count(*) FROM {table} WHERE condition IN "
                "('under_repair','faulty','gpm_assessment','unverified')"
            )
            assert n == 0, f"{table} still has {n} retired-condition rows"
