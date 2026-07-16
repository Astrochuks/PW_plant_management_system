"""Same-week two-site claim resolution (pure logic, no DB).

Real case that motivated this: grader G36 sat in ABUJA's file as a
frozen row ('ENGINE REPLACED, WORK IN PROGRESS', 0 hrs, 8 straight
weeks) while brand-new BOKKOS actively listed it. Upload order used to
decide (first wins, silently); now evidence does.
"""

from app.workers.etl_worker import resolve_same_week_claim


class TestSameWeekClaims:
    def test_new_arrival_beats_continuing_claim(self):
        # G36: new at Bokkos, Abuja had it last week (rolled-forward row)
        assert resolve_same_week_claim(
            incoming_is_new_here=True, existing_is_continuing=True
        ) == "takeover"

    def test_continuing_row_never_steals_from_an_arrival(self):
        # Reverse order of uploads for the same physical move: the site
        # that received the plant uploaded first; the old site's frozen
        # row arrives second and must not pull it back.
        assert resolve_same_week_claim(
            incoming_is_new_here=False, existing_is_continuing=False
        ) == "keep_existing"

    def test_two_fresh_arrivals_need_a_human(self):
        assert resolve_same_week_claim(
            incoming_is_new_here=True, existing_is_continuing=False
        ) == "review"

    def test_two_continuing_claims_need_a_human(self):
        assert resolve_same_week_claim(
            incoming_is_new_here=False, existing_is_continuing=True
        ) == "review"
