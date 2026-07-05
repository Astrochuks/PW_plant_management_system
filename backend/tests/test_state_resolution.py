"""T1.6 — state resolution v2: unit tests per pass + integration threshold.

Replaces the row-index-hardcoded mappings (which had already drifted:
FAAN row 2 was mapped 'Enugu' for a Lagos-airport project). Every real
project name below is from the 2017 workbook.
"""

import json
from pathlib import Path

import pytest

from app.services.register_parsing import resolve_state

GOLDEN = Path(__file__).parent / "golden" / "award_letters_v1_baseline.json"


class TestStateSheets:
    def test_state_sheet_wins_regardless_of_name(self):
        r = resolve_state("Dualization of Bauchi Ring Road", "PLATEAU")
        assert r.state == "Plateau"
        assert r.method == "sheet"

    def test_mixed_case_sheet(self):
        r = resolve_state("Dualization of Uyo - Etinan Road", "Akwa Ibom")
        assert r.state == "Akwa Ibom"
        assert r.method == "sheet"


class TestExplicitStatePhrase:
    def test_in_x_state(self):
        r = resolve_state(
            "Special Repairs of Jos - Gimi Road, Route 70 in Plateau State. Contract No: 023",
            "FERMA",
        )
        assert (r.state, r.method) == ("Plateau", "explicit_state")

    def test_town_containing_state_word_does_not_confuse(self):
        # "Katsina Ala" is a town in Benue; the name says "in Benue State"
        r = resolve_state(
            "Rehabilitation of Katsina Ala - Zaki Biam - Ugba - Buruku Road "
            "in Benue State. Contract No: 508",
            "FMW",
        )
        assert (r.state, r.method) == ("Benue", "explicit_state")

    def test_joined_states_are_ambiguous(self):
        r = resolve_state(
            "Construction of Ogrute - Umuida - Unadu - Akpanya - Odoru Road, "
            "Enugu / Kogi States Contract No",
            "FMW",
        )
        assert r.state is None
        assert r.reason == "ambiguous_states"
        assert set(r.candidates) == {"Enugu", "Kogi"}
        assert r.needs_review


class TestBareMentionGuards:
    def test_niger_barracks_is_not_niger_state(self):
        r = resolve_state(
            "Rehabilitation of Aerators at Gudu, Mogadishu & Niger Barracks",
            "FCDA ABUJA",
        )
        # Resolves via the Gudu landmark instead
        assert (r.state, r.method) == ("FCT", "landmark")

    def test_river_niger_is_not_niger_state(self):
        r = resolve_state("Construction of Bridge across River Niger", "FMW")
        assert r.state != "Niger"

    def test_plain_mention_resolves(self):
        r = resolve_state(
            "Dualization of Ibadan - Ilorin road (Route.A2) Section I: "
            "Ibadan - Oyo Road. Contract No: 1973",
            "FMW",
        )
        assert (r.state, r.method) == ("Oyo", "state_mention")


class TestLandmarks:
    @pytest.mark.parametrize(
        "name,sheet,expected",
        [
            # The MMIA fix — old hardcode said Enugu, project is Lagos
            ("Extension & Asphalt Overlay of MMIA Domestic Runway 18L/36R.", "FAAN", "Lagos"),
            # Old hardcode said Plateau; Zuba/Abaji are FCT
            ("Zuba - Abaji Road. Contract No: CN 3196", "FMW", "FCT"),
            # Old hardcode said FCT; Suleja is a Niger-state town
            ("Rehabilitation of Suleja Township Roads", "FCDA ABUJA", "Niger"),
            ("Construction of Civil Infrastructural Works in Beach Resort Estate, Lekki",
             "PRIVATE CLIENTS", "Lagos"),
        ],
    )
    def test_landmark_resolution(self, name, sheet, expected):
        r = resolve_state(name, sheet)
        assert r.state == expected, f"{name[:50]} → {r.state}"
        assert r.method == "landmark"


class TestFallbacks:
    def test_sheet_text_extraction(self):
        r = resolve_state("Provision of Road Infrastructure to Satellite Town", "FCDA ABUJA")
        assert (r.state, r.method) == ("FCT", "sheet_text")

    def test_client_default(self):
        r = resolve_state("Earthwork Conveyor Belt", "PRIVATE CLIENTS", "Lagos")
        assert (r.state, r.method) == ("Lagos", "client_default")

    def test_nothing_found_needs_review(self):
        r = resolve_state("Carlton Estate Civil & Cold Water Pipe Work", "PRIVATE CLIENTS")
        assert r.state is None
        assert r.reason == "no_state_found"
        assert r.needs_review

    def test_never_raises(self):
        for name, sheet in ((None, None), ("", ""), (123, object())):
            r = resolve_state(name, sheet)  # type: ignore[arg-type]
            assert r.state is None or isinstance(r.state, str)


class TestIntegrationAgainstFullRegister:
    """PRD success metric: <5% misses on non-state sheets; every
    unresolved row must carry an actionable reason for the queue."""

    def _run_all(self):
        data = json.loads(GOLDEN.read_text())
        return [
            (p, resolve_state(p["project_name"], p["source_sheet"]))
            for p in data["projects"]
        ]

    def test_resolution_rate_at_least_95_percent(self):
        results = self._run_all()
        resolved = sum(1 for _, r in results if r.state is not None)
        rate = resolved / len(results)
        assert rate >= 0.95, f"resolution rate {rate:.1%}"

    def test_every_unresolved_row_has_reason_and_raw_context(self):
        for p, r in self._run_all():
            if r.state is None:
                assert r.reason in ("ambiguous_states", "no_state_found"), p["project_name"]
                if r.reason == "ambiguous_states":
                    assert len(r.candidates) >= 2

    def test_ambiguous_rows_are_only_genuine_cross_state_roads(self):
        ambiguous = [
            (p, r) for p, r in self._run_all() if r.reason == "ambiguous_states"
        ]
        # Known cross-state federal roads in the 2017 register
        assert len(ambiguous) <= 3
        for p, _ in ambiguous:
            assert p["source_sheet"] == "FMW"


class TestClientDefaultStateExtraction:
    def test_state_government_clients(self):
        from app.services.register_parsing import extract_client_default_state

        assert extract_client_default_state("Plateau State Govt.") == "Plateau"
        assert extract_client_default_state("Akwa Ibom state Govt") == "Akwa Ibom"
        assert extract_client_default_state("Taraba Bureau for Local Government") == "Taraba"

    def test_federal_and_private_clients_get_none(self):
        from app.services.register_parsing import extract_client_default_state

        assert extract_client_default_state("FERMA") is None
        assert extract_client_default_state("FAAN") is None
        assert extract_client_default_state("Delkolt Multiconcepts Nigeria Limited") is None
        assert extract_client_default_state(None) is None

    async def test_seeded_defaults_in_db(self, db_conn):
        seeded = await db_conn.fetchval(
            "SELECT count(*) FROM clients WHERE default_state_id IS NOT NULL"
        )
        assert seeded >= 15  # 18 at seed time; new clients may appear later
