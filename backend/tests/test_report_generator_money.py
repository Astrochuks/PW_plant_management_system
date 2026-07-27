"""The report generator must quote the same money as every other page.

It is the document that leaves the building — printed, exported, sent on.
If it disagrees with the screen, the screen is what gets doubted.

These run the real GET /reports/generate endpoint rather than a copy of
its SQL, so a change to the query is caught rather than mirrored.
"""

from datetime import date

import pytest

from app.core.security import CurrentUser, get_current_user

YEAR = 2026


@pytest.fixture
def as_management(app, management_user):
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(**management_user)
    yield
    app.dependency_overrides.pop(get_current_user, None)


def _yearly(client):
    r = client.get(
        "/api/v1/reports/generate",
        params={"period": "yearly", "date": f"{YEAR}-06-30"},
    )
    if r.status_code == 503:
        pytest.skip("database unavailable")
    assert r.status_code == 200, r.text
    return r.json()["data"]


class TestGeneratorAgreesWithThePages:
    def test_spend_matches_the_spare_parts_card(self, client, as_management):
        gen = _yearly(client)["spare_parts"]["summary"]

        stats = client.get(f"/api/v1/spare-parts/stats?year={YEAR}")
        assert stats.status_code == 200
        card = float(stats.json()["data"]["total_spend"] or 0)

        assert float(gen["total_spend"]) == pytest.approx(card, abs=0.01), (
            f"report generator says NGN {float(gen['total_spend']):,.2f}, "
            f"the Spare Parts card says NGN {card:,.2f}"
        )

    def test_po_count_matches_the_po_list(self, client, as_management):
        gen = _yearly(client)["spare_parts"]["summary"]

        pos = client.get(f"/api/v1/spare-parts/pos?year={YEAR}&page=1&limit=1")
        assert pos.status_code == 200
        listed = pos.json()["meta"]["total"]

        assert gen["total_pos"] == listed, (
            f"report generator counts {gen['total_pos']} POs, "
            f"the PO list shows {listed}"
        )

    def test_site_ranking_ties_out_to_the_headline(self, client, as_management):
        """Every naira in the headline is accounted for by a site, or by
        the explicit unlocated row — nothing quietly missing."""
        sp = _yearly(client)["spare_parts"]
        headline = float(sp["summary"]["total_spend"])
        ranked = sum(float(s["total_spend"] or 0) for s in sp["sites_ranking"])
        assert ranked == pytest.approx(headline, abs=0.01), (
            f"sites ranking sums to NGN {ranked:,.2f} but the headline is "
            f"NGN {headline:,.2f} — NGN {headline - ranked:,.2f} unaccounted"
        )

    def test_high_cost_plants_never_exceed_the_headline(self, client, as_management):
        sp = _yearly(client)["spare_parts"]
        headline = float(sp["summary"]["total_spend"])
        plants = sum(float(p["total_spend"] or 0) for p in sp["high_cost_plants"])
        assert plants <= headline + 0.01, (
            "per-plant spend exceeds total spend — a shared PO is being "
            "charged in full to more than one plant"
        )


class TestGeneratorInternalConsistency:
    def test_supplier_spend_never_exceeds_the_headline(self, client, as_management):
        sp = _yearly(client)["spare_parts"]
        headline = float(sp["summary"]["total_spend"])
        top = sum(float(s["total_spend"] or 0) for s in sp["top_suppliers"])
        assert top <= headline + 0.01

    def test_a_period_with_no_data_reports_zero_not_an_error(
        self, client, as_management
    ):
        r = client.get(
            "/api/v1/reports/generate",
            params={"period": "yearly", "date": "1999-06-30"},
        )
        if r.status_code == 503:
            pytest.skip("database unavailable")
        assert r.status_code == 200
        sp = r.json()["data"]["spare_parts"]["summary"]
        assert float(sp["total_spend"] or 0) == 0
        assert int(sp["total_pos"] or 0) == 0
