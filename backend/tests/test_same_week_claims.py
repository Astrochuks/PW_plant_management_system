"""Same-week two-site claim resolution (pure logic, no DB).

Real case: grader G36 sat in ABUJA's file as a frozen row ('ENGINE
REPLACED, WORK IN PROGRESS', 0 hrs, 8 straight weeks) while brand-new
BOKKOS actively listed it. v1 used arrival-vs-continuing, which works
only for the FIRST week of a move — from week 2 the old site's zombie
looks like a 'new arrival' and the signal inverts. v2: freshness first
(a living row always beats a frozen copy), then record incumbency (the
timeline) tiebreaks. The ghost-row guard upstream drops frozen rows for
plants that live elsewhere before this resolver even runs.
"""

from app.workers.etl_worker import resolve_same_week_claim


class TestFreshnessFirst:
    def test_week_of_move_either_order(self):
        # W25, Abuja uploaded first: incoming Bokkos row is fresh (first
        # ever here), Abuja's existing claim is a frozen copy → move.
        assert resolve_same_week_claim(
            incoming_fresh=True, existing_fresh=False,
            incoming_held_prev_week=False, existing_held_prev_week=True,
        ) == "takeover"
        # W25, Bokkos uploaded first: incoming Abuja zombie vs fresh
        # existing Bokkos claim → Bokkos keeps.
        assert resolve_same_week_claim(
            incoming_fresh=False, existing_fresh=True,
            incoming_held_prev_week=True, existing_held_prev_week=False,
        ) == "keep_existing"

    def test_week_after_move_zombie_cannot_steal_back(self):
        # W26, Bokkos first: Abuja's zombie now LOOKS like a new arrival
        # (arrival signal inverted — v1 wrongly took over here). Fresh
        # Bokkos claim wins on freshness regardless.
        assert resolve_same_week_claim(
            incoming_fresh=False, existing_fresh=True,
            incoming_held_prev_week=False, existing_held_prev_week=True,
        ) == "keep_existing"

    def test_genuine_move_back_is_honoured(self):
        # Plant really returns to Abuja: fresh Abuja row (new remarks or
        # hours) vs Bokkos's now-frozen copy → moves back.
        assert resolve_same_week_claim(
            incoming_fresh=True, existing_fresh=False,
            incoming_held_prev_week=False, existing_held_prev_week=True,
        ) == "takeover"


class TestTimelineTiebreak:
    def test_equal_freshness_record_holder_wins_flagged(self):
        # Both rows equally (un)fresh: the site that held the plant last
        # week per plant_weekly_records takes it, flagged for review.
        assert resolve_same_week_claim(
            incoming_fresh=False, existing_fresh=False,
            incoming_held_prev_week=True, existing_held_prev_week=False,
        ) == "review_takeover"
        assert resolve_same_week_claim(
            incoming_fresh=True, existing_fresh=True,
            incoming_held_prev_week=False, existing_held_prev_week=True,
        ) == "review_keep_existing"

    def test_fully_symmetric_keeps_first_upload_flagged(self):
        assert resolve_same_week_claim(
            incoming_fresh=True, existing_fresh=True,
            incoming_held_prev_week=False, existing_held_prev_week=False,
        ) == "review_keep_existing"
        assert resolve_same_week_claim(
            incoming_fresh=False, existing_fresh=False,
            incoming_held_prev_week=True, existing_held_prev_week=True,
        ) == "review_keep_existing"
